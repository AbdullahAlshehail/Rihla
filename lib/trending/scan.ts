// Trending scan — TikTok / Instagram social-virality detector.
//
// For a given city, ask Anthropic Claude (Sonnet 4.6) with the built-in
// web_search tool to find places that are currently viral on TikTok and
// Instagram, then match each viral mention against our catalogue and write
// back a `trending_score` (0-100), `trending_source`, and evidence URL list.
//
// Why Claude with web_search?  One API call does:
//   1. Search "tiktok viral [city]" / "instagram trending [city]" / variants
//   2. Read result snippets
//   3. Match place names to OUR catalogue (UUID-keyed)
//   4. Score + emit structured evidence
// No external search-API integration needed — ANTHROPIC_API_KEY only.
//
// Cost: ~$0.12 per city (Sonnet input + output + 6 web searches at $10/1K).
// Time: ~10-20s per city. Stays within Netlify's 30s function ceiling.

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────────

export type ScanCandidate = {
  id: string;
  name: string;
  category: string;
  rating: number | null;
  review_count: number | null;
};

export type TrendingMatch = {
  place_id: string;
  score: number;
  source: "tiktok" | "instagram" | "both" | "web";
  evidence_url: string;
  evidence_snippet?: string;
};

export type ScanResult = {
  city: string;
  matches: TrendingMatch[];
  searches: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  warnings: string[];
};

// ── Service-role client (bypasses RLS — cron has no user) ────────────────

export function adminSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase_service_role_missing");
  return createServiceClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Candidate selection ──────────────────────────────────────────────────
// We feed Claude a CAPPED list — only the catalogue places that COULD
// reasonably trend (rating ≥ 4.0, has reviews). Keeps the input token bill
// low (~150 candidates × 80 chars ≈ 12 KB) and gives Claude a focused match
// set so it doesn't hallucinate IDs.

const MAX_CANDIDATES_PER_CITY = 150;

export async function pickCandidates(
  supabase: SupabaseClient,
  cityFilter: { city?: string; city_label?: string },
): Promise<ScanCandidate[]> {
  const q = supabase
    .from("places")
    .select("id,name,category,rating,review_count,city,city_label")
    .gte("rating", 4.0)
    .gte("review_count", 30)
    .order("review_count", { ascending: false })
    .limit(MAX_CANDIDATES_PER_CITY);

  if (cityFilter.city) q.eq("city", cityFilter.city);
  if (cityFilter.city_label) q.eq("city_label", cityFilter.city_label);

  const { data, error } = await q;
  if (error) throw new Error(`pickCandidates_failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    rating: r.rating,
    review_count: r.review_count,
  }));
}

// ── The scan call ────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";

const SAVE_TRENDING_TOOL = {
  name: "save_trending",
  description:
    "Record that a place from the supplied catalogue is currently trending on TikTok and/or Instagram. Call this once per VIRAL place you found explicit evidence for. Do not call for places without clear social-media evidence.",
  input_schema: {
    type: "object" as const,
    properties: {
      place_id: {
        type: "string",
        description: "UUID — must match a row from the catalogue list. Never invent.",
      },
      score: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description:
          "Virality estimate. 50-69 = mentioned in 1-2 posts/articles. 70-84 = repeatedly mentioned by multiple creators / lists. 85-100 = clearly going viral right now (high views, multiple platforms, dedicated content).",
      },
      source: {
        type: "string",
        enum: ["tiktok", "instagram", "both", "web"],
        description:
          "Where the trend lives. Use 'both' only when you saw mentions on BOTH platforms. 'web' = listicle/blog evidence without a direct platform link.",
      },
      evidence_url: {
        type: "string",
        description: "The single best URL backing this score (TikTok / Instagram / article).",
      },
      evidence_snippet: {
        type: "string",
        description: "Short quote or paraphrase (≤ 120 chars) summarising the evidence.",
      },
    },
    required: ["place_id", "score", "source", "evidence_url"],
  },
};

export async function scanCity(opts: {
  cityKey: string;
  cityLabel: string;
  candidates: ScanCandidate[];
}): Promise<ScanResult> {
  const { cityKey, cityLabel, candidates } = opts;
  const startedAt = Date.now();
  const warnings: string[] = [];

  if (candidates.length === 0) {
    return {
      city: cityLabel,
      matches: [],
      searches: 0,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      warnings: ["no_candidates"],
    };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("anthropic_key_missing");

  // Catalogue rendered as compact lines. UUID first so Claude's tool-call
  // payload is short. Cap candidate name at 60 chars to bound input tokens.
  const catalogueText = candidates
    .map((c) => `${c.id} | ${c.name.slice(0, 60)} | ${c.category}`)
    .join("\n");

  const userMessage = `You are scanning what's currently viral on TikTok and Instagram for the city: **${cityLabel}** (catalogue key: ${cityKey}).

Goal: find places in the catalogue below that are TRENDING **right now** on social media. Target audience: Saudi/Arab tourists planning a trip.

Process:
1. Search the web 4-6 times. Useful queries:
   - "tiktok viral places ${cityLabel}"
   - "${cityLabel} instagram famous restaurant 2026"
   - "must visit ${cityLabel} tiktok"
   - "اشهر مطاعم ${cityLabel} تيك توك"
2. For each viral place you find that ALSO matches a catalogue entry (by name or strong-resemblance), call **save_trending** with the matching UUID.
3. Skip ambiguous matches — only call save_trending when you're confident the catalogue row is the same place.

CATALOGUE (place_id | name | category):
${catalogueText}

Rules:
- ONLY use UUIDs from the catalogue above. Never invent IDs.
- Skip generic mentions (e.g. "Nice has great food"). Need a specific named venue.
- Don't double-call for the same place_id.
- If nothing is clearly trending, return 0 calls — silence is correct.`;

  const body = {
    model: MODEL,
    max_tokens: 4096,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 6 },
      SAVE_TRENDING_TOOL,
    ],
    messages: [{ role: "user" as const, content: userMessage }],
  };

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`anthropic_${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();

  // Walk the content array. Tool-use blocks named "save_trending" carry our
  // structured matches. Server-tool-use blocks are web_search calls — count
  // them for cost tracking. Text blocks are Claude's reasoning, ignored.
  const matches: TrendingMatch[] = [];
  let searches = 0;
  for (const block of (data.content ?? [])) {
    if (block?.type === "server_tool_use" && block?.name === "web_search") {
      searches++;
    } else if (block?.type === "tool_use" && block?.name === "save_trending") {
      const inp = block.input ?? {};
      // Validate against candidate set — Claude must never invent IDs.
      const known = candidates.find((c) => c.id === inp.place_id);
      if (!known) {
        warnings.push(`unknown_place_id:${String(inp.place_id).slice(0, 8)}…`);
        continue;
      }
      const score = Math.max(0, Math.min(100, Math.round(Number(inp.score) || 0)));
      if (score < 50) {
        // Treat sub-threshold scores as "not trending" — we don't write them.
        continue;
      }
      matches.push({
        place_id: inp.place_id,
        score,
        source: ["tiktok", "instagram", "both", "web"].includes(inp.source)
          ? inp.source
          : "web",
        evidence_url: String(inp.evidence_url ?? "").slice(0, 600),
        evidence_snippet: inp.evidence_snippet
          ? String(inp.evidence_snippet).slice(0, 200)
          : undefined,
      });
    }
  }

  // De-dup by place_id (keep highest score).
  const byId = new Map<string, TrendingMatch>();
  for (const m of matches) {
    const cur = byId.get(m.place_id);
    if (!cur || m.score > cur.score) byId.set(m.place_id, m);
  }
  const finalMatches = Array.from(byId.values());

  const usage = data.usage ?? {};
  const inputTokens = Number(usage.input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);

  // Sonnet 4.6: input $3/MTok, output $15/MTok. Web search: $10/1000.
  const costUsd =
    (inputTokens / 1_000_000) * 3 +
    (outputTokens / 1_000_000) * 15 +
    (searches / 1000) * 10;

  return {
    city: cityLabel,
    matches: finalMatches,
    searches,
    durationMs: Date.now() - startedAt,
    inputTokens,
    outputTokens,
    costUsd,
    warnings,
  };
}

// ── Apply matches to the DB ──────────────────────────────────────────────
// Two-phase: (1) clear stale rows in the city (so the scan acts as a
// snapshot, not an append-only log), (2) write fresh rows for matches.
// Stale = trending_updated_at older than 14 days OR a place that's no longer
// matched in this scan.

export async function applyMatches(
  supabase: SupabaseClient,
  cityKey: string,
  cityLabel: string,
  matches: TrendingMatch[],
): Promise<{ written: number; cleared: number }> {
  const now = new Date().toISOString();

  // Clear places in this city whose previous score is stale or NOT in the
  // current match set. Keeps the "trending" surface honest — old viral
  // mentions decay automatically.
  const matchedIds = new Set(matches.map((m) => m.place_id));

  // 1) Find all currently-trending places in this city
  const { data: currentRows } = await supabase
    .from("places")
    .select("id")
    .or(`city.eq.${cityKey},city_label.eq.${cityLabel}`)
    .not("trending_score", "is", null);

  const toClear = (currentRows ?? [])
    .map((r) => r.id)
    .filter((id) => !matchedIds.has(id));

  let cleared = 0;
  if (toClear.length > 0) {
    const { error } = await supabase
      .from("places")
      .update({
        trending_score: null,
        trending_source: null,
        trending_updated_at: null,
        trending_evidence: null,
      })
      .in("id", toClear);
    if (!error) cleared = toClear.length;
  }

  // 2) Write fresh matches
  let written = 0;
  for (const m of matches) {
    const evidence = [
      {
        url: m.evidence_url,
        platform:
          m.source === "tiktok" || m.source === "instagram"
            ? m.source
            : ("web" as const),
        ...(m.evidence_snippet ? { snippet: m.evidence_snippet } : {}),
        found_at: now,
      },
    ];
    const { error } = await supabase
      .from("places")
      .update({
        trending_score: m.score,
        trending_source: m.source,
        trending_updated_at: now,
        trending_evidence: evidence,
      })
      .eq("id", m.place_id);
    if (!error) written++;
  }

  return { written, cleared };
}
