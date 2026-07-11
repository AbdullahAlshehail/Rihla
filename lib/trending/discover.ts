// ⚠️ SUPERSEDED (2026-07): the discovery pipeline in this file (discoverCity)
// is replaced by lib/trending/v2/engine.ts — deterministic in-code scoring,
// multi-evidence aggregation, candidate registry. This file is kept only for
// `normalizeVenueName` (still consumed by lib/discover/filters.test.ts) and
// as reference; the admin route no longer calls discoverCity.
//
// Trending DISCOVERY — finds venues that became viral in the last 14 days
// and ADDS the genuinely-new ones to the catalogue.
//
// The existing scan.ts is a MATCHER: it can only re-score places already in
// `places`. This module is the DISCOVERER: it extracts venue NAMES from
// fresh social/web results, dedups them against everything we already know,
// and resolves only the truly-new names through Google Places.
//
// Pipeline (cost note per step):
//   1. Brave search, 14-day freshness window            — FREE (2000/mo tier)
//   2. Haiku extracts venue names + evidence            — ~$0.01-0.02/scan
//   3. Dedup vs seen-set + catalogue (normalized names) — FREE (DB reads)
//   4. Google Text Search for NEW names only            — free tier, guarded
//      by checkBudget('places_search') inside searchPlaces(); if the guard
//      refuses, the name is recorded as 'deferred' and NO money is spent.
//   5. Insert new place + trend evidence; record every name in
//      trend_discovery_seen so a re-scan never re-resolves (cost → ~$0).
//
// Append-only: nothing here deletes or clears trend data. Evidence refreshes
// go through applyMatches (overwrite-with-newer, never null).
//
// DRY-RUN: dryRun:true runs steps 1-3 only — zero Google calls, zero writes —
// and returns the list of venues the engine WOULD resolve/add.

import type { SupabaseClient } from "@supabase/supabase-js";
import { braveMulti, freshnessLastDays, type BraveResult } from "@/lib/trending/braveSearch";
import {
  applyMatches, FOCUS_LABEL_AR, FOCUS_QUERY_EN,
  type CategoryFocus, type TrendingMatch,
} from "@/lib/trending/scan";
import { searchPlaces, type GPlace } from "@/lib/google/places";
import { checkBudget } from "@/lib/google/budgetGuard";
import { categoryFromTypes, kindFromTypes } from "@/lib/google/placeCategory";
import { getCached, setCached } from "@/lib/cache/apiCache";
import { isSpecificEvidence, isDirectPost } from "@/lib/trending/evidence";
import { isReligiousPlace } from "@/lib/highlights";
import { haversineKm } from "@/lib/utils";

// ── Tunables ─────────────────────────────────────────────────────────────

/** "Trending" = evidence from the last N days. Owner definition: 2 weeks. */
export const DISCOVERY_WINDOW_DAYS = 14;
/** Hard cap on venue names Haiku may report per scan (bounds processing). */
const MAX_EXTRACTED_VENUES = 25;
/** Hard cap on Google resolves per run (bounds cost + Netlify 30s budget). */
export const DEFAULT_MAX_RESOLVES = 10;
/** 'unresolved' names are retried after this many days (venue may appear on
 *  Google later); 'added'/'existing' are terminal; 'deferred' retries next run. */
const UNRESOLVED_RETRY_DAYS = 30;
/** A resolved place must sit within this range of the city centroid. */
const MAX_KM_FROM_CITY = 60;

const MODEL = "claude-haiku-4-5-20251001";

// ── Types ────────────────────────────────────────────────────────────────

export type DiscoveredVenue = {
  name: string;
  name_ar?: string;
  evidence_url: string;
  evidence_snippet?: string;
  source: "tiktok" | "instagram" | "both" | "web";
  score: number; // 50-100
};

export type DiscoveryClassified = DiscoveredVenue & {
  normalized: string;
  outcome:
    | "would_add"        // dry-run: would resolve through Google
    | "added"            // resolved + inserted into places
    | "existing"         // already in catalogue (by name or google_place_id)
    | "seen_skip"        // seen-set says terminal/recently-unresolved
    | "deferred"         // budget guard refused — no money spent
    | "unresolved";      // Google had no usable match
  place_id?: string;
};

export type DiscoveryReport = {
  city: string;
  cityKey: string;
  dryRun: boolean;
  discovered: number;            // venue names extracted from fresh evidence
  venues: DiscoveryClassified[];
  added: number;                 // new places inserted
  refreshedExisting: number;     // known places whose evidence was refreshed
  deferred: number;
  unresolved: number;
  skippedSeen: number;
  resolveCalls: number;          // paid-surface Google calls actually made
  estimatedResolveCalls?: number; // dry-run: calls a real run would make
  budget?: { used: number; cap: number; monthlyCostUsd: number };
  costUsd: number;               // Haiku cost (Brave is free)
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  warnings: string[];
};

// ── Name normalization (dedup key) ───────────────────────────────────────
// Conservative on purpose: strip diacritics/punctuation/leading articles and
// unify Arabic letter variants, but keep meaningful words ("café", "beach")
// so two different venues can't collapse into one key.

export function normalizeVenueName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")      // latin diacritics (é → e)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "") // arabic diacritics + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")     // punctuation → space
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|le|la|les|el|al) /, "")
    .replace(/^ال(?=\S{3,})/, "");
}

/** Loose same-venue test for catalogue matching: exact normalized equality,
 *  or one name containing the other (≥5 chars — avoids short false merges). */
function namesLooselyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 5 && longer.includes(shorter);
}

/** Token-overlap similarity for verifying a Google resolve (0..1). */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

// Words that appear in half the venue names on earth — matching one of these
// in an evidence snippet proves nothing about THIS venue.
const GENERIC_NAME_TOKENS = new Set([
  "cafe", "coffee", "restaurant", "bistro", "brasserie", "bar", "rooftop",
  "beach", "plage", "club", "lounge", "house", "shop", "store", "grand",
  "petit", "grande", "royal", "maison", "chez", "villa", "jardin", "garden",
  "park", "parc", "musee", "museum", "hotel", "مقهي", "مقهى", "كافيه", "كوفي",
  "مطعم", "شاطئ", "حديقه", "متحف", "قهوه", "بار",
]);

/** Owner rule: the evidence result must plausibly NAME the venue — at least
 *  one distinctive token of the venue's name (len ≥ 4, not a generic word)
 *  must appear in the result's title/description/URL, or the whole
 *  normalized name is contained in it. */
function evidenceNamesVenue(
  normName: string, normNameAr: string | null, result: BraveResult,
): boolean {
  let urlText = result.url;
  try { urlText = decodeURIComponent(result.url); } catch { /* keep raw */ }
  const haystack = normalizeVenueName(`${result.title} ${result.description} ${urlText.replace(/[-_/+.]/g, " ")}`);
  for (const cand of [normName, normNameAr].filter(Boolean) as string[]) {
    if (cand.length >= 5 && haystack.includes(cand)) return true;
    const distinctive = cand.split(" ")
      .filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t));
    if (distinctive.some((t) => haystack.includes(t))) return true;
  }
  return false;
}

// ── Step 1-2: Brave (fresh, free) + Haiku extraction (cheap) ─────────────

const REPORT_NEW_VENUE_TOOL = {
  name: "report_new_venue",
  description:
    "Report ONE specific venue (café, restaurant, dessert shop, bar/rooftop, attraction, nature spot, or entertainment venue) that the fresh search results show people are talking about RIGHT NOW. Call once per venue. Never invent venues or URLs.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description:
          "The venue's proper name exactly as spelled in the source. Keep the original Latin spelling when available (e.g. 'Café Marinette', not a transliteration).",
      },
      name_ar: {
        type: "string",
        description: "Arabic name/spelling if the source is Arabic (optional).",
      },
      evidence_url: {
        type: "string",
        description: "MUST be one of the URLs from the SEARCH RESULTS list.",
      },
      source: {
        type: "string",
        enum: ["tiktok", "instagram", "both", "web"],
        description: "Where the buzz lives. 'both' only if seen on both platforms.",
      },
      score: {
        type: "integer", minimum: 50, maximum: 100,
        description:
          "Virality now: 50-64 = named in 1-2 fresh results; 65-79 = multiple fresh mentions or a TikTok/IG post about it; 80-100 = clearly going viral (several fresh results / platforms).",
      },
      evidence_snippet: {
        type: "string",
        description: "Short quote/paraphrase (≤120 chars) of the evidence.",
      },
    },
    required: ["name", "evidence_url", "source", "score"],
  },
};

function buildExtractionPrompt(
  cityLabel: string, focus: CategoryFocus, results: BraveResult[],
): string {
  const focusLine = focus === "all"
    ? "any kind of visitable venue (restaurants, cafés, dessert shops, bars/rooftops, attractions, nature spots, entertainment)"
    : FOCUS_QUERY_EN[focus];
  const resultsText = results.map((r, i) =>
    `[${i + 1}] ${r.title.slice(0, 100)}\n    URL: ${r.url}\n    ${r.description.slice(0, 200)}${r.age ? ` (${r.age})` : ""}`,
  ).join("\n\n");

  return `You are a trend scout for Saudi/Arab travelers. Below are fresh web results (ALL from the last ${DISCOVERY_WINDOW_DAYS} days — TikTok, Instagram, blogs) about **${cityLabel}**, focused on: ${focusLine}.

Your job: extract the SPECIFIC venues (by name) that these fresh results show people are talking about right now, and call **report_new_venue** once per venue.

Rules:
- Only venues a traveler can physically visit in ${cityLabel}. Skip hotels, supermarkets, brands without a location, neighborhoods, whole cities, festivals without a venue, and religious sites (mosques/churches).
- The venue must be NAMED in the result you cite — its name visible in that result's title, description, or URL. Generic mentions ("great cafés in ${cityLabel}") don't count.
- evidence_url MUST be copied from the SEARCH RESULTS below — never fabricate.
- evidence_url MUST be VENUE-SPECIFIC: a TikTok video (/@user/video/…), an Instagram post/reel (/p/… or /reel/…), or a dated article that names the venue. Aggregation/search pages (tiktok.com/discover/…, tag/explore pages, google search links) are NOT evidence — venues backed only by such pages are rejected server-side, so skip them.
- Prefer results where the venue name is explicit in the title/URL over ones where it's only implied.
- A venue named in MULTIPLE fresh results deserves a higher score.
- New openings and lesser-known spots being posted about are exactly what we want — include them even if they sound small.
- Report at most ${MAX_EXTRACTED_VENUES} venues. Quality over quantity; if a result names nothing specific, report nothing from it.

SEARCH RESULTS:
${resultsText}`;
}

async function extractVenues(opts: {
  cityKey: string;
  cityLabel: string;
  categoryFocus: CategoryFocus;
}): Promise<{
  venues: DiscoveredVenue[];
  costUsd: number; inputTokens: number; outputTokens: number;
  warnings: string[];
}> {
  const { cityKey, cityLabel, categoryFocus } = opts;
  const warnings: string[] = [];
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("anthropic_key_missing");
  if (!process.env.BRAVE_API_KEY) throw new Error("brave_key_missing_for_discovery");

  // Brave fanout — discovery-shaped queries (new/opening/viral), exact
  // 14-day freshness. Free; cached 6h so repeated dry-runs don't re-fan-out.
  const freshness = freshnessLastDays(DISCOVERY_WINDOW_DAYS);
  const focusEn = categoryFocus === "all" ? "places" : FOCUS_QUERY_EN[categoryFocus];
  const focusAr = categoryFocus === "all" ? "اماكن" : FOCUS_LABEL_AR[categoryFocus];
  const queries = [
    `tiktok viral ${focusEn} ${cityLabel}`,
    `new ${focusEn} ${cityLabel} opening 2026`,
    `instagram ${focusEn} ${cityLabel}`,
    `${focusAr} جديده ${cityLabel} تيك توك`,
    `افتتاح ${focusAr} ${cityLabel}`,
  ];

  const cacheParams = { kind: "discover", cityKey, focus: categoryFocus, freshness };
  let results = await getCached<BraveResult[]>("brave_search", cacheParams);
  if (!results) {
    results = await braveMulti(queries, 10, freshness);
    if (results.length > 0) await setCached("brave_search", cacheParams, results);
  }
  if (results.length === 0) {
    return { venues: [], costUsd: 0, inputTokens: 0, outputTokens: 0, warnings: ["brave_no_fresh_results"] };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3072,
      tools: [REPORT_NEW_VENUE_TOOL],
      messages: [{
        role: "user",
        content: buildExtractionPrompt(cityLabel, categoryFocus, results),
      }],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`anthropic_${resp.status}: ${text.slice(0, 300)}`);
  }
  const data = await resp.json();
  if (data.stop_reason === "max_tokens") warnings.push("truncated_at_max_tokens");

  // Validate tool calls — four gates, all server-side (never trust the LLM):
  //   1. evidence_url must come from the Brave set (no hallucinated URLs)
  //   2. evidence_url must be venue-specific (no discover/tag/search pages)
  //   3. the cited result must actually NAME the venue (title/desc/URL)
  //   4. direct posts (TikTok video / IG post) outrank article mentions —
  //      a venue proven only by a listicle can't score above 75.
  const braveByUrl = new Map(results.map((r) => [r.url, r]));
  const byNorm = new Map<string, DiscoveredVenue>();
  for (const block of (data.content ?? [])) {
    if (block?.type !== "tool_use" || block?.name !== "report_new_venue") continue;
    const inp = block.input ?? {};
    const name = String(inp.name ?? "").trim();
    const evidenceUrl = String(inp.evidence_url ?? "");
    if (name.length < 3) continue;
    const braveResult = braveByUrl.get(evidenceUrl);
    if (!braveResult) {
      warnings.push(`fabricated_url:${name.slice(0, 24)}`);
      continue;
    }
    if (!isSpecificEvidence(evidenceUrl)) {
      warnings.push(`generic_evidence_rejected:${name.slice(0, 24)}`);
      continue;
    }
    const norm = normalizeVenueName(name);
    if (!norm) continue;
    const normAr = inp.name_ar ? normalizeVenueName(String(inp.name_ar)) : null;
    if (!evidenceNamesVenue(norm, normAr, braveResult)) {
      warnings.push(`evidence_does_not_name_venue:${name.slice(0, 24)}`);
      continue;
    }
    let score = Math.max(50, Math.min(100, Math.round(Number(inp.score) || 50)));
    if (!isDirectPost(evidenceUrl)) score = Math.min(score, 75);
    const venue: DiscoveredVenue = {
      name,
      name_ar: inp.name_ar ? String(inp.name_ar).slice(0, 120) : undefined,
      evidence_url: evidenceUrl.slice(0, 600),
      evidence_snippet: inp.evidence_snippet ? String(inp.evidence_snippet).slice(0, 200) : undefined,
      source: ["tiktok", "instagram", "both", "web"].includes(inp.source) ? inp.source : "web",
      score,
    };
    const cur = byNorm.get(norm);
    if (!cur || venue.score > cur.score) byNorm.set(norm, venue);
  }

  const usage = data.usage ?? {};
  const inputTokens = Number(usage.input_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  const costUsd = (inputTokens / 1_000_000) * 1.0 + (outputTokens / 1_000_000) * 5.0;

  return {
    venues: Array.from(byNorm.values()).slice(0, MAX_EXTRACTED_VENUES),
    costUsd, inputTokens, outputTokens, warnings,
  };
}

// ── Step 3-5: dedup → guarded resolve → persist ──────────────────────────

type CatalogueRow = { id: string; name: string; google_place_id: string | null; lat: number | null; lng: number | null };
type SeenRow = { normalized_name: string; resolution: string; last_seen_at: string };

export async function discoverCity(opts: {
  supabase: SupabaseClient;
  cityKey: string;
  cityLabel: string;
  categoryFocus?: CategoryFocus;
  dryRun?: boolean;
  maxResolves?: number;
  userId?: string;
}): Promise<DiscoveryReport> {
  const {
    supabase, cityKey, cityLabel,
    categoryFocus = "all", dryRun = false,
    maxResolves = DEFAULT_MAX_RESOLVES, userId,
  } = opts;
  const startedAt = Date.now();
  const warnings: string[] = [];
  const now = new Date().toISOString();

  // 1-2) Fresh evidence → venue names.
  const extraction = await extractVenues({ cityKey, cityLabel, categoryFocus });
  warnings.push(...extraction.warnings);

  // 3) Load what we already know — one catalogue read + one seen-set read.
  const [catalogueR, seenR] = await Promise.all([
    supabase
      .from("places")
      .select("id,name,google_place_id,lat,lng")
      .or(`city.eq.${cityKey},city_label.eq.${cityLabel}`),
    supabase
      .from("trend_discovery_seen")
      .select("normalized_name,resolution,last_seen_at")
      .eq("city_key", cityKey),
  ]);
  if (catalogueR.error) throw new Error(`catalogue_read_failed: ${catalogueR.error.message}`);
  // Seen table may not exist yet (migration pending) — degrade to empty set
  // with a warning rather than failing the whole scan.
  const seenRows: SeenRow[] = seenR.error ? [] : ((seenR.data ?? []) as SeenRow[]);
  if (seenR.error) warnings.push("seen_table_unavailable_run_migration");

  const catalogue = (catalogueR.data ?? []) as CatalogueRow[];
  const catalogueByNorm = catalogue.map((r) => ({ ...r, norm: normalizeVenueName(r.name) }));
  const catalogueByGpid = new Map<string, CatalogueRow>();
  for (const r of catalogue) if (r.google_place_id) catalogueByGpid.set(r.google_place_id, r);
  const seenByNorm = new Map(seenRows.map((s) => [s.normalized_name, s]));

  // City centroid from the catalogue (free) — anchors resolve verification.
  let centroid: { lat: number; lng: number } | null = null;
  {
    const pts = catalogue.filter((r) => r.lat != null && r.lng != null);
    if (pts.length >= 3) {
      centroid = {
        lat: pts.reduce((s, r) => s + (r.lat as number), 0) / pts.length,
        lng: pts.reduce((s, r) => s + (r.lng as number), 0) / pts.length,
      };
    }
  }

  // Classify every extracted venue BEFORE any paid call.
  const classified: DiscoveryClassified[] = [];
  const toResolve: DiscoveryClassified[] = [];
  const evidenceRefresh: TrendingMatch[] = [];   // known places → refresh (append-only)
  const seenTouch: Array<{ normalized_name: string; resolution: string }> = [];

  for (const v of extraction.venues) {
    const norm = normalizeVenueName(v.name);
    const normAr = v.name_ar ? normalizeVenueName(v.name_ar) : null;
    const entry: DiscoveryClassified = { ...v, normalized: norm, outcome: "would_add" };

    // (a) catalogue by normalized name — known place, DON'T call Google.
    const known = catalogueByNorm.find((c) =>
      namesLooselyMatch(norm, c.norm) || (normAr ? namesLooselyMatch(normAr, c.norm) : false));
    if (known) {
      entry.outcome = "existing";
      entry.place_id = known.id;
      classified.push(entry);
      if (!dryRun) {
        evidenceRefresh.push({
          place_id: known.id, score: v.score, source: v.source,
          evidence_url: v.evidence_url, evidence_snippet: v.evidence_snippet,
        });
        seenTouch.push({ normalized_name: norm, resolution: "existing" });
      }
      continue;
    }

    // (b) seen-set — terminal resolutions never re-resolve; recent
    // 'unresolved' waits out its retry window; 'deferred' retries now.
    const seen = seenByNorm.get(norm) ?? (normAr ? seenByNorm.get(normAr) : undefined);
    if (seen) {
      const ageDays = (Date.now() - Date.parse(seen.last_seen_at)) / 86_400_000;
      const retryable =
        seen.resolution === "deferred" ||
        (seen.resolution === "unresolved" && ageDays >= UNRESOLVED_RETRY_DAYS);
      if (!retryable) {
        entry.outcome = "seen_skip";
        classified.push(entry);
        if (!dryRun) seenTouch.push({ normalized_name: norm, resolution: seen.resolution });
        continue;
      }
    }

    // (c) genuinely new → resolve queue (capped).
    toResolve.push(entry);
  }

  // Budget snapshot for the report (read-only, free).
  const budget = await checkBudget("places_search");

  let resolveCalls = 0;

  if (dryRun) {
    // ZERO Google calls, ZERO writes. Report what a real run would do.
    for (const entry of toResolve) classified.push(entry); // outcome stays "would_add"
  } else {
    // 4) Resolve NEW names through the guarded Google path. searchPlaces
    // internally: cache → checkBudget → fetch → api_usage_log. A budget
    // refusal comes back as mock:true with no spend.
    const queue = toResolve.slice(0, maxResolves);
    for (const entry of toResolve.slice(maxResolves)) {
      entry.outcome = "deferred";
      classified.push(entry);
      seenTouch.push({ normalized_name: entry.normalized, resolution: "deferred" });
      warnings.push(`resolve_cap_deferred:${entry.name.slice(0, 24)}`);
    }

    const resolved = await Promise.all(queue.map(async (entry) => {
      const r = await searchPlaces({
        query: `${entry.name} ${cityLabel}`,
        lat: centroid?.lat, lng: centroid?.lng,
        radius: 30_000,
        userId: userId ?? null,
      });
      return { entry, r };
    }));

    const inserts: Array<{ entry: DiscoveryClassified; gp: GPlace }> = [];

    for (const { entry, r } of resolved) {
      if (!r.cached) resolveCalls++;
      if (r.mock) {
        // Budget guard refused (or key missing) — record, spend nothing.
        entry.outcome = "deferred";
        classified.push(entry);
        seenTouch.push({ normalized_name: entry.normalized, resolution: "deferred" });
        continue;
      }
      // Verify the top candidates: near the city + name actually similar.
      const pick = r.places.find((gp) => {
        if (!gp.id) return false;
        if (centroid && gp.location &&
            haversineKm({ lat: gp.location.latitude, lng: gp.location.longitude }, centroid) > MAX_KM_FROM_CITY) {
          return false;
        }
        const gpNorm = normalizeVenueName(gp.displayName?.text ?? "");
        return namesLooselyMatch(entry.normalized, gpNorm) || tokenOverlap(entry.normalized, gpNorm) >= 0.5;
      });
      if (!pick) {
        entry.outcome = "unresolved";
        classified.push(entry);
        seenTouch.push({ normalized_name: entry.normalized, resolution: "unresolved" });
        continue;
      }
      // Dedup AGAIN by google_place_id — Google may return a place we
      // already have under a different name/spelling.
      const dup = catalogueByGpid.get(pick.id);
      if (dup) {
        entry.outcome = "existing";
        entry.place_id = dup.id;
        classified.push(entry);
        evidenceRefresh.push({
          place_id: dup.id, score: entry.score, source: entry.source,
          evidence_url: entry.evidence_url, evidence_snippet: entry.evidence_snippet,
        });
        seenTouch.push({ normalized_name: entry.normalized, resolution: "existing" });
        continue;
      }
      // Religious venues are excluded from the product (app-wide rule).
      const gpName = pick.displayName?.text ?? entry.name;
      if (isReligiousPlace({ kind: pick.primaryType ?? null, name: gpName })) {
        entry.outcome = "unresolved";
        classified.push(entry);
        seenTouch.push({ normalized_name: entry.normalized, resolution: "unresolved" });
        continue;
      }
      inserts.push({ entry, gp: pick });
    }

    // 5) INSERT the truly-new places (base row), then write trend fields +
    // trend_sources + verification through applyMatches — the same
    // append-only writer the matcher uses (evidence verified via HEAD).
    for (const { entry, gp } of inserts) {
      const types = gp._legacy?.types ?? (gp.primaryType ? [gp.primaryType] : []);
      const category = categoryFromTypes(types);
      const insertRow = {
        google_place_id: gp.id,
        external_source: "trend_discovery",
        name: gp.displayName?.text ?? entry.name,
        category,
        kind: kindFromTypes(types, category),
        city: cityKey.toLowerCase(),
        city_label: cityLabel,
        lat: gp.location?.latitude ?? null,
        lng: gp.location?.longitude ?? null,
        address: gp.formattedAddress ?? null,
        rating: gp.rating ?? null,
        review_count: gp.userRatingCount ?? null,
        price_level: gp._legacy?.price_level_num ?? null,
        cost_currency: "EUR",
        cost_confidence: "low",
        google_maps_url: gp.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${gp.id}`,
        is_editor_pick: false,
      };
      const { data: inserted, error } = await supabase
        .from("places")
        .insert(insertRow)
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") {
          // google_place_id unique race — someone inserted it since our read.
          const { data: dup } = await supabase
            .from("places").select("id").eq("google_place_id", gp.id).single();
          if (dup) {
            entry.outcome = "existing";
            entry.place_id = dup.id;
            classified.push(entry);
            evidenceRefresh.push({
              place_id: dup.id, score: entry.score, source: entry.source,
              evidence_url: entry.evidence_url, evidence_snippet: entry.evidence_snippet,
            });
            seenTouch.push({ normalized_name: entry.normalized, resolution: "existing" });
            continue;
          }
        }
        warnings.push(`insert_failed:${entry.name.slice(0, 24)}:${error.message.slice(0, 60)}`);
        entry.outcome = "unresolved";
        classified.push(entry);
        continue;
      }
      entry.outcome = "added";
      entry.place_id = inserted.id;
      classified.push(entry);
      evidenceRefresh.push({
        place_id: inserted.id, score: entry.score, source: entry.source,
        evidence_url: entry.evidence_url, evidence_snippet: entry.evidence_snippet,
      });
      await supabase.from("trend_discovery_seen").upsert({
        city_key: cityKey,
        normalized_name: entry.normalized,
        raw_name: entry.name,
        google_place_id: gp.id,
        place_id: inserted.id,
        resolution: "added",
        evidence_url: entry.evidence_url,
        last_seen_at: now,
      }, { onConflict: "city_key,normalized_name" });
    }

    // Evidence writes — applyMatches is append-only (overwrites with newer,
    // never nulls) and fills trending_first_seen_at where it's still null.
    if (evidenceRefresh.length > 0) {
      await applyMatches(supabase, cityKey, cityLabel, evidenceRefresh, {
        query: `discover:${categoryFocus}`,
      });
    }

    // Seen-set bookkeeping for everything except 'added' (written above).
    if (seenTouch.length > 0) {
      const rows = seenTouch.map((s) => {
        const src = classified.find((c) => c.normalized === s.normalized_name);
        return {
          city_key: cityKey,
          normalized_name: s.normalized_name,
          raw_name: src?.name ?? null,
          place_id: src?.place_id ?? null,
          resolution: s.resolution,
          evidence_url: src?.evidence_url ?? null,
          last_seen_at: now,
        };
      });
      const { error } = await supabase
        .from("trend_discovery_seen")
        .upsert(rows, { onConflict: "city_key,normalized_name" });
      if (error) warnings.push(`seen_upsert_failed:${error.message.slice(0, 60)}`);
    }
  }

  const count = (o: DiscoveryClassified["outcome"]) => classified.filter((c) => c.outcome === o).length;

  return {
    city: cityLabel,
    cityKey,
    dryRun,
    discovered: extraction.venues.length,
    venues: classified,
    added: count("added"),
    refreshedExisting: count("existing"),
    deferred: count("deferred"),
    unresolved: count("unresolved"),
    skippedSeen: count("seen_skip"),
    resolveCalls,
    ...(dryRun ? { estimatedResolveCalls: Math.min(toResolve.length, maxResolves) } : {}),
    budget: { used: budget.used, cap: budget.cap, monthlyCostUsd: budget.monthlyCostUsd },
    costUsd: extraction.costUsd,
    inputTokens: extraction.inputTokens,
    outputTokens: extraction.outputTokens,
    durationMs: Date.now() - startedAt,
    warnings,
  };
}
