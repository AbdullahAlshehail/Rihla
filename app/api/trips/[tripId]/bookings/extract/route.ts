// POST /api/trips/:tripId/bookings/extract
//
// Smart booking-from-image: user uploads a confirmation/ticket/receipt photo
// and we call Anthropic Claude (Haiku 4.5 vision) to extract structured
// booking data — same pattern as the Amoria invoice extractor.
//
// We use tool-use to force a strict JSON schema (no string-parsing of the
// model's free-form output).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

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
      start_at: { type: ["string", "null"], description: "ISO 8601 datetime (check-in / departure)" },
      end_at: { type: ["string", "null"], description: "ISO 8601 datetime (check-out / arrival)" },
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

export async function POST(
  req: Request,
  { params }: { params: { tripId: string } },
) {
  void params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ai_unavailable" }, { status: 503 });

  // Body — accept multipart upload (preferred) or JSON dataUrl.
  let base64: string | null = null;
  let mime = "image/jpeg";
  let originalSize = 0;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "missing_file" }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: "file_too_large", limit_mb: 5 }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "unsupported_mime", mime: file.type }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    originalSize = buf.length;
    base64 = buf.toString("base64");
    mime = file.type;
  } else {
    const body = await req.json().catch(() => null) as { dataUrl?: string } | null;
    if (!body?.dataUrl) {
      return NextResponse.json({ error: "missing_image" }, { status: 400 });
    }
    const m = /^data:(image\/[^;]+);base64,(.+)$/.exec(body.dataUrl);
    if (!m) return NextResponse.json({ error: "bad_data_url" }, { status: 400 });
    mime = m[1];
    base64 = m[2];
    originalSize = base64.length * 0.75;
  }

  const startedAt = Date.now();
  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mime, data: base64 },
              },
              { type: "text", text: "Extract the booking from this image." },
            ],
          },
        ],
      }),
    });
  } catch (e: unknown) {
    return NextResponse.json({
      error: "anthropic_network",
      message: e instanceof Error ? e.message : "fetch_failed",
    }, { status: 502 });
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return NextResponse.json({
      error: "anthropic_http",
      status: resp.status,
      detail: detail.slice(0, 400),
    }, { status: 502 });
  }

  const data = await resp.json().catch(() => null) as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens: number; output_tokens: number };
  } | null;

  const toolUse = data?.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name);
  if (!toolUse?.input) {
    return NextResponse.json({ error: "no_tool_use" }, { status: 502 });
  }

  return NextResponse.json({
    extracted: toolUse.input,
    meta: {
      model: MODEL,
      ms: Date.now() - startedAt,
      image_kb: Math.round(originalSize / 1024),
      tokens: data?.usage ?? null,
    },
  });
}
