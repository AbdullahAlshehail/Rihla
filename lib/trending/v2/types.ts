// Trend Discovery v2 — shared types.
//
// CORE PRINCIPLE (owner spec, 2026-07): cheap-to-expensive funnel.
//   Brave discovers → CODE filters & aggregates → LLM only for ambiguous
//   name-extraction (one small batch) → Google confirms IDENTITY of the
//   final ≤3 candidates. Trend scoring is DETERMINISTIC IN CODE — the LLM
//   never decides that a place is trending.

// ── Stage 2: evidence record ─────────────────────────────────────────────

export type EvidenceSource =
  | "tiktok" | "instagram" | "youtube" | "x" | "snapchat"
  | "news" | "blog" | "web";

export type EvidenceType =
  | "direct_post"       // a concrete post: TikTok video, IG reel, YT video, X status
  | "article"           // a dated article about THIS venue
  | "listicle"          // "top 10 cafes" style — generic, weak
  | "official_post"     // the venue's own account promoting itself
  | "aggregation_page"; // search/tag/discover/explore page — NOT evidence

export type EvidenceRecord = {
  source: EvidenceSource;
  url: string;
  url_hash: string;                 // sha256(url) — duplicate-insert prevention
  content_hash: string;             // sha256(normalized title+snippet) — repost detection
  title: string;
  snippet: string;
  /** Publish date parsed from the result itself (URL path date, explicit date
   *  in text, or Brave's page-age estimate). NULL when unknown — NEVER
   *  substituted with discovered_at. */
  published_at: string | null;
  date_source: "url" | "explicit" | "brave_age" | null;
  discovered_at: string;
  creator_name: string | null;      // @handle / account, from the URL when parseable
  place_name_raw: string | null;    // venue name as written in the source
  is_direct_content: boolean;
  is_official_account: boolean;
  evidence_type: EvidenceType;
  /** 0-100. Rules-extracted names get fixed confidences; LLM-extracted carry
   *  the model's self-reported confidence, validated in code. */
  extraction_confidence: number;
  /** Documented view/like count parsed from the visible text (never guessed). */
  engagement_count: number | null;
  has_ad_marker: boolean;           // ممول / sponsored / paid partnership
  extracted_by: "rules" | "llm";
};

// ── Stage 3: aggregated candidate ────────────────────────────────────────

export type CandidateMetrics = {
  mentions_last_7_days: number;     // independent evidence w/ reliable date ≤7d
  mentions_days_8_to_14: number;
  mentions_last_14_days: number;
  unique_creators: number;          // distinct non-official accounts/domains
  unique_direct_sources: number;
  platform_count: number;
  direct_content_count: number;
  official_content_count: number;
  article_count: number;            // articles + listicles
  listicle_count: number;
  reliable_date_count: number;
  independent_evidence_count: number;
  /** Age (days) of the NEWEST independent evidence with a reliable date. */
  newest_reliable_age_days: number | null;
  max_engagement: number | null;
  has_ad_marker: boolean;
};

export type CandidateAggregate = {
  /** Best raw display name across evidence (longest rules-extracted wins). */
  place_name: string;
  normalized_name: string;
  aliases: string[];                // other normalized spellings seen (AR/EN)
  /** ALL evidence records grouped under this candidate (incl. dependent ones). */
  evidence: EvidenceRecord[];
  /** The subset that counts as INDEPENDENT proof (post-dedup, non-official). */
  independent: EvidenceRecord[];
  metrics: CandidateMetrics;
};

// ── Stage 5: deterministic score ─────────────────────────────────────────

export type ScoreBreakdown = {
  recency: number;        // /25
  acceleration: number;   // /25
  accounts: number;       // /20
  diversity: number;      // /15
  direct: number;         // /10
  engagement: number;     // /5
  penalties: Array<{ reason: string; points: number }>;
  total: number;          // 0-100 after penalties
  velocity: number;       // m7 / max(1, m8_14)
};

export type TrendClassification = {
  is_trending: boolean;
  via: "standard" | "exception" | null;
  failed: string[];       // which conditions failed (empty when trending)
};

// ── Stage 7: newness ─────────────────────────────────────────────────────

export type NewnessStatus = "confirmed_new" | "likely_new" | "existing_place" | "unknown";

export type NewnessResult = {
  status: NewnessStatus;
  confidence: number;     // 0-100, SEPARATE from trend score
  signals: string[];
};

// ── Stage 6/8: registry ──────────────────────────────────────────────────

export type RegistryStatus =
  | "added"          // confirmed + inserted into places (terminal for Google)
  | "existing"       // matched the catalogue (terminal for Google)
  | "known"          // in registry, refresh evidence only
  | "unresolved"     // Google had no match — may be brand-new; manual review
  | "deferred"       // budget refused — retry when budget allows
  | "rejected_weak"; // failed the cheap gate / thresholds — retry 14d w/ new evidence

export type RegistryRow = {
  city_key: string;
  normalized_name: string;
  raw_name: string | null;
  aliases: string[];
  status: RegistryStatus;
  google_place_id: string | null;
  place_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_checked_at: string | null;
  evidence_count: number;
  trend_score: number | null;
  confidence_score: number | null;
  newness_status: NewnessStatus | null;
  retry_after: string | null;
  rejection_reason: string | null;
};

export type CataloguePlace = {
  id: string;
  name: string;
  google_place_id: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
};

// ── Stage 10: dry-run / run report ───────────────────────────────────────

export type FinalDecision =
  | "accept_trending"   // provably trending + identity confirmed
  | "manual_review"     // trending signals but Google can't confirm (may be brand-new)
  | "known_refresh"     // already known — evidence refreshed, no Google
  | "defer"             // budget/caps — retry later, nothing spent
  | "reject";           // failed gate or thresholds

export type CandidateReportRow = {
  place_name: string;
  normalized_name: string;
  current_database_status: string;   // registry/catalogue status before this run
  newness_status: NewnessStatus;
  trend_score: number;
  confidence_score: number;
  trend_velocity: number;
  evidence_count: number;
  unique_creators: number;
  platform_count: number;
  direct_content_count: number;
  published_dates: Array<string | null>;
  evidence_urls: string[];
  google_lookup_used: boolean;
  estimated_cost_usd: number;
  final_decision: FinalDecision;
  decision_reason: string;
  score: ScoreBreakdown;
  classification: TrendClassification;
};

export type CostSummary = {
  brave_queries: number;
  brave_results: number;
  results_parsed: number;
  llm_calls: number;                 // 0 or 1 (one small batch)
  llm_results_sent: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  llm_cost_usd: number;
  google_calls: number;
  google_cost_usd: number;           // nominal SKU price; $0 inside free tier
  total_estimated_cost_usd: number;
  accepted: number;
  rejected: number;
  deferred: number;
  manual_review: number;
  known_refresh: number;
};

export type DiscoveryV2Report = {
  city: string;
  cityKey: string;
  dryRun: boolean;
  queries: string[];
  candidates: CandidateReportRow[];
  cost: CostSummary;
  warnings: string[];
  durationMs: number;
};
