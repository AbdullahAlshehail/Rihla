// Returns a single short Arabic reason explaining "why this place?" for
// carousel cards. Decision-oriented, never generic ("مميز" alone is banned).
//
// Priority is hand-tuned: the most decision-relevant signal wins. We use only
// data that already exists on the Place row + context — no fake claims.

import type { Place } from "@/lib/supabase/database.types";
import { haversineKm, estimateTravelTimes, isOpenNow } from "@/lib/utils";

export type WhyContext = {
  userLocation?: { lat: number; lng: number } | null;
  hotelLocation?: { lat: number; lng: number } | null;
  now?: Date;
};

export type WhyReason = {
  /** Short Arabic phrase, ≤ 30 chars, suitable for a carousel meta line. */
  text: string;
  /** Decorative emoji prefix (already included in `text` when relevant). */
  tone: "near" | "open" | "rated" | "gem" | "luxury" | "family" | "view" | "hotel" | "category" | "fallback";
};

/**
 * Pick ONE short reason for a card. Returns a safe fallback if no decisive
 * signal exists — never invents data.
 */
export function whyReason(place: Place, ctx: WhyContext = {}): WhyReason {
  // Walking distance + open — combines two strong signals ("قريب · مفتوح").
  // This is the single most decision-friendly line, so it wins when both true.
  const anchor = ctx.userLocation ?? null;
  const km = (anchor && place.lat != null && place.lng != null)
    ? haversineKm(anchor, { lat: place.lat, lng: place.lng })
    : null;
  const openStatus = isOpenNow(place.opening_hours, ctx.now);
  const isOpen = openStatus.kind === "open";

  // Walking distance (very close + open) — winning combo for "now?" decisions.
  if (km != null && km < 1.2 && isOpen) {
    const min = estimateTravelTimes(km).walkMin;
    return { text: `🚶 ${min} د · مفتوح الآن`, tone: "near" };
  }

  // Walking-only (very close, but closed or unknown hours)
  if (km != null && km < 1.0) {
    const min = estimateTravelTimes(km).walkMin;
    return { text: `🚶 على بعد ${min} د مشي`, tone: "near" };
  }

  // Reasonable distance + open — second-tier "go now" candidate.
  if (km != null && km < 5 && isOpen) {
    const min = estimateTravelTimes(km).driveMin;
    return { text: `🚗 ${min} د · مفتوح الآن`, tone: "open" };
  }

  // Hidden gem — high rating + medium crowd. The catalogue's editorial lever.
  // Uses the exact same threshold as computeSmartScore's gem bonus.
  if (
    place.rating != null && place.rating >= 4.6 &&
    place.review_count != null && place.review_count >= 80 && place.review_count <= 1500
  ) {
    return { text: "💎 هيدن جيم · تقييم عالي", tone: "gem" };
  }

  // Highlight-driven reasons — pick the most decision-relevant one
  const highlights = place.highlights ?? [];
  if (highlights.includes("family")) return { text: "👨‍👩‍👧 مناسب للعائلة", tone: "family" };
  if (highlights.includes("romantic")) return { text: "💑 رومانسي", tone: "view" };
  if (highlights.includes("view_great")) return { text: "🌅 إطلالة جميلة", tone: "view" };
  if (highlights.includes("iconic")) return { text: "🌟 أيقوني · لا يفوّت", tone: "view" };
  if (highlights.includes("legendary")) return { text: "📚 أسطوري · يعرفه الجميع", tone: "view" };
  if (highlights.includes("beach")) return { text: "🏖 شاطئ جميل", tone: "view" };

  // Luxury — fine dining / high price tier signal.
  if (place.kind === "fine_dining" || place.kind === "michelin") {
    return { text: "🎩 فاخر · مناسب للمناسبات", tone: "luxury" };
  }
  if (place.price_level != null && place.price_level >= 4) {
    return { text: "💰 فاخر", tone: "luxury" };
  }

  // High rating with strong review base — "الأعلى تقييماً"
  if (place.rating != null && place.rating >= 4.7 && (place.review_count ?? 0) >= 300) {
    return { text: `⭐ الأعلى تقييماً (${place.rating.toFixed(1)})`, tone: "rated" };
  }

  // Open now (no distance context)
  if (isOpen) {
    return { text: "🟢 مفتوح الآن", tone: "open" };
  }

  // Reasonable distance only
  if (km != null && km < 8) {
    const min = estimateTravelTimes(km).driveMin;
    return { text: `🚗 ${min} د من موقعك`, tone: "near" };
  }

  // Close to hotel — fallback only when no user location.
  if (
    ctx.hotelLocation && !anchor &&
    place.lat != null && place.lng != null
  ) {
    const kmH = haversineKm(ctx.hotelLocation, { lat: place.lat, lng: place.lng });
    if (kmH < 2) return { text: "🏨 قريب من فندقك", tone: "hotel" };
  }

  // Editor pick — soft signal, used only as fallback.
  if (place.is_editor_pick) return { text: "✨ اختيار محرّر", tone: "rated" };

  // Genuinely no decision signal — safe fallback (never lies).
  return { text: "اختيار مناسب قريب منك", tone: "fallback" };
}
