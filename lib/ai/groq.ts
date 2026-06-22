// Groq adapter — Arabic summarization of Google reviews.
// Free tier is generous (30 req/min, 14k tokens/min); plenty for personal use.
//
// If GROQ_API_KEY is not set, all functions return null gracefully.

import type { GoogleReviewSnippet } from "@/lib/supabase/database.types";

const BASE = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant"; // fastest, cheapest, plenty for summaries

export async function summarizeReviews(
  placeName: string,
  reviews: GoogleReviewSnippet[]
): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || reviews.length === 0) return null;

  // Compact prompt: 3-5 reviews → 1 short paragraph in Arabic
  const reviewText = reviews
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] (${r.rating ?? "?"}★) ${r.text.slice(0, 600)}`)
    .join("\n\n");

  const prompt = `أنت محرّر سفر عربي. لخّص آراء الزوار التالية عن "${placeName}" في فقرة عربية واحدة موجزة (٣٠-٥٠ كلمة).
ركّز على:
- الجانب اللي يمدحه الزوار أكثر شيء
- النقطة الأقوى/أبرز نقطة سلبية لو موجودة
- نصيحة عملية واحدة
لا تكرر العبارة "الزوار يقولون". اكتب نص طبيعي مفيد. لا تضع تنسيق markdown.

المراجعات:
${reviewText}`;

  try {
    const resp = await fetch(BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 220,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    return out && out.length > 20 ? out : null;
  } catch {
    return null;
  }
}
