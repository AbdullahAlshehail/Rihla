// Trend Discovery v2 — orchestrator. Implements the owner's staged funnel:
//
//   Stage 1  Brave (rotated queries, 14-day freshness, 12h cache)   ~free
//   Stage 2  rule-based parsing; LLM ONLY for nameless results,
//            ONE small batch, validated in code                     ~$0.005
//   Stage 3  normalize + aggregate evidence per venue               free
//   Stage 4  cheap rejection gate BEFORE any paid API               free
//   Stage 5  DETERMINISTIC trend score + classification (in code)   free
//   Stage 6  local DB first; Google Text Search only for the final
//            ≤3 candidates — identity confirmation ONLY             free tier
//   Stage 7  newness classification (separate from trend)           free
//   Stage 8  Candidate Registry upserts + retry windows             free
//   Stage 10 dry-run: full report table, ZERO mutations, ZERO Google
//
// Every external surface (Brave / LLM / Google / DB / clock / budget) is an
// injectable seam so fixture-driven tests exercise the exact production path.

import type { SupabaseClient } from "@supabase/supabase-js";
import { braveMulti, freshnessLastDays, type BraveResult } from "@/lib/trending/braveSearch";
import { getCached, setCached } from "@/lib/cache/apiCache";
import { checkBudget } from "@/lib/google/budgetGuard";
import { searchPlaces } from "@/lib/google/places";
import { categoryFromTypes, kindFromTypes } from "@/lib/google/placeCategory";
import { isReligiousPlace } from "@/lib/highlights";
import { haversineKm } from "@/lib/utils";
import { applyMatches } from "@/lib/trending/scan";
import { rotateQueries } from "@/lib/trending/v2/queries";
import { parseResult, isOfficialAccount } from "@/lib/trending/v2/parse";
import { anthropicExtract, type LlmExtractFn } from "@/lib/trending/v2/llm";
import { aggregateCandidates } from "@/lib/trending/v2/aggregate";
import {
  cheapRejectionGate, classifyNewness, classifyTrending, confidenceScore, trendScore,
} from "@/lib/trending/v2/score";
import {
  findLocalMatch, googleHitMatchesCandidate, googleRetryDecision, retryAfterFor,
  supabaseRegistryDb, type RegistryDb,
} from "@/lib/trending/v2/registry";
import { normalizeName, tokenOverlap } from "@/lib/trending/v2/normalize";
import type {
  CandidateAggregate, CandidateReportRow, CostSummary, DiscoveryV2Report,
  EvidenceRecord, FinalDecision, RegistryRow, RegistryStatus,
} from "@/lib/trending/v2/types";

// ── Per-run caps (Stage 9 cost control) ──────────────────────────────────

export const CAPS = {
  braveQueries: 8,
  resultsParsed: 30,
  candidatesAfterGrouping: 10,
  llmResults: 5,
  googleCalls: 3,
} as const;

/** Nominal Google Text Search price (per call). Effective $0 inside the
 *  5,000/month free tier — budgetGuard keeps us inside it. */
export const GOOGLE_TEXT_SEARCH_USD = 0.032;

// ── Seams ────────────────────────────────────────────────────────────────

export type BraveFn = (queries: string[], freshness: string) => Promise<BraveResult[]>;

export type GoogleLite = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  businessStatus: string | null;
  googleMapsUri: string | null;
  primaryType: string | null;
  types: string[];
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
};

export type GoogleFn = (query: string, bias?: { lat: number; lng: number }) =>
  Promise<{ mock: boolean; cached: boolean; places: GoogleLite[] }>;

export type BudgetFn = () => Promise<{ allowed: boolean; reason?: string }>;

export type EngineDeps = {
  brave: BraveFn;
  llm: LlmExtractFn | null;
  google: GoogleFn;
  db: RegistryDb;
  budget: BudgetFn;
  now: () => Date;
};

// ── Default (production) seam implementations ────────────────────────────

const BRAVE_CACHE_TTL_S = 12 * 3600; // owner spec: cache Brave results 12h

export function defaultBrave(cityKey: string): BraveFn {
  return async (queries, freshness) => {
    const cacheParams = { kind: "discover_v2", cityKey, queries, freshness };
    const cached = await getCached<BraveResult[]>("brave_search", cacheParams);
    if (cached) return cached;
    const results = await braveMulti(queries, 10, freshness);
    if (results.length > 0) {
      await setCached("brave_search", cacheParams, results, BRAVE_CACHE_TTL_S);
    }
    return results;
  };
}

export function defaultGoogle(userId?: string): GoogleFn {
  return async (query, bias) => {
    const r = await searchPlaces({
      query,
      lat: bias?.lat, lng: bias?.lng,
      radius: 30_000,
      userId: userId ?? null,
    });
    return {
      mock: r.mock,
      cached: r.cached,
      places: r.places.map((gp) => ({
        id: gp.id,
        name: gp.displayName?.text ?? "",
        lat: gp.location?.latitude ?? null,
        lng: gp.location?.longitude ?? null,
        businessStatus: gp._legacy?.business_status ?? null,
        googleMapsUri: gp.googleMapsUri ?? null,
        primaryType: gp.primaryType ?? null,
        types: gp._legacy?.types ?? (gp.primaryType ? [gp.primaryType] : []),
        address: gp.formattedAddress ?? null,
        rating: gp.rating ?? null,
        reviewCount: gp.userRatingCount ?? null,
      })),
    };
  };
}

// ── Report row assembly ──────────────────────────────────────────────────

type WorkItem = {
  c: CandidateAggregate;
  dbStatus: string;                   // status BEFORE this run
  registryRow: RegistryRow | null;
  cataloguePlaceId: string | null;
  decision: FinalDecision;
  reason: string;
  googleUsed: boolean;
  googleCost: number;
  registryStatus: RegistryStatus;
  googlePlaceId: string | null;
  googleBusinessStatus: string | null;
  nameConfirmed: boolean;
  suspectedDuplicate: boolean;
};

const MAX_KM_FROM_CITY = 60;

// ── The engine ───────────────────────────────────────────────────────────

export async function runDiscoveryV2(opts: {
  cityKey: string;
  cityLabel: string;
  dryRun: boolean;
  supabase?: SupabaseClient;          // needed for real-run persistence
  userId?: string;
  deps?: Partial<EngineDeps>;
  maxGoogleCalls?: number;
}): Promise<DiscoveryV2Report> {
  const { cityKey, cityLabel, dryRun } = opts;
  const startedAt = Date.now();
  const warnings: string[] = [];

  const deps: EngineDeps = {
    brave: opts.deps?.brave ?? defaultBrave(cityKey),
    llm: opts.deps?.llm !== undefined ? opts.deps.llm : anthropicExtract,
    google: opts.deps?.google ?? defaultGoogle(opts.userId),
    db: opts.deps?.db ?? (opts.supabase ? supabaseRegistryDb(opts.supabase) : missingDb()),
    budget: opts.deps?.budget ?? (async () => {
      const b = await checkBudget("places_search");
      return { allowed: b.allowed, reason: b.reason };
    }),
    now: opts.deps?.now ?? (() => new Date()),
  };
  const now = deps.now();
  const maxGoogle = Math.min(opts.maxGoogleCalls ?? CAPS.googleCalls, CAPS.googleCalls);

  // ── Stage 1: Brave (rotated, capped, 14-day freshness) ────────────────
  const queries = rotateQueries(now, { cityLabel }).slice(0, CAPS.braveQueries);
  const braveResults = await deps.brave(queries, freshnessLastDays(14, now));
  const parsedResults = braveResults.slice(0, CAPS.resultsParsed);

  // ── Stage 2: rule-based parsing ────────────────────────────────────────
  const records: EvidenceRecord[] = parsedResults.map((r) => parseResult(r, now));
  const usable = records.filter((r) => r.evidence_type !== "aggregation_page");

  // Early stop (Stage 9): with zero direct content nothing can ever qualify
  // as trending — skip the LLM entirely, report rejections only.
  const anyDirect = usable.some((r) => r.is_direct_content);

  // ── Stage 2b: ONE small LLM batch for nameless results only ───────────
  let llmCalls = 0, llmSent = 0, llmIn = 0, llmOut = 0, llmCost = 0;
  if (anyDirect && deps.llm) {
    const ambiguous = usable
      .filter((r) => !r.place_name_raw && r.evidence_type !== "listicle")
      .slice(0, CAPS.llmResults);
    if (ambiguous.length > 0) {
      llmCalls = 1;
      llmSent = ambiguous.length;
      try {
        const batch = ambiguous.map((r, i) => ({
          index: i, title: r.title, snippet: r.snippet, url: r.url,
        }));
        const res = await deps.llm(batch);
        llmIn = res.inputTokens; llmOut = res.outputTokens; llmCost = res.costUsd;
        warnings.push(...res.warnings);
        for (const ext of res.extractions) {
          const rec = ambiguous[ext.index];
          if (!rec) continue;
          rec.place_name_raw = ext.place_name_raw;
          rec.extraction_confidence = ext.confidence;
          rec.extracted_by = "llm";
          // Re-derive official flag now that a name exists (code, not LLM).
          rec.is_official_account = isOfficialAccount(
            rec.creator_name, rec.place_name_raw, `${rec.title} ${rec.snippet}`);
          if (rec.is_official_account) rec.evidence_type = "official_post";
        }
      } catch (e) {
        warnings.push(`llm_failed:${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`);
      }
    }
  } else if (!anyDirect) {
    warnings.push("early_stop_no_direct_evidence");
  }

  // ── Stage 3: aggregate into candidates (cap 10) ────────────────────────
  let candidates = aggregateCandidates(usable, now);
  candidates.sort((a, b) =>
    b.metrics.independent_evidence_count - a.metrics.independent_evidence_count);
  if (candidates.length > CAPS.candidatesAfterGrouping) {
    warnings.push(`candidate_cap_dropped:${candidates.length - CAPS.candidatesAfterGrouping}`);
    candidates = candidates.slice(0, CAPS.candidatesAfterGrouping);
  }

  // ── Stage 6a: local DB FIRST (registry + catalogue) — free ─────────────
  const [registry, catalogue] = await Promise.all([
    deps.db.loadRegistry(cityKey),
    deps.db.loadCatalogue(cityKey, cityLabel),
  ]);

  // City centroid from catalogue coords (free) — anchors identity checks.
  let centroid: { lat: number; lng: number } | undefined;
  {
    const pts = catalogue.filter((p) => p.lat != null && p.lng != null);
    if (pts.length >= 3) {
      centroid = {
        lat: pts.reduce((s, p) => s + (p.lat as number), 0) / pts.length,
        lng: pts.reduce((s, p) => s + (p.lng as number), 0) / pts.length,
      };
    }
  }

  // ── Stages 4-6: gate → score → classify → route ────────────────────────
  const items: WorkItem[] = [];
  const googleQueue: WorkItem[] = [];
  const catalogueNorms = catalogue.map((p) => normalizeName(p.name));

  for (const c of candidates) {
    const local = findLocalMatch(c, registry, catalogue);
    const registryRow = local?.kind === "registry" ? local.row
      : registry.find((r) =>
          r.normalized_name === c.normalized_name ||
          c.aliases.includes(r.normalized_name)) ?? null;
    const dbStatus = local?.kind === "catalogue" ? "in_catalogue"
      : local?.kind === "registry" ? `registry:${local.row.status}`
      : "new";

    const item: WorkItem = {
      c, dbStatus, registryRow,
      cataloguePlaceId: local?.kind === "catalogue" ? local.place.id : null,
      decision: "reject", reason: "",
      googleUsed: false, googleCost: 0,
      registryStatus: "rejected_weak",
      googlePlaceId: local?.kind === "catalogue" ? local.place.google_place_id : null,
      googleBusinessStatus: null,
      // Identity is already confirmed when the local DB knows the place.
      nameConfirmed: local != null,
      // Partial name overlap with a catalogue place that did NOT hard-match:
      // might be the same venue under a variant name → −10 penalty.
      suspectedDuplicate: local == null &&
        catalogueNorms.some((n) => tokenOverlap(n, c.normalized_name) >= 0.5),
    };
    items.push(item);

    // Known place → refresh evidence only. NEVER re-cost Google (Stage 8).
    if (local?.kind === "catalogue" ||
        (local?.kind === "registry" && ["added", "existing", "known"].includes(local.row.status))) {
      item.decision = "known_refresh";
      item.reason = `known_via_${local.kind === "catalogue" ? "catalogue" : "registry"}`;
      item.registryStatus = local.kind === "catalogue" ? "existing" : local.row.status;
      continue;
    }

    // Stage 4: cheap rejection BEFORE any paid API.
    const preConfidence = confidenceScore(c, { googleConfirmed: false });
    const gate = cheapRejectionGate(c, now, preConfidence);
    if (!gate.pass) {
      item.decision = "reject";
      item.reason = `gate:${gate.reason}`;
      item.registryStatus = "rejected_weak";
      continue;
    }

    // Stage 5 (pre-check): would this candidate classify as trending once its
    // identity is confirmed? If not even then, don't spend a Google call.
    const optimistic = trendScore(c, { nameConfirmed: true });
    const optimisticConf = confidenceScore(c, { googleConfirmed: true });
    const cls = classifyTrending(c, optimistic, optimisticConf, now);
    if (!cls.is_trending) {
      item.decision = "reject";
      item.reason = `below_trending_thresholds:${cls.failed.join(",")}`;
      item.registryStatus = "rejected_weak";
      continue;
    }

    // Stage 8 retry rules — may this candidate cost a Google call?
    const budget = await deps.budget();
    const retry = googleRetryDecision(registryRow, {
      now, hasNewEvidence: true, budgetAllowed: budget.allowed,
    });
    if (!retry.allowGoogle) {
      item.decision = "defer";
      item.reason = `retry_rule:${retry.reason}`;
      item.registryStatus = retry.reason === "budget_refused" ? "deferred"
        : registryRow?.status ?? "deferred";
      continue;
    }
    googleQueue.push(item);
  }

  // ── Stage 6b: Google confirms IDENTITY of the final ≤3 candidates ──────
  googleQueue.sort((a, b) =>
    trendScore(b.c, { nameConfirmed: true }).total - trendScore(a.c, { nameConfirmed: true }).total);
  const toConfirm = googleQueue.slice(0, maxGoogle);
  for (const item of googleQueue.slice(maxGoogle)) {
    item.decision = "defer";
    item.reason = "google_cap_deferred";
    item.registryStatus = "deferred";
  }

  let googleCalls = 0;
  for (const item of toConfirm) {
    if (dryRun) {
      // ZERO Google calls in a dry-run. Report the would-be action + cost.
      item.decision = "accept_trending";
      item.reason = "dry_run:passes_all_trend_thresholds; identity_confirmation_via_google_pending_real_run";
      item.registryStatus = "unresolved"; // not persisted anyway
      item.googleCost = GOOGLE_TEXT_SEARCH_USD;
      item.nameConfirmed = true; // stated assumption for the rehearsal score
      continue;
    }
    const r = await deps.google(`${item.c.place_name} ${cityLabel}`, centroid);
    if (r.mock) {
      item.decision = "defer";
      item.reason = "google_budget_refused";
      item.registryStatus = "deferred";
      continue;
    }
    if (!r.cached) { googleCalls++; item.googleCost = GOOGLE_TEXT_SEARCH_USD; }
    item.googleUsed = true;

    const hit = r.places.find((p) => {
      if (!p.id) return false;
      if (centroid && p.lat != null && p.lng != null &&
          haversineKm({ lat: p.lat, lng: p.lng }, centroid) > MAX_KM_FROM_CITY) return false;
      return googleHitMatchesCandidate(item.c, p.name);
    });

    if (!hit) {
      // Not on Google — may be brand-new. NOT a hard reject: manual review.
      item.decision = "manual_review";
      item.reason = "google_no_identity_match_may_be_brand_new";
      item.registryStatus = "unresolved";
      continue;
    }

    item.googlePlaceId = hit.id;
    item.googleBusinessStatus = hit.businessStatus;
    item.nameConfirmed = true;

    // Dedup AGAIN with Google's identity (place_id → website → coords → name).
    const dup = findLocalMatch(item.c, registry, catalogue, {
      googlePlaceId: hit.id, lat: hit.lat, lng: hit.lng,
    });
    if (dup?.kind === "catalogue") {
      item.decision = "known_refresh";
      item.reason = "google_resolved_to_existing_catalogue_place";
      item.registryStatus = "existing";
      item.cataloguePlaceId = dup.place.id;
      continue;
    }
    if (isReligiousPlace({ kind: hit.primaryType, name: hit.name })) {
      item.decision = "reject";
      item.reason = "religious_place_excluded";
      item.registryStatus = "rejected_weak";
      continue;
    }
    item.decision = "accept_trending";
    item.reason = "trending_thresholds_met_and_identity_confirmed";
    item.registryStatus = "added";
    (item as WorkItem & { googleHit?: GoogleLite }).googleHit = hit;
  }

  // ── Stage 7 + final scoring → report rows ──────────────────────────────
  const rows: CandidateReportRow[] = items.map((item) => {
    const score = trendScore(item.c, {
      nameConfirmed: item.nameConfirmed,
      suspectedDuplicate: item.suspectedDuplicate,
    });
    const confidence = confidenceScore(item.c, { googleConfirmed: item.googlePlaceId != null || (dryRun && item.decision === "accept_trending") });
    const classification = classifyTrending(item.c, score, confidence, now);
    const newness = classifyNewness(item.c, {
      googleBusinessStatus: item.googleBusinessStatus, now,
    });
    // A candidate that reached "accept" must still be trending after the
    // final (non-optimistic) scoring — belt and braces.
    let decision = item.decision;
    let reason = item.reason;
    if (decision === "accept_trending" && !classification.is_trending) {
      decision = "reject";
      reason = `final_score_below_threshold:${classification.failed.join(",")}`;
      item.registryStatus = "rejected_weak";
    }
    return {
      place_name: item.c.place_name,
      normalized_name: item.c.normalized_name,
      current_database_status: item.dbStatus,
      newness_status: newness.status,
      trend_score: score.total,
      confidence_score: confidence,
      trend_velocity: score.velocity,
      evidence_count: item.c.metrics.independent_evidence_count,
      unique_creators: item.c.metrics.unique_creators,
      platform_count: item.c.metrics.platform_count,
      direct_content_count: item.c.metrics.direct_content_count,
      published_dates: item.c.independent.map((e) => e.published_at),
      evidence_urls: item.c.independent.map((e) => e.url),
      google_lookup_used: item.googleUsed,
      estimated_cost_usd: item.googleCost,
      final_decision: decision,
      decision_reason: reason,
      score,
      classification,
    };
  });

  // ── Stage 8: persist registry + evidence (REAL runs only) ──────────────
  if (!dryRun) {
    const nowIso = now.toISOString();
    await deps.db.upsertRegistry(items.map((item, i) => ({
      city_key: cityKey,
      normalized_name: item.c.normalized_name,
      raw_name: item.c.place_name,
      aliases: item.c.aliases,
      status: item.registryStatus,
      google_place_id: item.googlePlaceId,
      place_id: item.cataloguePlaceId,
      last_seen_at: nowIso,
      last_checked_at: item.googleUsed ? nowIso : undefined,
      evidence_count: item.c.metrics.independent_evidence_count,
      trend_score: rows[i].trend_score,
      confidence_score: rows[i].confidence_score,
      newness_status: rows[i].newness_status,
      retry_after: retryAfterFor(item.registryStatus, now),
      rejection_reason: rows[i].final_decision === "reject" ? rows[i].decision_reason : null,
    })));
    for (const item of items) {
      await deps.db.insertEvidence(cityKey, item.c.normalized_name, item.c.evidence);
    }
    // Insert accepted places + refresh evidence on known ones (append-only).
    if (opts.supabase) {
      await persistPlaces(opts.supabase, items, rows, { cityKey, cityLabel, warnings });
    }
  }

  const googleCost = Math.round(googleCalls * GOOGLE_TEXT_SEARCH_USD * 1000) / 1000;
  const cost: CostSummary = {
    brave_queries: queries.length,
    brave_results: braveResults.length,
    results_parsed: parsedResults.length,
    llm_calls: llmCalls,
    llm_results_sent: llmSent,
    llm_input_tokens: llmIn,
    llm_output_tokens: llmOut,
    llm_cost_usd: Math.round(llmCost * 10_000) / 10_000,
    google_calls: googleCalls,
    google_cost_usd: googleCost,
    total_estimated_cost_usd: Math.round((llmCost + googleCost) * 10_000) / 10_000,
    accepted: rows.filter((r) => r.final_decision === "accept_trending").length,
    rejected: rows.filter((r) => r.final_decision === "reject").length,
    deferred: rows.filter((r) => r.final_decision === "defer").length,
    manual_review: rows.filter((r) => r.final_decision === "manual_review").length,
    known_refresh: rows.filter((r) => r.final_decision === "known_refresh").length,
  };

  return {
    city: cityLabel,
    cityKey,
    dryRun,
    queries,
    candidates: rows,
    cost,
    warnings,
    durationMs: Date.now() - startedAt,
  };
}

// ── Real-run persistence into `places` (reuses v1's append-only writer) ──

async function persistPlaces(
  supabase: SupabaseClient,
  items: WorkItem[],
  rows: CandidateReportRow[],
  ctx: { cityKey: string; cityLabel: string; warnings: string[] },
): Promise<void> {
  const evidenceRefresh: Array<{
    place_id: string; score: number; source: "tiktok" | "instagram" | "both" | "web";
    evidence_url: string; evidence_snippet?: string;
  }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = rows[i];
    const bestEvidence = item.c.independent.find((e) => e.is_direct_content)
      ?? item.c.independent[0];
    if (!bestEvidence) continue;
    const sources = new Set(item.c.independent.map((e) => e.source));
    const source: "tiktok" | "instagram" | "both" | "web" =
      sources.has("tiktok") && sources.has("instagram") ? "both"
      : sources.has("tiktok") ? "tiktok"
      : sources.has("instagram") ? "instagram"
      : "web";

    if (row.final_decision === "known_refresh" && item.cataloguePlaceId) {
      evidenceRefresh.push({
        place_id: item.cataloguePlaceId,
        score: row.trend_score,
        source,
        evidence_url: bestEvidence.url,
        evidence_snippet: bestEvidence.snippet.slice(0, 200) || undefined,
      });
      continue;
    }

    if (row.final_decision !== "accept_trending") continue;
    const hit = (item as WorkItem & { googleHit?: GoogleLite }).googleHit;
    if (!hit) continue;

    const category = categoryFromTypes(hit.types);
    const { data: inserted, error } = await supabase
      .from("places")
      .insert({
        google_place_id: hit.id,
        external_source: "trend_discovery",
        name: hit.name || item.c.place_name,
        category,
        kind: kindFromTypes(hit.types, category),
        city: ctx.cityKey.toLowerCase(),
        city_label: ctx.cityLabel,
        lat: hit.lat, lng: hit.lng,
        address: hit.address,
        rating: hit.rating,
        review_count: hit.reviewCount,
        cost_currency: /riyadh|الرياض/i.test(ctx.cityLabel) ? "SAR" : "EUR",
        cost_confidence: "low",
        google_maps_url: hit.googleMapsUri ?? `https://www.google.com/maps/place/?q=place_id:${hit.id}`,
        is_editor_pick: false,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        const { data: dup } = await supabase
          .from("places").select("id").eq("google_place_id", hit.id).single();
        if (dup) {
          evidenceRefresh.push({
            place_id: dup.id, score: row.trend_score, source,
            evidence_url: bestEvidence.url,
            evidence_snippet: bestEvidence.snippet.slice(0, 200) || undefined,
          });
          continue;
        }
      }
      ctx.warnings.push(`insert_failed:${item.c.place_name.slice(0, 24)}:${error.message.slice(0, 60)}`);
      continue;
    }
    evidenceRefresh.push({
      place_id: inserted.id, score: row.trend_score, source,
      evidence_url: bestEvidence.url,
      evidence_snippet: bestEvidence.snippet.slice(0, 200) || undefined,
    });
  }

  if (evidenceRefresh.length > 0) {
    await applyMatches(supabase, ctx.cityKey, ctx.cityLabel, evidenceRefresh, {
      query: "discover_v2",
    });
  }
}

function missingDb(): RegistryDb {
  const fail = () => { throw new Error("registry_db_missing: pass supabase or deps.db"); };
  return {
    loadRegistry: fail, loadCatalogue: fail, upsertRegistry: fail, insertEvidence: fail,
  };
}
