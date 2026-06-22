// Trending scan — TikTok / Instagram social-virality detector.
//
// For a given city, ask Anthropic Claude (Haiku 4.5) with the built-in
// web_search tool to find places that are currently viral on TikTok and
// Instagram, then match each viral mention against our catalogue and write
// back a `trending_score` (0-100), `trending_source`, and evidence URL list.
//
// Cost ceiling: ANY single scan that exceeds $1 is flagged as a warning.
// Realistic cost with Haiku 4.5 + 3 web searches + 80 candidates: ~$0.05/city.
// Hard caps below are sized to keep that ceiling unreachable in normal use:
//   • model: Haiku 4.5 (input $1/MTok, output $5/MTok — 3× cheaper than Sonnet)
//   • max_uses: 3 (was 6) — web search at $10/1K = $0.03 max from searches
//   • candidates: 80 (was 150) — ~6 KB catalogue text, well under 10 KB
//   • max_tokens: 2048 (was 4096) — output capped — never spends > $0.01 on tokens
//   • prompt caching on the catalogue list — repeat scans reuse cached input
//
// Time: ~10-15s per city. Stays within Netlify's 30s function ceiling.

import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { platformFromUrl, verifyUrls, type VerificationKind } from "@/lib/trending/verify";

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
  verification?: VerificationKind;   // populated by applyMatches HEAD pass
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
// low (~80 candidates × 80 chars ≈ 6 KB) and gives Claude a focused match
// set so it doesn't hallucinate IDs.

const MAX_CANDIDATES_PER_CITY = 80;
const MAX_WEB_SEARCHES = 3;
const COST_CEILING_USD = 1.0;

export async function pickCandidates(
  supabase: SupabaseClient,
  cityFilter: { city?: string; city_label?: string },
): Promise<ScanCandidate[]> {
  // OR (city = X OR city_label = Y) — strict AND missed cities where the
  // catalogue had inconsistent `city` slugs (e.g. Monaco has 305 rows with
  // city='monaco' AND a stray row with city='موناكو'; the strict AND
  // intersection returned only that stray row when the resolution picked
  // the Arabic city as the key).
  const orParts: string[] = [];
  if (cityFilter.city) orParts.push(`city.eq.${cityFilter.city}`);
  if (cityFilter.city_label) orParts.push(`city_label.eq.${cityFilter.city_label}`);
  if (orParts.length === 0) {
    throw new Error("pickCandidates: at least one of city / city_label is required");
  }

  const { data, error } = await supabase
    .from("places")
    .select("id,name,category,rating,review_count,city,city_label")
    .gte("rating", 4.0)
    .gte("review_count", 30)
    .or(orParts.join(","))
    .order("review_count", { ascending: false })
    .limit(MAX_CANDIDATES_PER_CITY);

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

const MODEL = "claude-haiku-4-5-20251001";

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

export type CategoryFocus =
  | "all"
  | "food"          // مطاعم
  | "coffee"        // قهاوي
  | "brunch"        // برانش (kind hint inside food)
  | "breakfast"     // فطور (kind hint inside food)
  | "sight"         // معالم
  | "nature"        // طبيعة
  | "sweet"         // حلويات
  | "event"         // ترفيه
  | "bar";          // بارات

const FOCUS_LABEL_AR: Record<CategoryFocus, string> = {
  all: "كل الأنواع",
  food: "المطاعم",
  coffee: "القهاوي",
  brunch: "أماكن البرانش",
  breakfast: "أماكن الفطور",
  sight: "المعالم السياحية",
  nature: "الأماكن الطبيعية",
  sweet: "محلات الحلويات",
  event: "أماكن الترفيه",
  bar: "البارات والروف-توب",
};

const FOCUS_PROMPT_EN: Record<CategoryFocus, string> = {
  all: "all kinds of places (restaurants, sights, cafés, brunch, etc.)",
  food: "restaurants and dining spots",
  coffee: "specialty coffee shops and cafés",
  brunch: "brunch spots and weekend-brunch destinations (mid-morning food + drinks)",
  breakfast: "breakfast cafés and early-morning eateries",
  sight: "tourist attractions, museums, monuments and viewpoints",
  nature: "parks, gardens, beaches and outdoor nature spots",
  sweet: "dessert shops, ice cream parlors and bakeries",
  event: "entertainment venues, theaters, concert halls and event spaces",
  bar: "bars, rooftops, lounges and night-life spots",
};

export async function scanCity(opts: {
  cityKey: string;
  cityLabel: string;
  candidates: ScanCandidate[];
  categoryFocus?: CategoryFocus;
}): Promise<ScanResult> {
  const { cityKey, cityLabel, candidates, categoryFocus = "all" } = opts;
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

  const focusLine = categoryFocus === "all"
    ? ""
    : `\n\n🎯 **FOCUS for this run**: search ONLY for **${FOCUS_PROMPT_EN[categoryFocus]}**. Skip places that don't fit this niche, even if otherwise viral.`;

  const userMessage = `You are finding the places in **${cityLabel}** that are popular on TikTok and Instagram for Saudi/Arab travelers planning a trip. (catalogue key: ${cityKey})${focusLine}

What counts as "trending":
- Places repeatedly featured in TikTok/Instagram travel content, hashtag tags, or Reels
- "Top X places to visit in ${cityLabel}" listicle / blog mentions from 2025-2026
- Spots with viral moments (a famous food shot, a celebrity visit, a meme)
- Iconic landmarks that are CONSISTENTLY featured in social-media travel content
You do NOT need to find "going viral this week" — sustained social-media buzz is fine.

Process:
1. Search the web 2-3 times (hard cap of 3). Useful queries:
   - "tiktok ${cityLabel} top places 2026"
   - "instagram famous ${cityLabel}"
   - "best things to do in ${cityLabel} tiktok"
   - "اشهر اماكن ${cityLabel} تيك توك"
2. For each candidate that matches a social-media mention, call **save_trending** with the matching UUID. Aim to call it 3-6 times if you found that many strong matches.
3. Skip ambiguous matches — only call save_trending when you're confident the catalogue row is the same place.
4. **Verify the place is still operational** — if you find clear evidence a venue has closed permanently or hasn't reopened since a fire/renovation, DO NOT call save_trending for it.

CATALOGUE (place_id | name | category):
${catalogueText}

Scoring guidance:
- 50-64: Mentioned in 1-2 travel articles/listicles
- 65-79: Featured across multiple TikTok / Instagram posts or videos
- 80-100: Iconic, repeatedly viral, must-visit per social media

Rules:
- ONLY use UUIDs from the catalogue above. Never invent IDs.
- Skip generic mentions ("${cityLabel} has great food"). Need a specific named venue.
- Don't double-call for the same place_id.
- Better to call save_trending 3-5 times with score 50-70 than to call 0 times. Empty results are the worst outcome.`;

  // Split the user message into two text blocks so we can cache the heavy
  // catalogue list (~6 KB) — re-scans within 5 minutes pay 0.1× the input
  // price on the cached block. Halves the cost on a re-scan of the same city.
  const instructionsPart = userMessage.split("CATALOGUE")[0];
  const cataloguePart = "CATALOGUE" + (userMessage.split("CATALOGUE")[1] ?? "");

  const body = {
    model: MODEL,
    max_tokens: 2048,
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: MAX_WEB_SEARCHES },
      SAVE_TRENDING_TOOL,
    ],
    messages: [{
      role: "user" as const,
      content: [
        { type: "text", text: instructionsPart },
        // cache_control: catalogue is static for the city — cheap re-scans
        { type: "text", text: cataloguePart, cache_control: { type: "ephemeral" } },
      ],
    }],
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
  // Track regular vs cached input tokens separately — cached are 0.1× price.
  const regularInput = Number(usage.input_tokens ?? 0);
  const cachedInput = Number(usage.cache_read_input_tokens ?? 0);
  const cacheCreationInput = Number(usage.cache_creation_input_tokens ?? 0);
  const inputTokens = regularInput + cachedInput + cacheCreationInput;
  const outputTokens = Number(usage.output_tokens ?? 0);

  // Haiku 4.5 pricing (per 1M tokens):
  //   input regular      $1.00
  //   cache write (5m)   $1.25
  //   cache read         $0.10
  //   output             $5.00
  // Web search: $10 per 1000 calls = $0.01 each.
  const costUsd =
    (regularInput / 1_000_000) * 1.0 +
    (cacheCreationInput / 1_000_000) * 1.25 +
    (cachedInput / 1_000_000) * 0.10 +
    (outputTokens / 1_000_000) * 5.0 +
    (searches / 1000) * 10;

  // Hard cost ceiling — warn (Anthropic already charged, can't refund). Future
  // scans of the same city in a 5-min window will be ~50% cheaper via cache.
  if (costUsd > COST_CEILING_USD) {
    warnings.push(`cost_exceeded_$${COST_CEILING_USD}:actual_$${costUsd.toFixed(3)}`);
  }

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
// Append-only: we NEVER clear an existing trending score, even if the latest
// scan didn't surface that place again. Rationale (per user request):
// trending data is precious — once we found that a place is viral, we keep
// the mark. If a fresh scan rediscovers the same place_id, we OVERWRITE with
// the newer evidence (latest URL wins).
//
// Side effect: scores accumulate over time. The UI can age them via
// `trending_updated_at` (e.g. dim scores older than X days) if needed, but
// the underlying row stays intact.

export async function applyMatches(
  supabase: SupabaseClient,
  cityKey: string,
  cityLabel: string,
  matches: TrendingMatch[],
  opts: { scanRunId?: string; query?: string } = {},
): Promise<{ written: number; cleared: 0; verified: number }> {
  void cityKey; void cityLabel;
  if (matches.length === 0) return { written: 0, cleared: 0, verified: 0 };
  const now = new Date().toISOString();

  // Parallel HEAD verification — caller waits ~3-4s once for all URLs.
  const verifications = await verifyUrls(matches.map((m) => m.evidence_url));

  let written = 0;
  let verified = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const verification: VerificationKind = verifications[i] ?? "pattern_only";
    if (verification === "verified") verified++;
    m.verification = verification;

    const platform = platformFromUrl(m.evidence_url) ?? "web";

    // 1) Append-only audit row in trend_sources. ON CONFLICT update last_verified_at.
    await supabase
      .from("trend_sources")
      .upsert(
        {
          place_id: m.place_id,
          platform,
          source_url: m.evidence_url,
          source_snippet: m.evidence_snippet ?? null,
          found_at: now,
          query: opts.query ?? null,
          confidence: m.score,
          verification,
          last_verified_at: now,
          scan_run_id: opts.scanRunId ?? null,
        },
        { onConflict: "place_id,source_url", ignoreDuplicates: false },
      );

    // 2) Denormalized fields on places — for fast filter reads.
    //    APPEND-ONLY: never null these out. Re-scan overwrites with newer evidence.
    const evidence = [
      {
        url: m.evidence_url,
        platform,
        verification,
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

  return { written, cleared: 0, verified };
}

// ── Run tracker ─────────────────────────────────────────────────────────
// Start: insert a row in trend_discovery_runs with status='running'.
// Finish: update it with the result. Lets the user audit ANY scan after the
// fact (cost, time, model, errors).

export async function startRun(
  supabase: SupabaseClient,
  city: { key: string; label: string },
  triggered_by: "manual" | "cron" | "script",
  user_id?: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("trend_discovery_runs")
    .insert({
      city_key: city.key,
      city_label: city.label,
      triggered_by,
      user_id: user_id ?? null,
      status: "running",
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function finishRun(
  supabase: SupabaseClient,
  runId: string | null,
  payload: {
    status: "ok" | "partial" | "failed";
    candidates_count?: number;
    matches_count?: number;
    new_count?: number;
    updated_count?: number;
    verified_count?: number;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    searches?: number;
    cost_usd?: number;
    duration_ms?: number;
    error?: string;
  },
): Promise<void> {
  if (!runId) return;
  await supabase
    .from("trend_discovery_runs")
    .update({ ...payload, completed_at: new Date().toISOString() })
    .eq("id", runId);
}
