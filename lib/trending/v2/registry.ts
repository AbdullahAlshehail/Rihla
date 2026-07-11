// Stages 6 + 8 — Candidate Registry: local-first existence checks, dedup
// order, and retry rules that prevent any re-cost. Pure decision functions +
// a thin Supabase adapter (injectable for tests).

import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineKm } from "@/lib/utils";
import { normalizeName, namesMatch, tokenOverlap } from "@/lib/trending/v2/normalize";
import type {
  CandidateAggregate, CataloguePlace, EvidenceRecord, RegistryRow, RegistryStatus,
} from "@/lib/trending/v2/types";

const DAY_MS = 86_400_000;
export const RETRY_DAYS_REJECTED_WEAK = 14;
export const RETRY_DAYS_UNRESOLVED = 7;
/** Same-place coordinate proximity for dedup (~150 m). */
const COORD_DUP_KM = 0.15;

// ── Retry rules (Stage 8) — when may this candidate cost a Google call? ──

export type RetryDecision = { allowGoogle: boolean; reason: string };

export function googleRetryDecision(
  row: RegistryRow | null,
  opts: { now: Date; hasNewEvidence: boolean; budgetAllowed: boolean },
): RetryDecision {
  if (!opts.budgetAllowed) return { allowGoogle: false, reason: "budget_refused" };
  if (!row) return { allowGoogle: true, reason: "new_candidate" };
  switch (row.status) {
    case "added":
    case "existing":
    case "known":
      // Terminal for Google — refresh evidence only, NEVER re-cost.
      return { allowGoogle: false, reason: `already_${row.status}` };
    case "rejected_weak": {
      const due = row.retry_after != null && opts.now.getTime() >= Date.parse(row.retry_after);
      if (due && opts.hasNewEvidence) return { allowGoogle: true, reason: "rejected_retry_with_new_evidence" };
      return { allowGoogle: false, reason: due ? "rejected_no_new_evidence" : "rejected_retry_window" };
    }
    case "unresolved": {
      const due = row.retry_after == null
        || opts.now.getTime() >= Date.parse(row.retry_after);
      return due
        ? { allowGoogle: true, reason: "unresolved_retry_due" }
        : { allowGoogle: false, reason: "unresolved_retry_window" };
    }
    case "deferred":
      return { allowGoogle: true, reason: "deferred_budget_now_allows" };
    default:
      return { allowGoogle: false, reason: "unknown_status" };
  }
}

export function retryAfterFor(status: RegistryStatus, now: Date): string | null {
  if (status === "rejected_weak") return new Date(now.getTime() + RETRY_DAYS_REJECTED_WEAK * DAY_MS).toISOString();
  if (status === "unresolved") return new Date(now.getTime() + RETRY_DAYS_UNRESOLVED * DAY_MS).toISOString();
  return null; // added/existing/known: never; deferred: whenever budget allows
}

// ── Local-first existence check (Stage 6, dedup order) ───────────────────
// place_id → website/social → coordinate proximity → AR/EN name → alias.

export type LocalMatch =
  | { kind: "registry"; row: RegistryRow; via: string }
  | { kind: "catalogue"; place: CataloguePlace; via: string }
  | null;

export function findLocalMatch(
  candidate: CandidateAggregate,
  registry: RegistryRow[],
  catalogue: CataloguePlace[],
  opts?: { googlePlaceId?: string | null; lat?: number | null; lng?: number | null; website?: string | null },
): LocalMatch {
  const gpid = opts?.googlePlaceId ?? null;

  // 1) google_place_id.
  if (gpid) {
    const cat = catalogue.find((p) => p.google_place_id === gpid);
    if (cat) return { kind: "catalogue", place: cat, via: "google_place_id" };
    const reg = registry.find((r) => r.google_place_id === gpid);
    if (reg) return { kind: "registry", row: reg, via: "google_place_id" };
  }

  // 2) website / social host+path.
  if (opts?.website) {
    const w = opts.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase();
    const cat = catalogue.find((p) =>
      p.website && p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "").toLowerCase() === w);
    if (cat) return { kind: "catalogue", place: cat, via: "website" };
  }

  // 3) coordinate proximity (when the candidate has confirmed coords).
  if (opts?.lat != null && opts?.lng != null) {
    const cat = catalogue.find((p) =>
      p.lat != null && p.lng != null &&
      haversineKm({ lat: opts.lat as number, lng: opts.lng as number }, { lat: p.lat, lng: p.lng }) <= COORD_DUP_KM);
    if (cat) return { kind: "catalogue", place: cat, via: "coordinates" };
  }

  // 4) AR/EN normalized name, 5) aliases/transliteration (namesMatch covers both).
  const keys = [candidate.normalized_name, ...candidate.aliases];
  for (const key of keys) {
    const cat = catalogue.find((p) => namesMatch(key, normalizeName(p.name)));
    if (cat) return { kind: "catalogue", place: cat, via: "name" };
  }
  for (const key of keys) {
    const reg = registry.find((r) =>
      namesMatch(key, r.normalized_name) || r.aliases.some((a) => namesMatch(key, a)));
    if (reg) return { kind: "registry", row: reg, via: "name" };
  }
  return null;
}

/** Verify a Google Text Search hit actually IS this candidate (identity only —
 *  Google never proves trend). */
export function googleHitMatchesCandidate(
  candidate: CandidateAggregate, googleName: string,
): boolean {
  const gNorm = normalizeName(googleName);
  const keys = [candidate.normalized_name, ...candidate.aliases];
  return keys.some((k) => namesMatch(k, gNorm) || tokenOverlap(k, gNorm) >= 0.5);
}

// ── DB adapter (seam) ────────────────────────────────────────────────────

export type RegistryDb = {
  loadRegistry(cityKey: string): Promise<RegistryRow[]>;
  loadCatalogue(cityKey: string, cityLabel: string): Promise<CataloguePlace[]>;
  /** Upsert registry rows (append/refresh only — never deletes). No-op in dry-run. */
  upsertRegistry(rows: Array<Partial<RegistryRow> & {
    city_key: string; normalized_name: string; status: RegistryStatus;
  }>): Promise<void>;
  /** Insert evidence rows, deduped on (candidate, url_hash). No-op in dry-run. */
  insertEvidence(cityKey: string, normalizedName: string, evidence: EvidenceRecord[]): Promise<void>;
};

export function supabaseRegistryDb(supabase: SupabaseClient): RegistryDb {
  return {
    async loadRegistry(cityKey) {
      const { data, error } = await supabase
        .from("trend_discovery_seen")
        .select("city_key,normalized_name,raw_name,aliases,status,resolution,google_place_id,place_id,first_seen_at,last_seen_at,last_checked_at,evidence_count,trend_score,confidence_score,newness_status,retry_after,rejection_reason")
        .eq("city_key", cityKey);
      if (error) {
        // Pre-migration DB (no new columns yet) — degrade to the v1 shape.
        const legacy = await supabase
          .from("trend_discovery_seen")
          .select("city_key,normalized_name,raw_name,resolution,google_place_id,place_id,first_seen_at,last_seen_at")
          .eq("city_key", cityKey);
        if (legacy.error) return [];
        return (legacy.data ?? []).map((r) => ({
          city_key: r.city_key,
          normalized_name: r.normalized_name,
          raw_name: r.raw_name,
          aliases: [],
          status: (r.resolution === "added" || r.resolution === "existing"
            ? r.resolution : r.resolution === "deferred" ? "deferred" : "unresolved") as RegistryStatus,
          google_place_id: r.google_place_id,
          place_id: r.place_id,
          first_seen_at: r.first_seen_at,
          last_seen_at: r.last_seen_at,
          last_checked_at: null,
          evidence_count: 0,
          trend_score: null,
          confidence_score: null,
          newness_status: null,
          retry_after: null,
          rejection_reason: null,
        }));
      }
      type Row = Record<string, unknown>;
      return (data ?? []).map((r: Row) => ({
        city_key: String(r.city_key),
        normalized_name: String(r.normalized_name),
        raw_name: (r.raw_name as string | null) ?? null,
        aliases: Array.isArray(r.aliases) ? (r.aliases as string[]) : [],
        status: ((r.status as string | null) ?? legacyStatus(r.resolution as string)) as RegistryStatus,
        google_place_id: (r.google_place_id as string | null) ?? null,
        place_id: (r.place_id as string | null) ?? null,
        first_seen_at: String(r.first_seen_at),
        last_seen_at: String(r.last_seen_at),
        last_checked_at: (r.last_checked_at as string | null) ?? null,
        evidence_count: Number(r.evidence_count ?? 0),
        trend_score: (r.trend_score as number | null) ?? null,
        confidence_score: (r.confidence_score as number | null) ?? null,
        newness_status: (r.newness_status as RegistryRow["newness_status"]) ?? null,
        retry_after: (r.retry_after as string | null) ?? null,
        rejection_reason: (r.rejection_reason as string | null) ?? null,
      }));
    },

    async loadCatalogue(cityKey, cityLabel) {
      const { data, error } = await supabase
        .from("places")
        .select("id,name,google_place_id,website,lat,lng")
        .or(`city.eq.${cityKey},city_label.eq.${cityLabel}`);
      if (error) throw new Error(`catalogue_read_failed: ${error.message}`);
      return (data ?? []) as CataloguePlace[];
    },

    async upsertRegistry(rows) {
      if (rows.length === 0) return;
      const { error } = await supabase
        .from("trend_discovery_seen")
        .upsert(rows.map((r) => ({
          ...r,
          // Keep the legacy column coherent while both engines coexist.
          resolution: legacyResolution(r.status),
        })), { onConflict: "city_key,normalized_name" });
      if (error) console.warn("[trend-v2] registry upsert failed:", error.message);
    },

    async insertEvidence(cityKey, normalizedName, evidence) {
      if (evidence.length === 0) return;
      const rows = evidence.map((e) => ({
        city_key: cityKey,
        normalized_name: normalizedName,
        url: e.url,
        url_hash: e.url_hash,
        content_hash: e.content_hash,
        source: e.source,
        title: e.title.slice(0, 300),
        snippet: e.snippet.slice(0, 500),
        published_at: e.published_at,
        date_source: e.date_source,
        discovered_at: e.discovered_at,
        creator_name: e.creator_name,
        place_name_raw: e.place_name_raw,
        is_direct_content: e.is_direct_content,
        is_official_account: e.is_official_account,
        evidence_type: e.evidence_type,
        extraction_confidence: e.extraction_confidence,
        engagement_count: e.engagement_count,
        extracted_by: e.extracted_by,
      }));
      const { error } = await supabase
        .from("trend_candidate_evidence")
        .upsert(rows, { onConflict: "city_key,normalized_name,url_hash", ignoreDuplicates: true });
      if (error) console.warn("[trend-v2] evidence insert failed:", error.message);
    },
  };
}

function legacyStatus(resolution: string | null | undefined): RegistryStatus {
  if (resolution === "added" || resolution === "existing" || resolution === "deferred") return resolution;
  return "unresolved";
}

/** Map v2 statuses onto the v1 `resolution` check constraint values. */
function legacyResolution(status: RegistryStatus): "added" | "existing" | "unresolved" | "deferred" {
  if (status === "added" || status === "existing" || status === "deferred") return status;
  if (status === "known") return "existing";
  return "unresolved"; // unresolved + rejected_weak
}
