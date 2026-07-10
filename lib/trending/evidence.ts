// Evidence-quality rules for the trending engine — CLIENT-SAFE (no server
// imports; used by both the scan/discovery pipelines and the UI).
//
// Owner rule (2026-07): a place may only be presented as "trending" when the
// proof is VENUE-SPECIFIC — a real post/article that names THIS place.
// Generic aggregation pages (tiktok discover/tag/search, IG explore, bare
// Google/Pinterest searches) are NOT evidence: they match any city+category
// query and prove nothing about the venue. The old engine merely capped
// their score at 65 and still wrote them — that wrote "trending" rows backed
// by discover pages. The new rule is REJECT: no generic URL is ever attached
// as a place's proof, and a venue whose only evidence is generic is skipped.

/** Aggregation/search pages — never acceptable as a venue's trending proof. */
export const GENERIC_EVIDENCE_RE =
  /tiktok\.com\/(discover|tag|search)\b|instagram\.com\/(explore|directory)\b|youtube\.com\/(results|hashtag)\b|google\.[a-z.]+\/search\b|pinterest\.[a-z.]+\/search\b|snapchat\.com\/(search|discover)\b/i;

/** True when the URL is allowed to back a trend (not an aggregation page). */
export function isSpecificEvidence(url: string): boolean {
  return !GENERIC_EVIDENCE_RE.test(url);
}

/** Strongest tier: a concrete post — a TikTok video or an IG post/reel. */
export function isDirectPost(url: string): boolean {
  return /tiktok\.com\/@[^/]+\/video\/\d+/i.test(url)
    || /instagram\.com\/(p|reel|reels|tv)\//i.test(url);
}
