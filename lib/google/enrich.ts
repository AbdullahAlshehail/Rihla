// Google Places enrichment — pulls high-value fields for a place and stores
// them in the DB. Uses the LEGACY Places API (via getPlaceDetails) which is
// enabled by default on most keys.
//
// Cost-control:
//  - Only re-enriches when stale (>90 days) OR missing photo
//  - One Details call returns everything (Arabic reviews, photos, hours)
//  - Up to 3 photo URLs resolved once and cached forever in the DB

import { createWriteClient } from "@/lib/supabase/server";
import { getPlaceDetails, getPhotoUrl, searchPlaces, type LegacyReview } from "@/lib/google/places";
import type { GoogleReviewSnippet } from "@/lib/supabase/database.types";

export type EnrichResult = {
  ok: boolean;
  used_api: boolean;
  reason?: string;
  patch?: Partial<{
    photo_url: string | null;
    photo_urls: string[] | null;
    address: string | null;
    google_maps_url: string | null;
    website: string | null;
    phone: string | null;
    rating: number | null;
    review_count: number | null;
    price_level: number | null;
    google_reviews: GoogleReviewSnippet[] | null;
    opening_hours: string[] | null;
  }>;
};

export async function enrichPlaceFromGoogle(
  placeId: string,
  googlePlaceId: string,
  placeName?: string,
  cityHint?: string
): Promise<EnrichResult> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return { ok: false, used_api: false, reason: "no_api_key" };
  }

  // 1) Try the stored place_id first. Google rotates IDs occasionally, so
  //    if Details comes back empty AND we have a name, fall back to Text
  //    Search and refresh the stored ID transparently.
  let effectivePlaceId = googlePlaceId;
  let { place, mock } = await getPlaceDetails(effectivePlaceId);
  if (mock) return { ok: false, used_api: false, reason: "api_blocked_or_budget" };

  if (!place && placeName) {
    const query = cityHint ? `${placeName} ${cityHint}` : placeName;
    const fallback = await searchPlaces({ query });
    const best = fallback.places[0];
    if (best?.id && best.id !== googlePlaceId) {
      effectivePlaceId = best.id;
      const retry = await getPlaceDetails(effectivePlaceId);
      place = retry.place;
    }
  }
  if (!place) return { ok: false, used_api: true, reason: "place_not_found" };

  // 2) Resolve up to 3 photo URLs in parallel
  const photoRefs = (place.photos ?? []).slice(0, 3).map((p) => p.name).filter(Boolean);
  const photoResults = await Promise.all(photoRefs.map((ref) => getPhotoUrl(ref, 720)));
  const photo_urls = photoResults.filter((u): u is string => !!u);
  const photo_url = photo_urls[0] ?? null;

  // 3) Map reviews — legacy API already returns Arabic when available because
  //    we set language=ar. Arabic reviews first, then others.
  const seen = new Set<string>();
  const allReviews: LegacyReview[] = place._legacy?.reviews ?? [];
  const mapReview = (r: LegacyReview): GoogleReviewSnippet => ({
    author_name: r.author_name,
    rating: typeof r.rating === "number" ? r.rating : undefined,
    text: r.text ?? "",
    relative_time: r.relative_time_description,
    language: r.language,
  });

  const arabicFirst: GoogleReviewSnippet[] = allReviews
    .filter((r) => r.language === "ar")
    .map(mapReview)
    .filter((r) => r.text && r.text.length > 10 && !seen.has(r.text) && (seen.add(r.text), true));
  const otherReviews: GoogleReviewSnippet[] = allReviews
    .filter((r) => r.language !== "ar")
    .map(mapReview)
    .filter((r) => r.text && r.text.length > 10 && !seen.has(r.text) && (seen.add(r.text), true));

  const google_reviews = [...arabicFirst, ...otherReviews].slice(0, 6);

  // 4) Convert legacy opening_hours periods → 7-string-per-day array
  let opening_hours: string[] | null = null;
  const periods = place._legacy?.opening_periods;
  if (Array.isArray(periods)) {
    opening_hours = ["", "", "", "", "", "", ""];
    for (const p of periods) {
      if (!p.open) continue;
      const day = p.open.day; // 0=Sunday in legacy API too
      const openT = legacyTimeToAmPm(p.open.time);
      const closeT = p.close ? legacyTimeToAmPm(p.close.time) : "11:59 PM";
      const slot = `${openT} - ${closeT}`;
      opening_hours[day] = opening_hours[day] ? `${opening_hours[day]}, ${slot}` : slot;
    }
    // If all 7 are empty, drop the array
    if (opening_hours.every((s) => s === "")) opening_hours = null;
  }

  // 5) Compose patch
  const price_level = typeof place._legacy?.price_level_num === "number"
    ? place._legacy.price_level_num
    : null;

  const patch: EnrichResult["patch"] = {
    photo_url,
    photo_urls: photo_urls.length > 0 ? photo_urls : null,
    address: place.formattedAddress ?? null,
    google_maps_url: place.googleMapsUri ?? null,
    website: place.websiteUri ?? null,
    phone: place.internationalPhoneNumber ?? null,
    rating: typeof place.rating === "number" ? place.rating : null,
    review_count: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    price_level,
    google_reviews: google_reviews.length > 0 ? google_reviews : null,
    opening_hours,
  };

  // 6) Persist (only non-null fields) + refresh stored place_id if Google rotated it
  const cleanPatch: Record<string, unknown> = { enriched_at: new Date().toISOString() };
  if (effectivePlaceId !== googlePlaceId) {
    cleanPatch.google_place_id = effectivePlaceId;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined && (!Array.isArray(v) || v.length > 0)) {
      cleanPatch[k] = v;
    }
  }

  try {
    const sb = await createWriteClient();
    const { error: updErr } = await sb.from("places").update(cleanPatch).eq("id", placeId);
    if (updErr) {
      console.warn("[enrich] places.update failed:", updErr.message);
      return { ok: false, used_api: true, reason: `db_write_failed:${updErr.message}`, patch };
    }
  } catch (e) {
    return { ok: false, used_api: true, reason: "db_write_failed", patch };
  }

  return { ok: true, used_api: true, patch };
}

function legacyTimeToAmPm(t: string): string {
  // "HHMM" → "H:MM AM/PM"
  const hh = parseInt(t.slice(0, 2), 10);
  const mm = t.slice(2, 4);
  const ap = hh < 12 || hh === 24 ? "AM" : "PM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${ap}`;
}

// 9-month cache — Google place references are extremely stable and the user
// explicitly chose long-life caching to keep API spend at $0.
const ENRICH_TTL_DAYS = 270;
export function needsEnrichment(p: {
  google_place_id: string | null;
  photo_url: string | null;
  enriched_at: string | null;
}): boolean {
  if (!p.google_place_id) return false;
  if (!p.enriched_at) return true;
  const ageDays = (Date.now() - new Date(p.enriched_at).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > ENRICH_TTL_DAYS || !p.photo_url;
}
