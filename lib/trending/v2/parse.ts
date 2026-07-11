// Stage 2 — evidence extraction WITHOUT guessing. Pure rule-based parsing of
// Brave results: source, direct-content, account handle, visible date,
// candidate place name, listicle/ad markers, documented engagement.
//
// The LLM is called LATER (engine.ts), ONLY for results where these rules
// could not extract a place name — and never to score anything.

import crypto from "node:crypto";
import type { BraveResult } from "@/lib/trending/braveSearch";
import { GENERIC_EVIDENCE_RE, isDirectPost } from "@/lib/trending/evidence";
import { normalizeName, namesMatch } from "@/lib/trending/v2/normalize";
import type { EvidenceRecord, EvidenceSource, EvidenceType } from "@/lib/trending/v2/types";

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// ── Source / platform ────────────────────────────────────────────────────

export function sourceFromUrl(url: string): EvidenceSource {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return "web"; }
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  if (/(^|\.)instagram\.com$/.test(host)) return "instagram";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return "x";
  if (/(^|\.)snapchat\.com$/.test(host)) return "snapchat";
  if (/news|akhbar|صحيفة|sabq|okaz|alarabiya|aleqt|alriyadh/.test(host)) return "news";
  if (/blog|wordpress|medium\.com/.test(host)) return "blog";
  return "web";
}

/** Direct content = a concrete post/video, extended beyond TikTok/IG. */
export function isDirectContentUrl(url: string): boolean {
  if (isDirectPost(url)) return true; // tiktok video / IG p|reel|tv
  if (/instagram\.com\/[\w.-]+\/(p|reel|reels|tv)\//i.test(url)) return true; // user-scoped IG post
  if (/(youtube\.com\/(watch\?|shorts\/))|youtu\.be\//i.test(url)) return true;
  if (/(x|twitter)\.com\/[^/]+\/status\/\d+/i.test(url)) return true;
  if (/snapchat\.com\/(spotlight|t)\//i.test(url)) return true;
  return false;
}

export function isAggregationPage(url: string): boolean {
  return GENERIC_EVIDENCE_RE.test(url);
}

// ── Creator handle from URL ──────────────────────────────────────────────

export function creatorFromUrl(url: string): string | null {
  const m =
    url.match(/tiktok\.com\/@([\w.-]+)/i) ||
    url.match(/instagram\.com\/([\w.-]+)\/(?:p|reel|reels|tv)\//i) ||
    url.match(/(?:x|twitter)\.com\/([\w]+)\/status\//i) ||
    url.match(/youtube\.com\/@([\w.-]+)/i);
  if (!m) return null;
  const handle = m[1].toLowerCase();
  // Not a real account segment:
  if (["p", "reel", "reels", "tv", "explore", "stories", "i", "intent"].includes(handle)) return null;
  return handle;
}

// ── Visible date parsing (never invented) ────────────────────────────────
// Sources, in order of trust: a date embedded in the URL path, an explicit
// date string, then Brave's page-age estimate. When none parse → null.
// discovered_at is NEVER substituted for published_at.

export function parseUrlDate(url: string): string | null {
  const m = url.match(/\/(20\d{2})\/(\d{1,2})(?:\/(\d{1,2}))?(?:\/|$)/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3] ?? 15);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return new Date(Date.UTC(y, mo - 1, d)).toISOString();
}

const REL_UNIT_MS: Record<string, number> = {
  minute: 60_000, hour: 3_600_000, day: 86_400_000,
  week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
};

/** Parse Brave's `age` field ("2 days ago" / "2026-07-01" / "July 1, 2026"). */
export function parseAge(age: string | undefined, now: Date): string | null {
  if (!age) return null;
  const iso = age.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))).toISOString();
  const rel = age.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/i);
  if (rel) {
    const ms = Number(rel[1]) * (REL_UNIT_MS[rel[2].toLowerCase()] ?? 0);
    return ms > 0 ? new Date(now.getTime() - ms).toISOString() : null;
  }
  const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const named = age.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (named) {
    const mo = MONTHS.indexOf(named[1].toLowerCase());
    return new Date(Date.UTC(Number(named[3]), mo, Number(named[2]))).toISOString();
  }
  return null;
}

// ── Markers: listicle, ad, official ──────────────────────────────────────

const LISTICLE_RE = /(?:أفضل|افضل|توب|قائمه|قائمة|top|best)\s*\d+|أفضل\s+(?:كافيهات|مقاهي|مطاعم)|best\s+cafes|قائمة بأفضل/i;

export function isListicle(title: string, description: string): boolean {
  return LISTICLE_RE.test(title) || LISTICLE_RE.test(description);
}

const AD_RE = /ممول|#?اعلان|#?إعلان|sponsored|paid\s+partnership|#ad\b/i;

export function hasAdMarker(text: string): boolean {
  return AD_RE.test(text);
}

/** Official account = the venue promoting itself. Deterministic: the account
 *  handle resolves (via transliteration/similarity) to the venue name, or the
 *  text says "الحساب الرسمي". Kept as WEAK supporting signal, never proof. */
export function isOfficialAccount(
  creator: string | null, placeNameRaw: string | null, text: string,
): boolean {
  if (/الحساب الرسمي|official account/i.test(text)) return true;
  if (!creator || !placeNameRaw) return false;
  const normPlace = normalizeName(placeNameRaw);
  const normCreator = normalizeName(creator.replace(/[._-]/g, " "));
  if (!normPlace || !normCreator) return false;
  if (namesMatch(normCreator, normPlace)) return true;
  // Handles glue generic suffixes onto the name (noircafe, hattencoffee.sa):
  // strip them and compare the core against the venue name.
  const core = creator
    .toLowerCase()
    .replace(/cafe|caffe|coffee|roastery|riyadh|official|ksa|sa\b/g, "")
    .replace(/[._\-\d]/g, "")
    .trim();
  return core.length >= 3 && namesMatch(core, normPlace);
}

// ── Documented engagement (never guessed) ────────────────────────────────

export function parseEngagement(text: string): number | null {
  const m = text.match(/([\d.,]+)\s*(k|m|الف|ألف|مليون)?\s*(views?|likes?|مشاهد(?:ه|ة|ات)|اعجاب|إعجاب|لايك)/i);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const mult = unit === "m" || unit === "مليون" ? 1_000_000
    : unit === "k" || unit === "الف" || unit === "ألف" ? 1_000
    : 1;
  return Math.round(base * mult);
}

// ── Rule-based place-name extraction ─────────────────────────────────────
// Patterns only — no guessing. Returns null when the rules can't find a name
// (the engine may then include the result in ONE small LLM batch).

const AR_STOP_AFTER = new Set([
  "في", "من", "علي", "على", "جديد", "الجديد", "بالرياض", "بحي", "حي", "افتتاح",
  "يستاهل", "التجربه", "التجربة", "ترند", "الرياض", "شمال", "جنوب", "شرق", "غرب",
  "يفتح", "تفتح", "افتتح", "افتتحت", "يعلن", "تعلن", "الان", "الآن", "اليوم",
]);

function extractArName(text: string): string | null {
  const m = text.match(/(?:كافيه|مقهى|كوفي|محمصة|محمصه)\s+([ء-ي][ء-ي\s]{1,30})/);
  if (!m) return null;
  const tokens: string[] = [];
  for (const t of m[1].trim().split(/\s+/)) {
    if (AR_STOP_AFTER.has(t)) break;
    tokens.push(t);
    if (tokens.length >= 3) break;
  }
  const name = tokens.join(" ").trim();
  return name.length >= 2 ? name : null;
}

function extractQuotedName(text: string): string | null {
  const m = text.match(/[«"“']([^»"”']{2,40})[»"”']/);
  if (!m) return null;
  const candidate = m[1].trim();
  // A quoted phrase with too many words is a sentence, not a name.
  if (candidate.split(/\s+/).length > 5) return null;
  return candidate;
}

function extractEnName(text: string): string | null {
  const m =
    text.match(/\b([A-Z][\w'&.é-]*(?:\s+[A-Z][\w'&.é-]*){0,3})\s+(?:Cafe|Café|Coffee|Roastery|Roasters)\b/) ||
    text.match(/\b(?:Cafe|Café|Coffee)\s+([A-Z][\w'&.é-]*(?:\s+[A-Z][\w'&.é-]*){0,2})\b/);
  if (!m) return null;
  const name = m[1].trim();
  // "New Cafe", "Best Coffee" etc. are not names.
  if (/^(new|best|top|this|the|a|viral|trending|good)$/i.test(name)) return null;
  return name;
}

export function extractNameByRules(
  title: string, description: string,
): { name: string; confidence: number } | null {
  const t = `${title} ${description}`;
  const quoted = extractQuotedName(title) ?? extractQuotedName(description);
  if (quoted) return { name: quoted, confidence: 85 };
  const ar = extractArName(t);
  if (ar) return { name: ar, confidence: 75 };
  const en = extractEnName(t);
  if (en) return { name: en, confidence: 75 };
  return null;
}

// ── Assemble one EvidenceRecord from one Brave result ────────────────────

export function parseResult(r: BraveResult, now: Date): EvidenceRecord {
  const url = r.url;
  const title = r.title ?? "";
  const snippet = r.description ?? "";
  const text = `${title} ${snippet}`;

  const aggregation = isAggregationPage(url);
  const direct = !aggregation && isDirectContentUrl(url);
  const creator = creatorFromUrl(url);
  const published = parseUrlDate(url) ?? parseAge(r.age, now);
  const dateSource: EvidenceRecord["date_source"] =
    parseUrlDate(url) ? "url" : parseAge(r.age, now) ? "brave_age" : null;

  const extracted = aggregation ? null : extractNameByRules(title, snippet);
  const listicle = isListicle(title, snippet);
  const official = isOfficialAccount(creator, extracted?.name ?? null, text);

  let evidenceType: EvidenceType;
  if (aggregation) evidenceType = "aggregation_page";
  else if (official) evidenceType = "official_post";
  else if (direct) evidenceType = "direct_post";
  else if (listicle) evidenceType = "listicle";
  else evidenceType = "article";

  return {
    source: sourceFromUrl(url),
    url,
    url_hash: sha256(url),
    content_hash: sha256(normalizeName(title) + "::" + normalizeName(snippet).slice(0, 80)),
    title,
    snippet,
    published_at: published,
    date_source: dateSource,
    discovered_at: now.toISOString(),
    creator_name: creator,
    place_name_raw: extracted?.name ?? null,
    is_direct_content: direct,
    is_official_account: official,
    evidence_type: evidenceType,
    extraction_confidence: extracted?.confidence ?? 0,
    engagement_count: parseEngagement(text),
    has_ad_marker: hasAdMarker(text),
    extracted_by: "rules",
  };
}
