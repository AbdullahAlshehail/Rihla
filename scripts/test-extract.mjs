// Smoke-test the Anthropic extract pipeline end-to-end. Runs N times to
// measure latency variance + verify extraction quality on real-ish images.

import fs from "node:fs";
import path from "node:path";

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("❌ ANTHROPIC_API_KEY missing"); process.exit(1); }

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a precise travel booking parser. The user uploaded a photo of a flight ticket, hotel confirmation, event ticket, transport booking, or receipt. Extract the booking details into the provided tool. Rules:
- NEVER guess. Use null for anything you can't read.
- Currency must be one of: SAR, EUR, USD, GBP, AED — else null.
- Dates: ISO 8601 with timezone (Z). Date-only → T00:00:00Z.
- title: short Arabic-first label (English place names OK), e.g. "فندق مارتينيز كان" or "السعودية SV1234 RUH→NCE".
- paid_status: "paid" only if the document clearly says paid/confirmed.
- metadata: small object with type-specific extras (flight_number, baggage, room_type, kind, provider, etc.).`;

const TOOL = {
  name: "save_booking_extraction",
  description: "Save the structured booking data extracted from the uploaded image.",
  input_schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["flight", "hotel", "event", "transport", "expense"] },
      title: { type: "string" },
      subtitle: { type: ["string", "null"] },
      start_at: { type: ["string", "null"] },
      end_at: { type: ["string", "null"] },
      location_name: { type: ["string", "null"] },
      address: { type: ["string", "null"] },
      amount: { type: ["number", "null"] },
      currency: { type: ["string", "null"], enum: ["SAR", "EUR", "USD", "GBP", "AED", null] },
      reference: { type: ["string", "null"] },
      paid_status: { type: "string", enum: ["paid", "unpaid", "partial", "unknown"] },
      metadata: { type: "object", additionalProperties: true },
    },
    required: ["type", "title", "paid_status"],
  },
};

async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("img " + r.status);
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/jpeg" };
}

async function callAnthropic(base64, mime) {
  const t0 = Date.now();
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
          { type: "text", text: "Extract the booking from this image." },
        ],
      }],
    }),
  });
  const elapsed = Date.now() - t0;
  if (!resp.ok) return { elapsed, status: resp.status, error: await resp.text() };
  const data = await resp.json();
  const toolUse = data?.content?.find((c) => c.type === "tool_use");
  return { elapsed, status: 200, extracted: toolUse?.input, usage: data?.usage };
}

const TESTS = [
  { name: "Airplane window", url: "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1200&q=85" },
  { name: "Hotel room",      url: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=85" },
  { name: "Concert tickets", url: "https://images.unsplash.com/photo-1429962714451-bb934ecdc4ec?w=1200&q=85" },
];

(async () => {
  console.log(`Model: ${MODEL}\n${"=".repeat(60)}`);
  const latencies = [];
  let totalCost = 0;

  for (const t of TESTS) {
    console.log(`\n🔹 ${t.name}`);
    try {
      const img = await fetchImage(t.url);
      console.log(`   img: ${(img.buf.length / 1024).toFixed(1)} KB ${img.mime}`);
      const r = await callAnthropic(img.buf.toString("base64"), img.mime.split(";")[0]);
      if (r.error) { console.log(`   ❌ ${r.status}: ${r.error.slice(0,200)}`); continue; }
      console.log(`   ⏱  ${r.elapsed}ms`);
      console.log(`   📤 ${JSON.stringify(r.extracted)}`);
      latencies.push(r.elapsed);
      if (r.usage) {
        const cost = (r.usage.input_tokens / 1e6) * 1.0 + (r.usage.output_tokens / 1e6) * 5.0;
        totalCost += cost;
        console.log(`   💰 $${cost.toFixed(5)} (${r.usage.input_tokens} in + ${r.usage.output_tokens} out)`);
      }
    } catch (e) {
      console.log(`   ❌ ${e.message}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  if (latencies.length) {
    const avg = Math.round(latencies.reduce((a,b)=>a+b,0) / latencies.length);
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    console.log(`\n📊 Latency: avg ${avg}ms  min ${min}ms  max ${max}ms  (n=${latencies.length})`);
    console.log(`💰 Total cost: $${totalCost.toFixed(5)}  →  ~$${(totalCost / latencies.length).toFixed(5)}/call`);
    const verdict = avg < 3000 ? "✨ EXCELLENT" : avg < 5000 ? "✓ ACCEPTABLE" : "⚠ SLOW";
    console.log(`🎯 Verdict: ${verdict}`);
  }
})().catch((e) => { console.error(e); process.exit(99); });
