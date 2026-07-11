// Stages 4, 5, 7 — cheap rejection gate, DETERMINISTIC trend scoring, and
// newness classification. Pure functions, zero I/O, zero LLM.
//
// THE LLM NEVER TOUCHES ANY NUMBER IN THIS FILE. A place is trending only
// when the arithmetic below says so.

import type {
  CandidateAggregate, NewnessResult, ScoreBreakdown, TrendClassification,
} from "@/lib/trending/v2/types";

const DAY_MS = 86_400_000;

/** Documented engagement counts as "high" from 100k views/likes. */
export const HIGH_ENGAGEMENT = 100_000;

// ── Confidence (how sure are we this is a real, correctly-named place) ───

export function confidenceScore(
  c: CandidateAggregate, opts: { googleConfirmed: boolean },
): number {
  const m = c.metrics;
  // Base: mean extraction confidence over independent evidence with a name.
  const confs = c.independent
    .map((e) => e.extraction_confidence)
    .filter((n) => n > 0);
  const base = confs.length
    ? Math.round(confs.reduce((s, n) => s + n, 0) / confs.length)
    : 0;
  let score = base;
  if (opts.googleConfirmed) score += 10;
  if (m.reliable_date_count >= 2) score += 5;
  if (m.reliable_date_count === 0) score -= 15;
  if (m.independent_evidence_count >= 3) score += 5;
  return Math.max(0, Math.min(100, score));
}

// ── Stage 4: cheap rejection BEFORE any paid API ─────────────────────────

export type GateResult = { pass: boolean; reason: string | null };

export function cheapRejectionGate(
  c: CandidateAggregate, now: Date, preConfidence: number,
): GateResult {
  const m = c.metrics;
  if (c.evidence.length > 0 && c.evidence.every((e) => e.is_official_account)) {
    return { pass: false, reason: "official_account_only" };
  }
  if (m.independent_evidence_count <= 1) {
    return { pass: false, reason: "single_evidence" };
  }
  if (m.direct_content_count === 0 && c.evidence.every((e) => !e.is_direct_content)) {
    return { pass: false, reason: "no_direct_link" };
  }
  if (c.independent.every((e) => e.evidence_type === "listicle")) {
    return { pass: false, reason: "listicles_only" };
  }
  if (m.direct_content_count === 0 && m.article_count === m.independent_evidence_count) {
    return { pass: false, reason: "generic_articles_only" };
  }
  if (!c.normalized_name) {
    return { pass: false, reason: "no_clear_name" };
  }
  const nowMs = now.getTime();
  const anyRecent = c.independent.some((e) =>
    e.published_at != null && (nowMs - Date.parse(e.published_at)) / DAY_MS <= 30);
  const anyUndated = c.independent.some((e) => e.published_at == null);
  if (!anyRecent && !anyUndated) {
    return { pass: false, reason: "all_evidence_older_than_30d" };
  }
  if (preConfidence < 50) {
    return { pass: false, reason: "confidence_below_50" };
  }
  return { pass: true, reason: null };
}

// ── Stage 5: deterministic trend score /100 ──────────────────────────────
// 25 recency + 25 acceleration + 20 independent accounts + 15 diversity +
// 10 direct content + 5 documented engagement − penalties.

export function trendScore(
  c: CandidateAggregate,
  opts: { nameConfirmed: boolean; suspectedDuplicate?: boolean },
): ScoreBreakdown {
  const m = c.metrics;

  // Recency (25): age of the NEWEST reliably-dated independent evidence.
  // Quality over count — two very fresh posts beat five stale ones.
  const age = m.newest_reliable_age_days;
  const recency =
    age == null ? 0
    : age <= 3 ? 25
    : age <= 7 ? 20
    : age <= 14 ? 10
    : age <= 30 ? 4
    : 0;

  // Acceleration (25): last 7 days vs the 7 before. Velocity alone is NOT
  // trusted on tiny counts — with ≤1 mention in the last 7 days, cap at 8.
  const velocityRaw = m.mentions_last_7_days / Math.max(1, m.mentions_days_8_to_14);
  const velocity = Math.round(velocityRaw * 100) / 100;
  let acceleration =
    m.mentions_last_7_days === 0 ? 0
    : velocityRaw >= 3 ? 25
    : velocityRaw >= 2 ? 18
    : velocityRaw >= 1.5 ? 12
    : velocityRaw >= 1 ? 8
    : 4;
  if (m.mentions_last_7_days <= 1) acceleration = Math.min(acceleration, 8);

  // Independent accounts (20).
  const accounts =
    m.unique_creators >= 4 ? 20
    : m.unique_creators === 3 ? 16
    : m.unique_creators === 2 ? 12
    : m.unique_creators === 1 ? 4
    : 0;

  // Platform / source diversity (15).
  const diversity =
    m.platform_count >= 3 ? 15
    : m.platform_count === 2 ? 11
    : m.platform_count === 1 ? 5
    : 0;

  // Clear direct content (10).
  const direct =
    m.direct_content_count >= 3 ? 10
    : m.direct_content_count === 2 ? 8
    : m.direct_content_count === 1 ? 5
    : 0;

  // Real documented engagement (5) — parsed from visible text, never guessed.
  const engagement =
    (m.max_engagement ?? 0) >= HIGH_ENGAGEMENT ? 5
    : (m.max_engagement ?? 0) > 0 ? 2
    : 0;

  // Penalties.
  const penalties: Array<{ reason: string; points: number }> = [];
  const add = (reason: string, points: number) => penalties.push({ reason, points });
  if (m.direct_content_count === 0 && m.article_count > 0) add("articles_only", -20);
  if (m.official_content_count > 0 &&
      m.official_content_count >= m.independent_evidence_count) add("mostly_official", -15);
  if (m.independent_evidence_count > 0 &&
      m.reliable_date_count * 2 <= m.independent_evidence_count) add("mostly_undated", -15);
  if (!opts.nameConfirmed) add("name_unconfirmed", -15);
  if (m.platform_count === 1) add("single_platform", -10);
  if (opts.suspectedDuplicate) add("suspected_duplicate", -10);
  if (m.has_ad_marker) add("paid_ad_or_pr", -10);

  const raw = recency + acceleration + accounts + diversity + direct + engagement
    + penalties.reduce((s, p) => s + p.points, 0);
  const total = Math.max(0, Math.min(100, raw));

  return { recency, acceleration, accounts, diversity, direct, engagement, penalties, total, velocity };
}

// ── Trending classification — ALL conditions, plus the narrow exception ──

export function classifyTrending(
  c: CandidateAggregate, score: ScoreBreakdown, confidence: number, now: Date,
): TrendClassification {
  const m = c.metrics;
  const failed: string[] = [];

  // Articles alone NEVER qualify, regardless of count.
  if (m.direct_content_count === 0) {
    return { is_trending: false, via: null, failed: ["no_direct_content"] };
  }

  if (m.independent_evidence_count < 3) failed.push("independent_evidence<3");
  if (m.unique_creators < 2) failed.push("unique_creators<2");
  if (m.direct_content_count < 1) failed.push("direct_content<1");
  if (!(m.platform_count >= 2 || m.unique_creators >= 3)) failed.push("diversity(2_platforms_or_3_accounts)");
  if (m.mentions_last_14_days < 2) failed.push("mentions_14d<2");
  if (score.total < 70) failed.push("trend_score<70");
  if (confidence < 70) failed.push("confidence<70");

  if (failed.length === 0) return { is_trending: true, via: "standard", failed: [] };

  // Exception: 2 direct evidences from 2 DIFFERENT accounts, both within
  // 7 days, one with documented high engagement, neither official, score ≥75.
  const nowMs = now.getTime();
  const directs = c.independent.filter((e) => e.is_direct_content);
  const bothIn7d = directs.length >= 2 && directs.every((e) =>
    e.published_at != null && (nowMs - Date.parse(e.published_at)) / DAY_MS <= 7);
  const twoAccounts = new Set(directs.map((e) => `${e.source}:${e.creator_name ?? e.url}`)).size >= 2;
  const oneHigh = directs.some((e) => (e.engagement_count ?? 0) >= HIGH_ENGAGEMENT);
  const noneOfficial = directs.every((e) => !e.is_official_account);
  if (
    m.direct_content_count >= 2 && bothIn7d && twoAccounts && oneHigh &&
    noneOfficial && score.total >= 75 && confidence >= 70
  ) {
    return { is_trending: true, via: "exception", failed: [] };
  }

  return { is_trending: false, via: null, failed };
}

// ── Stage 7: newness (SEPARATE from trend score) ─────────────────────────
// Our first-seen is NOT an opening date. Signals only:
//   • explicit "new / opening / soft opening" phrasing in DIRECT content
//   • an official post stating an opening
//   • Google businessStatus (future/recent opening)
//   • absence of references older than 60 days in what we saw

const NEW_PHRASE_RE = /افتتاح|افتتح|جديد كليا|الجديد|soft\s*opening|grand\s*opening|now\s*open|opening\s*soon|كافيه جديد|مقهى جديد|يفتح ابوابه|يفتح أبوابه|فتح ابوابه|فتح أبوابه/i;

export function classifyNewness(
  c: CandidateAggregate,
  opts: { googleBusinessStatus?: string | null; now: Date },
): NewnessResult {
  const signals: string[] = [];
  let confidence = 0;

  const directNew = c.evidence.some((e) =>
    e.is_direct_content && !e.is_official_account && NEW_PHRASE_RE.test(`${e.title} ${e.snippet}`));
  if (directNew) { signals.push("direct_content_says_new"); confidence += 35; }

  const officialNew = c.evidence.some((e) =>
    e.is_official_account && NEW_PHRASE_RE.test(`${e.title} ${e.snippet}`));
  if (officialNew) { signals.push("official_post_says_opening"); confidence += 30; }

  const anyArticleNew = c.evidence.some((e) =>
    !e.is_direct_content && !e.is_official_account && NEW_PHRASE_RE.test(`${e.title} ${e.snippet}`));
  if (anyArticleNew) { signals.push("article_says_new"); confidence += 15; }

  const gbs = (opts.googleBusinessStatus ?? "").toUpperCase();
  if (gbs === "CLOSED_TEMPORARILY" || gbs === "FUTURE_OPENING") {
    signals.push(`google_business_status_${gbs.toLowerCase()}`);
    confidence += 25;
  }

  // Older references argue AGAINST newness.
  const nowMs = opts.now.getTime();
  const hasOldRef = c.evidence.some((e) =>
    e.published_at != null && (nowMs - Date.parse(e.published_at)) / DAY_MS > 60);
  if (hasOldRef) {
    signals.push("has_references_older_than_60d");
    confidence -= 40;
  } else if (signals.length > 0) {
    signals.push("no_older_references_seen");
    confidence += 10;
  }

  confidence = Math.max(0, Math.min(100, confidence));

  let status: NewnessResult["status"];
  if (hasOldRef && !directNew && !officialNew) status = "existing_place";
  else if (confidence >= 70) status = "confirmed_new";
  else if (confidence >= 40) status = "likely_new";
  else status = "unknown";

  return { status, confidence, signals };
}
