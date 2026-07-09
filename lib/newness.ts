// Newness signal — is this place "newly opened"?
//
// Google's Places API doesn't expose `openingDate` on legacy Details, so we
// approximate it: a place is treated as "new" when its OLDEST returned
// review is < 12 months old AND it has fewer than ~40 reviews. Both
// conditions matter — a viral spot can hit 40 reviews in a week, and an old
// place can have exactly 5 latest recent reviews. Combined, they filter to
// venues that opened in the last year.
//
// Signal is cheap: earliest_review_at is populated during enrich() from the
// legacy `reviews[].time` field (unix seconds), which Google returns for
// free with the Details call we're already paying for.

const YEAR_MS = 365 * 86_400_000;
const MAX_REVIEWS_FOR_NEW = 40;

export function isNewPlace(p: {
  earliest_review_at: string | null;
  review_count: number | null;
}): boolean {
  if (!p.earliest_review_at) return false;
  const reviews = p.review_count ?? 999;
  if (reviews > MAX_REVIEWS_FOR_NEW) return false;
  const ageMs = Date.now() - Date.parse(p.earliest_review_at);
  return ageMs > 0 && ageMs < YEAR_MS;
}
