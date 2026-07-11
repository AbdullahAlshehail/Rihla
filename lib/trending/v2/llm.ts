// Stage 2b — LLM name-extraction seam. Called ONLY for results where the
// rule-based parser could not extract a place name, as ONE small batch.
//
// The LLM's ONLY job: read title+snippet and report the venue name written
// there (or nothing). It may NOT invent names/dates/view-counts/URLs and it
// never scores anything — every returned name is re-validated in code
// against the source text before it is used.

import { normalizeName } from "@/lib/trending/v2/normalize";

export type LlmExtractInput = {
  index: number;      // caller's index into its own result list
  title: string;
  snippet: string;
  url: string;
};

export type LlmExtractOutput = {
  index: number;
  place_name_raw: string;
  confidence: number; // 0-100 as self-reported, clamped
};

export type LlmExtractResult = {
  extractions: LlmExtractOutput[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  warnings: string[];
};

/** The injectable seam — tests provide fixtures, prod uses anthropicExtract. */
export type LlmExtractFn = (batch: LlmExtractInput[]) => Promise<LlmExtractResult>;

// ── Code-side validation (applies to fixtures AND the real model) ────────
// A name is accepted only if its distinctive tokens actually appear in that
// result's title+snippet — the model cannot introduce a name from thin air.

export function validateExtractions(
  batch: LlmExtractInput[], raw: LlmExtractOutput[],
): { accepted: LlmExtractOutput[]; rejected: string[] } {
  const accepted: LlmExtractOutput[] = [];
  const rejected: string[] = [];
  const seen = new Set<number>();
  for (const ext of raw) {
    const src = batch.find((b) => b.index === ext.index);
    if (!src || seen.has(ext.index)) { rejected.push(`bad_index:${ext.index}`); continue; }
    const name = String(ext.place_name_raw ?? "").trim().slice(0, 80);
    if (name.length < 2) { rejected.push(`empty_name:${ext.index}`); continue; }
    const hayNorm = normalizeName(`${src.title} ${src.snippet}`);
    const nameNorm = normalizeName(name);
    const tokens = nameNorm.split(" ").filter((t) => t.length >= 2);
    const grounded = nameNorm.length >= 2 && tokens.length > 0 &&
      tokens.every((t) => hayNorm.includes(t));
    if (!grounded) { rejected.push(`ungrounded_name:${name.slice(0, 24)}`); continue; }
    seen.add(ext.index);
    accepted.push({
      index: ext.index,
      place_name_raw: name,
      confidence: Math.max(0, Math.min(100, Math.round(Number(ext.confidence) || 0))),
    });
  }
  return { accepted, rejected };
}

// ── Production implementation (Haiku, one batch, strict tool output) ─────

const MODEL = "claude-haiku-4-5-20251001";

const EXTRACT_TOOL = {
  name: "report_place_names",
  description:
    "Report the specific venue (cafe/coffee shop) NAMES that are literally written in the given search results. One entry per result that names a venue. Skip results that name no specific venue.",
  input_schema: {
    type: "object" as const,
    properties: {
      extractions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer", description: "The [n] index of the result." },
            place_name_raw: {
              type: "string",
              description: "The venue name EXACTLY as written in that result's title/snippet. Never invent, translate, or transliterate.",
            },
            confidence: {
              type: "integer", minimum: 0, maximum: 100,
              description: "How clearly the text names this venue (90+ = explicit name; 50-70 = probable).",
            },
          },
          required: ["index", "place_name_raw", "confidence"],
        },
      },
    },
    required: ["extractions"],
  },
};

export const anthropicExtract: LlmExtractFn = async (batch) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("anthropic_key_missing");
  const warnings: string[] = [];

  const resultsText = batch.map((b) =>
    `[${b.index}] ${b.title.slice(0, 120)}\n    ${b.snippet.slice(0, 200)}`,
  ).join("\n\n");

  const prompt = `Below are web search results about cafes. For each result that LITERALLY WRITES a specific venue's name in its title or snippet, call report_place_names with that name copied verbatim.

Hard rules:
- Copy the name exactly as written. NEVER invent, complete, translate, or guess a name.
- Do NOT report generic phrases ("new cafe", "كافيه جديد") — only proper names.
- Do NOT report dates, view counts, or URLs. Do NOT judge whether anything is trending.
- A search/hashtag/aggregation page is not a venue — skip it.
- If no result names a venue, call the tool with an empty list.

RESULTS:
${resultsText}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: "report_place_names" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`anthropic_${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (data.stop_reason === "max_tokens") warnings.push("llm_truncated");

  const rawList: LlmExtractOutput[] = [];
  for (const block of (data.content ?? [])) {
    if (block?.type !== "tool_use" || block?.name !== "report_place_names") continue;
    for (const e of (block.input?.extractions ?? [])) {
      rawList.push({
        index: Number(e?.index),
        place_name_raw: String(e?.place_name_raw ?? ""),
        confidence: Number(e?.confidence ?? 0),
      });
    }
  }
  const { accepted, rejected } = validateExtractions(batch, rawList);
  warnings.push(...rejected.map((r) => `llm_rejected:${r}`));

  const usage = data.usage ?? {};
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  // Haiku 4.5: $1/MTok in, $5/MTok out.
  const costUsd = (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 5.0;

  return { extractions: accepted, inputTokens, outputTokens, costUsd, warnings };
};
