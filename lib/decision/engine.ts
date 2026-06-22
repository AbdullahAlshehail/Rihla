// Decision Engine — final verdict for "should I go to this place right now?"
//
// SEPARATE from lib/scoring/smartScore.ts. Smart Score is one signal feeding
// into the engine; the engine's job is to PICK A LANE: recommended / skip /
// closed_soon / too_far / over_budget / good_if_nearby / low_confidence.
//
// Pure function. No DB calls, no I/O. Caller composes context.

import type { Place, Currency } from "@/lib/supabase/database.types";
import { haversineKm, isOpenNow } from "@/lib/utils";

// ─── Public types ──────────────────────────────────────────────────────────

export type Verdict =
  | "recommended"      // ✨ go now
  | "good_if_nearby"   // 👍 worth it only if already nearby
  | "closed_soon"      // ⏰ open but closing within 60 min
  | "skip"             // ❌ don't go
  | "too_far"          // 🗺 too far to bother
  | "over_budget"      // 💸 exceeds remaining budget
  | "low_confidence";  // 🤷 not enough signal to commit

export type PreferenceMode =
  | "tired"         // less walking, things closer
  | "less_walk"     // same as tired but explicit
  | "luxury"        // weight price_level + fine_dining
  | "near"          // proximity-first WITH a quality floor (not just nearest)
  | "family"        // soft-prefer family-friendly, hard-block bars
  | "hotel_return"  // pick places near hotel or on-route for the trip back
  | null;           // balanced

export type Slot = "morning" | "midday" | "afternoon" | "evening" | "night";

export type UserHistory = {
  saved: string[];                              // place IDs
  ratings: Record<string, number>;              // 1–5
  verdicts: Record<string, "love" | "meh" | "skip">;
};

export type DecisionContext = {
  now: Date;
  currentLocation?: { lat: number; lng: number } | null;
  hotelLocation?: { lat: number; lng: number } | null;
  budgetRemainingSar?: number;
  preferenceMode?: PreferenceMode;
  smartScore?: number;
  userHistory?: UserHistory;
  // Optional FX rates to convert place.cost_estimate to SAR
  // Default values used if a currency is missing.
  rates?: Partial<Record<Currency, number>>;
  /** "off" → ignore budget completely; "soft" → score penalty + risk note;
   *  "strict" → may emit `over_budget` verdict and block. Default: "soft" if
   *  budgetRemainingSar is set, otherwise "off". */
  budgetMode?: "off" | "soft" | "strict";
};

export type Decision = {
  verdict: Verdict;
  ar: string;          // short Arabic chip text
  confidence: number;  // 0–100
  reason: string[];    // human-readable bullets
  bestSlot?: Slot;
};

// ─── Public constants ──────────────────────────────────────────────────────

export const VERDICT_LABEL_AR: Record<Verdict, string> = {
  recommended: "✨ الأفضل الآن",
  good_if_nearby: "👍 يستاهل لو قريب",
  closed_soon: "⏰ يقفل قريب",
  skip: "❌ تخطّه",
  too_far: "🗺 بعيد جداً",
  over_budget: "💸 فوق ميزانيتك",
  low_confidence: "🤷 معلومات ناقصة",
};

// Default FX rates → SAR (used if ctx.rates doesn't override).
const DEFAULT_RATES_TO_SAR: Record<Currency, number> = {
  SAR: 1,
  EUR: 4.1,
  USD: 3.75,
  GBP: 4.8,
  AED: 1.02,
};

// ─── Internal helpers ──────────────────────────────────────────────────────

function convertToSar(
  amount: number,
  currency: Currency,
  rates?: Partial<Record<Currency, number>>
): number {
  const r = rates?.[currency] ?? DEFAULT_RATES_TO_SAR[currency] ?? 1;
  return amount * r;
}

function minutesNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function minutesUntilClose(
  opening_hours: string[] | null,
  now: Date
): number | null {
  const info = isOpenNow(opening_hours, now);
  if (info.kind !== "open" || info.closeAt == null) return null;
  const cur = minutesNow(now);
  // closeAt is minute-of-day mod 1440; if it's earlier than cur, it wraps overnight.
  const diff = info.closeAt >= cur ? info.closeAt - cur : 1440 - cur + info.closeAt;
  return diff;
}

function timeOfDay(now: Date): Slot {
  const h = now.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 15) return "midday";
  if (h >= 15 && h < 18) return "afternoon";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

// "Does this category fit the current part of the day?" → small score in points.
function timeOfDayFitPoints(category: Place["category"], tod: Slot): number {
  // +8 / 0 / -8 grid by category × slot. Conservative — purely contextual.
  const table: Partial<Record<Place["category"], Partial<Record<Slot, number>>>> = {
    food:   { morning: -3, midday: 8, afternoon: 0, evening: 8, night: 4 },
    coffee: { morning: 8, midday: 4, afternoon: 4, evening: 0, night: -4 },
    sight:  { morning: 4, midday: 4, afternoon: 8, evening: 0, night: -8 },
    nature: { morning: 8, midday: 4, afternoon: 4, evening: 0, night: -8 },
    event:  { morning: -2, midday: 0, afternoon: 4, evening: 8, night: 8 },
    sweet:  { morning: 0, midday: 4, afternoon: 8, evening: 4, night: 2 },
    bar:    { morning: -8, midday: -4, afternoon: 0, evening: 8, night: 8 },
  };
  return table[category]?.[tod] ?? 0;
}

function timeOfDayReasonAr(category: Place["category"], tod: Slot): string {
  const fit = timeOfDayFitPoints(category, tod);
  if (fit >= 6) return "مناسب لهذا الوقت";
  if (fit <= -4) return "غير مناسب لهذا الوقت";
  return "";
}

// Suggested slot to place this on the day plan.
function suggestSlot(category: Place["category"]): Slot {
  switch (category) {
    case "coffee": return "morning";
    case "food":   return "evening";
    case "sight":  return "afternoon";
    case "nature": return "morning";
    case "event":  return "evening";
    case "sweet":  return "afternoon";
    case "bar":    return "night";
    default:       return "afternoon";
  }
}

function formatReviewsAr(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000)  return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── The main function ─────────────────────────────────────────────────────

export function decide(place: Place, ctx: DecisionContext): Decision {
  // ── L1: Hard blockers ────────────────────────────────────────────────────

  // 1a. User explicitly skipped before → hard skip (highest priority — respect choice)
  if (ctx.userHistory?.verdicts?.[place.id] === "skip") {
    return {
      verdict: "skip",
      ar: VERDICT_LABEL_AR.skip,
      confidence: 100,
      reason: ["تخطّيته في زيارة سابقة"],
    };
  }

  // 1b. Family mode excludes bars/nightclubs categorically
  if (ctx.preferenceMode === "family" && place.category === "bar") {
    return {
      verdict: "skip",
      ar: VERDICT_LABEL_AR.skip,
      confidence: 95,
      reason: ["غير مناسب للعائلة"],
    };
  }

  // 1c. Closed right now → skip
  const openInfo = isOpenNow(place.opening_hours, ctx.now);
  if (openInfo.kind === "shut") {
    return {
      verdict: "skip",
      ar: VERDICT_LABEL_AR.skip,
      confidence: 90,
      reason: ["مغلق الآن"],
    };
  }

  // ── L2: Budget check — only as a HARD gate when budgetMode === "strict".
  // Default behavior is "soft": budget influences ranking + shows a risk note
  // but never excludes a place. The Now Screen pages default to "soft".
  if (
    ctx.budgetMode === "strict" &&
    ctx.budgetRemainingSar != null &&
    place.cost_estimate != null &&
    place.cost_estimate > 0
  ) {
    const costSar = convertToSar(place.cost_estimate, place.cost_currency, ctx.rates);
    if (costSar > ctx.budgetRemainingSar * 1.1) {
      return {
        verdict: "over_budget",
        ar: VERDICT_LABEL_AR.over_budget,
        confidence: 88,
        reason: [
          `التكلفة ~${Math.round(costSar)} ر.س`,
          `الباقي من ميزانية اليوم ${Math.round(ctx.budgetRemainingSar)} ر.س`,
        ],
      };
    }
  }

  // ── L3: Closes soon? (only if currently open) ────────────────────────────
  const minToClose = minutesUntilClose(place.opening_hours, ctx.now);
  if (minToClose != null && minToClose <= 60) {
    return {
      verdict: "closed_soon",
      ar: VERDICT_LABEL_AR.closed_soon,
      confidence: 85,
      reason: [`يقفل خلال ${minToClose} دقيقة — لا يكفي للتجربة`],
    };
  }

  // ── L4: Distance gate ────────────────────────────────────────────────────
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  const placeLoc =
    place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : null;
  const distanceKm = ref && placeLoc ? haversineKm(ref, placeLoc) : null;

  const rating = place.rating ?? 0;
  const reviewCount = place.review_count ?? 0;
  const isExceptional = rating >= 4.8 || place.is_editor_pick;

  if (distanceKm != null) {
    // Tired / less_walk modes are stricter
    if (
      (ctx.preferenceMode === "tired" || ctx.preferenceMode === "less_walk") &&
      distanceKm > 5
    ) {
      return {
        verdict: "too_far",
        ar: VERDICT_LABEL_AR.too_far,
        confidence: 80,
        reason: [`${distanceKm.toFixed(1)}كم — مشي طويل لوضعك الحالي`],
      };
    }
    // Hard "too far" — unless exceptional
    if (distanceKm > 20 && !isExceptional) {
      return {
        verdict: "too_far",
        ar: VERDICT_LABEL_AR.too_far,
        confidence: 82,
        reason: [`${distanceKm.toFixed(1)}كم ولا يستاهل مشوار خاص`],
      };
    }
  }

  // ── L5: Quality threshold (low confidence) ───────────────────────────────
  const userSaved = ctx.userHistory?.saved?.includes(place.id) ?? false;
  const trusted = place.is_editor_pick || userSaved;

  // Use the original nullable rating so unrated places (place.rating == null)
  // aren't lumped together with genuinely-low-rated places (rating < 3.8).
  const placeRatingMissing = place.rating == null;
  if (!trusted && (placeRatingMissing || rating < 3.8 || reviewCount < 30)) {
    const why: string[] = [];
    if (!placeRatingMissing && rating < 3.8) why.push(`تقييم ${rating.toFixed(1)}★`);
    if (placeRatingMissing) why.push("بلا تقييم بعد");
    if (reviewCount < 30) why.push(`${reviewCount} مراجعة فقط`);
    return {
      verdict: "low_confidence",
      ar: VERDICT_LABEL_AR.low_confidence,
      confidence: 65,
      reason: why,
    };
  }

  // ── L6: Synthesis — recommended vs good_if_nearby ────────────────────────
  let confidence = 60;
  const positives: string[] = [];
  const negatives: string[] = [];

  // Rating contribution
  if (rating >= 4.8) {
    confidence += 18;
    positives.push(`★${rating.toFixed(1)} ممتاز`);
  } else if (rating >= 4.5) {
    confidence += 12;
    positives.push(`★${rating.toFixed(1)}`);
  } else if (rating >= 4.0) {
    confidence += 4;
    positives.push(`★${rating.toFixed(1)}`);
  } else if (rating >= 3.8) {
    confidence += 0;
  }

  // Review-count trust
  if (reviewCount >= 5000) {
    confidence += 6;
    positives.push(`${formatReviewsAr(reviewCount)} مراجعة`);
  } else if (reviewCount >= 500) {
    confidence += 3;
    positives.push(`${formatReviewsAr(reviewCount)} مراجعة`);
  }

  // Hidden-gem bonus
  if (rating >= 4.6 && reviewCount >= 80 && reviewCount <= 1500) {
    confidence += 5;
    positives.push("💎 جودة عالية وزحمة أقل");
  }

  // Editor pick
  if (place.is_editor_pick) {
    confidence += 8;
    positives.push("اختيار محرّر");
  }

  // User history positives
  if (ctx.userHistory?.verdicts?.[place.id] === "love") {
    confidence += 18;
    positives.push("أحببته سابقاً");
  }
  if (userSaved) {
    confidence += 6;
    positives.push("في محفوظاتك");
  }
  const userStars = ctx.userHistory?.ratings?.[place.id];
  if (userStars != null && userStars >= 4) {
    confidence += 8;
    positives.push(`قيّمته ${userStars}★`);
  }

  // Distance reasons (and tighter scoring)
  if (distanceKm != null) {
    if (distanceKm < 2) {
      confidence += 10;
      positives.push(`قريب جداً (${distanceKm.toFixed(1)}كم)`);
    } else if (distanceKm < 5) {
      confidence += 5;
      positives.push(`قريب (${distanceKm.toFixed(1)}كم)`);
    } else if (distanceKm < 12) {
      // Neutral by default. In "near" mode the user explicitly asked for
      // close places — 2-12km is still acceptable but earns a small nudge
      // DOWN so genuine sub-2km picks rise. (Was -8 which over-punished.)
      if (ctx.preferenceMode === "near") confidence -= 3;
    } else {
      confidence -= 8;
      negatives.push(`بعيد (${distanceKm.toFixed(1)}كم)`);
    }
  }

  // Time-of-day fit
  const tod = timeOfDay(ctx.now);
  const todFit = timeOfDayFitPoints(place.category, tod);
  confidence += todFit;
  const todReason = timeOfDayReasonAr(place.category, tod);
  if (todFit >= 6) positives.push(todReason);
  else if (todFit <= -4) negatives.push(todReason);

  // Preference mode fine-tuning
  if (ctx.preferenceMode === "luxury") {
    if (place.price_level != null && place.price_level >= 3) {
      confidence += 6;
      positives.push("راقي يناسب الوضع");
    } else if (place.price_level != null && place.price_level < 3 && rating < 4.6) {
      confidence -= 10;
      negatives.push("ليس فاخراً بما يكفي");
    }
  }
  if (ctx.preferenceMode === "tired" && distanceKm != null && distanceKm < 2) {
    confidence += 4;
  }

  // Smart Score as a secondary signal
  if (ctx.smartScore != null) {
    if (ctx.smartScore >= 85) confidence += 5;
    else if (ctx.smartScore >= 70) confidence += 2;
    else if (ctx.smartScore < 50) confidence -= 4;
  }

  // Clamp
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  // Compose final reason list — keep it short and readable
  const reason: string[] = [];
  reason.push(...positives.slice(0, 3));
  if (negatives.length > 0) reason.push(negatives[0]);

  const bestSlot = suggestSlot(place.category);
  const closeEnough = distanceKm == null || distanceKm < 8;

  // Final classification
  if (confidence >= 80 && (closeEnough || isExceptional)) {
    return {
      verdict: "recommended",
      ar: VERDICT_LABEL_AR.recommended,
      confidence,
      reason: reason.length > 0 ? reason : ["خيار قوي الآن"],
      bestSlot,
    };
  }
  if (confidence >= 65) {
    return {
      verdict: "good_if_nearby",
      ar: VERDICT_LABEL_AR.good_if_nearby,
      confidence,
      reason: reason.length > 0 ? reason : ["خيار محتمل"],
      bestSlot,
    };
  }
  // Below 65 — but not blocked. Fall into low_confidence vs good_if_nearby.
  if (rating < 4.0 || reviewCount < 100) {
    return {
      verdict: "low_confidence",
      ar: VERDICT_LABEL_AR.low_confidence,
      confidence,
      reason: reason.length > 0 ? reason : ["إشارات ضعيفة"],
    };
  }
  return {
    verdict: "good_if_nearby",
    ar: VERDICT_LABEL_AR.good_if_nearby,
    confidence,
    reason: reason.length > 0 ? reason : ["خيار متاح"],
    bestSlot,
  };
}

// ─── Phase 2A helpers ────────────────────────────────────────────────────
// Pure derivations used by NowScreen / NowCard / PlaceCard. They DO NOT
// duplicate computeSmartScore: they read fields already present on the place
// and reuse `decide()`'s confidence as the trust signal.

const FAMILY_HOSTILE: ReadonlySet<Place["category"]> = new Set(["bar"]);
const FAMILY_HOSTILE_KINDS: ReadonlySet<string> = new Set([
  "nightclub", "rooftop_bar", "lounge", "cocktail_bar", "speakeasy",
]);
const FAMILY_FRIENDLY_KINDS: ReadonlySet<string> = new Set([
  "family", "playground", "aquarium", "zoo", "amusement_park", "kids",
  "garden", "park", "beach", "promenade", "ice_cream", "candy",
]);

/** Does this place clear a minimum bar of trustworthiness?
 *
 *  Used by "near" mode and the hotel-return suggestion so we never surface a
 *  random 3.6★ nobody-knows place just because it happens to be close. */
export function meetsQualityFloor(place: Place, decision?: Decision): boolean {
  if (place.is_editor_pick) return true;
  const r = place.rating ?? 0;
  const c = place.review_count ?? 0;
  if (r >= 4.5 && c >= 30) return true;
  if (r >= 4.2 && c >= 80) return true;
  if (decision && decision.confidence >= 70) return true;
  return false;
}

/** True when the trip's anchor is this place's hotel (for chip labels). */
export function isPlaceNearHotel(
  place: Place,
  hotel?: { lat: number; lng: number } | null,
  kmRadius = 3,
): boolean {
  if (!hotel || place.lat == null || place.lng == null) return false;
  return haversineKm(hotel, { lat: place.lat, lng: place.lng }) <= kmRadius;
}

/** Rough "on route" check: place sits between user and hotel.
 *
 *  Approximation = sum of legs (user→place + place→hotel) shouldn't exceed
 *  the direct leg by more than `detourKm`. Avoids vector-projection math
 *  for a pure-geo proxy good enough for client-side ranking. */
export function isOnRouteHome(
  place: Place,
  from?: { lat: number; lng: number } | null,
  to?: { lat: number; lng: number } | null,
  detourKm = 3,
): boolean {
  if (!from || !to || place.lat == null || place.lng == null) return false;
  const direct = haversineKm(from, to);
  if (direct < 0.5) return false; // user is basically AT the hotel
  const viaPlace =
    haversineKm(from, { lat: place.lat, lng: place.lng }) +
    haversineKm({ lat: place.lat, lng: place.lng }, to);
  return viaPlace - direct <= detourKm;
}

export type NowScoreOptions = {
  /** Penalize repeats of a category we've already shown to avoid e.g.
   *  three coffees in a row. Pass the categories of the already-picked cards. */
  alreadyPickedCategories?: Place["category"][];
};

/** Composite ranking score for the Now Screen.
 *
 *  Layer over `decide()`. Inputs:
 *   - decision.confidence       (rating + reviews + open + history)
 *   - distance from current loc (the "closer = lighter today" signal)
 *   - remaining day time        (skip 90-min experiences at 10pm)
 *   - remaining budget          (don't promote a 600 SAR meal when 200 left)
 *   - preference mode           (each mode tilts the weights)
 *   - variety penalty           (subtract for repeats so the 3 cards differ)
 *   - minimum quality guard     (heavily down-weight sub-floor places)
 *
 *  Returns a number 0–100, clamped. Higher = better fit RIGHT NOW. */
export function nowScore(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
  options?: NowScoreOptions,
): number {
  // Closed/over_budget/skip/too_far → never compete for a card.
  if (
    decision.verdict === "skip" ||
    decision.verdict === "too_far" ||
    decision.verdict === "over_budget"
  ) {
    return 0;
  }

  let s = decision.confidence; // base trust

  // — Distance from current (or hotel) location
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  let distanceKm: number | null = null;
  if (ref && place.lat != null && place.lng != null) {
    distanceKm = haversineKm(ref, { lat: place.lat, lng: place.lng });
  }

  if (distanceKm != null) {
    if (distanceKm < 1) s += 6;
    else if (distanceKm < 3) s += 3;
    else if (distanceKm < 6) s += 0;
    else if (distanceKm < 12) s -= 4;
    else s -= 10;
  }

  // — Remaining day time. Estimate ~75min for food, 60min for sights,
  // 45min for coffee/sweet, plus drive time. If we're past 9pm, sight/nature
  // shouldn't compete.
  const minutesRemaining = (() => {
    const end = new Date(ctx.now);
    end.setHours(23, 0, 0, 0);
    return Math.max(0, Math.round((end.getTime() - ctx.now.getTime()) / 60000));
  })();
  const visitMin =
    place.category === "food"   ? 90 :
    place.category === "sight"  ? 70 :
    place.category === "event"  ? 80 :
    place.category === "nature" ? 60 :
    place.category === "bar"    ? 60 :
                                  40;
  const driveBack = distanceKm != null ? Math.round(distanceKm * 1.6) : 10;
  const totalNeeded = visitMin + driveBack;
  if (minutesRemaining < totalNeeded) {
    // Squeezing — heavy penalty if we can't even fit half the visit
    s -= minutesRemaining < totalNeeded / 2 ? 15 : 6;
  }

  // — Remaining budget — only penalize when budgetMode is on. Hard-block is
  // already done by L2 over_budget in decide() (audit fix 2026-06-15 B3).
  if (
    ctx.budgetMode !== "off"
    && ctx.budgetRemainingSar != null
    && place.cost_estimate != null && place.cost_estimate > 0
  ) {
    const rate = ctx.rates?.[place.cost_currency] ?? DEFAULT_RATES_TO_SAR[place.cost_currency] ?? 1;
    const costSar = place.cost_estimate * rate;
    if (costSar > ctx.budgetRemainingSar * 0.6 && costSar <= ctx.budgetRemainingSar * 1.1) {
      // Eats most of the day's budget — still acceptable but score down so
      // a cheaper great option wins when both are tied.
      s -= 5;
    }
  }

  // — Mode-aware tilts
  switch (ctx.preferenceMode) {
    case "near":
      // Quality floor applied BEFORE distance, so we don't surface a random
      // 3.6★ nobody-knows place just because it's close.
      if (!meetsQualityFloor(place, decision)) s -= 25;
      if (distanceKm != null && distanceKm < 2) s += 8;
      break;
    case "tired":
    case "less_walk":
      // Shorter visit duration is better when tired
      if (visitMin <= 50) s += 4;
      if (distanceKm != null && distanceKm > 3) s -= 6;
      break;
    case "luxury":
      if ((place.price_level ?? 0) >= 3) s += 6;
      if (place.is_editor_pick || place.kind === "fine_dining" || place.kind === "michelin") s += 5;
      // No exclusion when over budget — show with risk note instead
      break;
    case "family":
      if (FAMILY_HOSTILE.has(place.category)) s -= 100; // belt-and-braces
      if (place.kind && FAMILY_HOSTILE_KINDS.has(place.kind)) s -= 100;
      if (place.kind && FAMILY_FRIENDLY_KINDS.has(place.kind)) s += 6;
      // Soft signal — if data is sparse, just don't punish
      break;
    case "hotel_return":
      // Reward proximity to hotel + on-route
      if (isPlaceNearHotel(place, ctx.hotelLocation, 2.5)) s += 14;
      else if (isPlaceNearHotel(place, ctx.hotelLocation, 5)) s += 8;
      if (isOnRouteHome(place, ctx.currentLocation, ctx.hotelLocation, 3)) s += 10;
      // Shorter visit duration preferred — it's the last stop before bed
      if (visitMin <= 50) s += 3;
      break;
    case null:
    case undefined:
      break;
  }

  // — Variety penalty: discourage 3 coffees in a row
  const already = options?.alreadyPickedCategories ?? [];
  const repeats = already.filter((c) => c === place.category).length;
  if (repeats >= 1) s -= 6;
  if (repeats >= 2) s -= 14;

  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Human-readable "ليش اخترناه؟" sentence for a card.
 *
 *  Tone-aware. Doesn't repeat what's already in `decision.reason` — it
 *  composes a fresh sentence prioritizing what's distinctive about THIS pick.
 *  Falls back to cautious language when signal is sparse. */
export function whyRecommended(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
  tone: "best" | "near" | "luxury" | "hotel_return",
): string {
  const r = place.rating ?? 0;
  const c = place.review_count ?? 0;
  const openInfo = isOpenNow(place.opening_hours, ctx.now);
  const isOpen = openInfo.kind === "open" || openInfo.kind === "free";
  const isFreeform = openInfo.kind === "free";
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  const distKm = ref && place.lat != null && place.lng != null
    ? haversineKm(ref, { lat: place.lat, lng: place.lng })
    : null;
  const veryClose = distKm != null && distKm < 1.5;
  const moderatelyFar = distKm != null && distKm >= 1.5 && distKm < 8;
  const far = distKm != null && distKm >= 8;
  const tod = (() => {
    const h = ctx.now.getHours();
    if (h < 11) return "morning";
    if (h < 15) return "midday";
    if (h < 18) return "afternoon";
    if (h < 22) return "evening";
    return "night";
  })();

  // Tone-specific opening
  switch (tone) {
    case "near":
      if (!meetsQualityFloor(place, decision)) {
        return "أقرب خيار متاح، التقييم متواضع — قرّر إذا الراحة أهم.";
      }
      if (veryClose && isOpen && !isFreeform) {
        return "قريب ومفتوح ومناسب إذا تبي خيار سريع.";
      }
      if (veryClose) {
        return "قريب جداً منك ويستاهل تجربة سريعة.";
      }
      return "أقرب خيار جيد بدون تنازل واضح عن الجودة.";
    case "luxury":
      if (r >= 4.7 && (place.price_level ?? 0) >= 3) {
        return "تجربة راقية وتقييمها عالي — تستاهل المناسبة.";
      }
      if (place.is_editor_pick) return "اختيار محرّر — مستوى فوق المتوسط.";
      if ((place.price_level ?? 0) >= 3) return "خيار راقي مناسب للأمسيات المميّزة.";
      return "أرقى ما يطلع بالشروط الحالية.";
    case "hotel_return":
      if (isPlaceNearHotel(place, ctx.hotelLocation, 2.5)) {
        return "قريب من فندقك — وقفة قبل الرجوع.";
      }
      if (isOnRouteHome(place, ctx.currentLocation, ctx.hotelLocation, 3)) {
        return "على طريقك للفندق — بدون مشوار إضافي.";
      }
      return "مناسب كآخر محطة قبل الرجوع.";
    case "best":
    default: {
      if (place.is_editor_pick && r >= 4.6) {
        return "اختيار محرّر بتقييم ممتاز — خيار قوي.";
      }
      if (r >= 4.7 && c >= 500) {
        return "موثوق وحاز إعجاب آلاف الزوار — خيار آمن.";
      }
      if (place.category === "coffee" && tod === "morning") {
        return "قهوة مناسبة للصباح وليست فقط مكان تصوير.";
      }
      if (moderatelyFar && r >= 4.6) {
        return "جودته أعلى من الخيارات القريبة ويستاهل المشوار.";
      }
      if (far && r >= 4.7) {
        return "بعيد، لكن جودته فعلاً تستاهل المشوار الخاص.";
      }
      if (veryClose && isOpen) {
        return "قريب ومفتوح وأقوى خيار حواليك الآن.";
      }
      // Cautious fallback when signal is thin
      if (c < 100 || isFreeform) {
        return "يبدو مناسبًا بناءً على التصنيف والإشارات المتاحة.";
      }
      return "أفضل توازن بين التقييم والمسافة والوقت.";
    }
  }
}

/** Short list of risks the user should know BEFORE going. Don't hide them —
 *  but keep them brief. Empty when nothing to warn about. */
export function riskNotes(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
): string[] {
  const out: string[] = [];
  const r = place.rating ?? 0;
  const c = place.review_count ?? 0;

  // Hours unknown — user should phone-check before going
  const openInfo = isOpenNow(place.opening_hours, ctx.now);
  if (openInfo.kind === "free") {
    out.push("تحقق من ساعات العمل قبل الذهاب.");
  }

  // Closes soon
  if (openInfo.kind === "open" && openInfo.closeAt != null) {
    const curMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
    const diff = openInfo.closeAt >= curMin
      ? openInfo.closeAt - curMin
      : 1440 - curMin + openInfo.closeAt;
    if (diff <= 75 && diff > 0) out.push(`يقفل بعد ${diff} دقيقة — وقت ضيّق.`);
  }

  // Few reviews
  if (r >= 4.6 && c > 0 && c < 30) {
    out.push("التقييم عالي لكن عدد المراجعات قليل.");
  }

  // Distance
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  if (ref && place.lat != null && place.lng != null) {
    const km = haversineKm(ref, { lat: place.lat, lng: place.lng });
    if (km > 15) out.push("بعيد؛ لا يستاهل إلا إذا تبي تجربة مميّزة.");
  }

  // Budget pressure (decide() already blocks at >110%, but warn at >60%).
  // Suppress the warning when budget tracking is off (audit fix 2026-06-15 B3).
  if (
    ctx.budgetMode !== "off" &&
    ctx.budgetRemainingSar != null &&
    place.cost_estimate != null &&
    place.cost_estimate > 0
  ) {
    const rate = ctx.rates?.[place.cost_currency] ?? DEFAULT_RATES_TO_SAR[place.cost_currency] ?? 1;
    const sar = place.cost_estimate * rate;
    if (sar > ctx.budgetRemainingSar * 0.6 && sar <= ctx.budgetRemainingSar * 1.1) {
      out.push("قد يستهلك معظم ميزانية اليوم.");
    }
  }

  // Trending crowd risk
  const tagText = ((place.tags ?? []).join(" ") + " " + (place.highlights ?? []).join(" ")).toLowerCase();
  if (/trending|ترند|انستقرام|انستاجرام|instagram|viral/i.test(tagText) && c > 1000) {
    out.push("قد يكون مزدحم لأنه ترند حالياً.");
  }

  return out.slice(0, 2); // never more than 2 — readability
}

// ─── Phase 2B: Intent-driven Now Decisions ───────────────────────────────
//
// The Now Screen stopped being a filter page in Phase 2B. The user picks
// an INTENT ("what do I need right now?") and the engine returns ranked
// cards labelled by the role they fill. Filters stay tucked behind the
// chosen intent as optional refinements.

/** Possible user intents on the Now Screen. The first batch is always shown;
 *  the second batch shows only when its context applies. */
export type Intent =
  | "decide_for_me"   // ⚡ "just pick one"
  | "near_safe"       // 📍 close + decent quality
  | "light_easy"      // 😴 short visit, little walking
  | "coffee"          // ☕ coffee or sweet
  | "food"            // 🍽 meal now
  | "photo"           // 📸 photogenic / scenic
  | "before_hotel"    // 🏨 last stop on the way home
  | "sunset"          // 🌅 only near golden hour
  | "nightlife"       // 🌙 only late evening
  | "family"          // 👨‍👩‍👧 kids-friendly
  | "luxury"          // 💎 splurge
  | "trending"        // 🔥 viral
  | "local"           // 🇸🇦 authentic to destination
  | "quiet";          // 🧘 calm / no crowds

export type IntentMeta = {
  key: Intent;
  ar: string;
  emoji: string;
  /** Hint shown as subtitle when the chip is the only active intent. */
  hint?: string;
};

export const INTENT_META: Record<Intent, IntentMeta> = {
  decide_for_me: { key: "decide_for_me", ar: "قرّر لي",        emoji: "⚡", hint: "أعطني أفضل خيار بدون تفكير." },
  near_safe:     { key: "near_safe",     ar: "قريب ومضمون",   emoji: "📍", hint: "قريب — مع حد أدنى من الجودة." },
  light_easy:    { key: "light_easy",    ar: "خفيف ومريح",    emoji: "😴", hint: "مشي قليل وزيارة قصيرة." },
  coffee:        { key: "coffee",        ar: "قهوة أو حلى",   emoji: "☕", hint: "قهاوي + حلويات بإشارات مميّزة." },
  food:          { key: "food",          ar: "أكل الآن",      emoji: "🍽", hint: "مطاعم مفتوحة الآن ومناسبة للوقت." },
  photo:         { key: "photo",         ar: "مكان حلو",      emoji: "📸", hint: "إطلالات/ديكور/معالم بصرية." },
  before_hotel:  { key: "before_hotel",  ar: "قبل الفندق",    emoji: "🏨", hint: "محطة في طريقك للفندق." },
  sunset:        { key: "sunset",        ar: "غروب",          emoji: "🌅" },
  nightlife:     { key: "nightlife",     ar: "سهرة",          emoji: "🌙" },
  family:        { key: "family",        ar: "عائلة",         emoji: "👨‍👩‍👧" },
  luxury:        { key: "luxury",        ar: "فخم",           emoji: "💎" },
  trending:      { key: "trending",      ar: "ترند",          emoji: "🔥" },
  local:         { key: "local",         ar: "محلي",          emoji: "🇸🇦" },
  quiet:         { key: "quiet",         ar: "هادي",          emoji: "🧘" },
};

/** Sub-filter chips that show only when a relevant intent is active.
 *  Each sub-filter adds a small score boost when matched — never a hard cut. */
export type CoffeeSubfilter = "specialty" | "quiet_seating" | "photogenic" | "pastry" | "trending" | "near" | "outdoor";
export type FoodSubfilter   = "quick" | "local" | "family" | "luxury" | "budget" | "dinner";
export type PhotoSubfilter  = "view" | "sunset" | "rooftop" | "monument" | "interior" | "nature";

export type IntentSubfilters = {
  coffee?: ReadonlySet<CoffeeSubfilter>;
  food?:   ReadonlySet<FoodSubfilter>;
  photo?:  ReadonlySet<PhotoSubfilter>;
};

// ─── Time budget ─────────────────────────────────────────────────────────

export type TimeBudget = "tight" | "moderate" | "ample" | "spacious";

export function timeBudgetFromMinutes(minutesRemaining: number): TimeBudget {
  if (minutesRemaining < 90) return "tight";
  if (minutesRemaining < 180) return "moderate";
  if (minutesRemaining < 300) return "ample";
  return "spacious";
}

export function timeBudgetStatusAr(tb: TimeBudget): string {
  switch (tb) {
    case "tight":    return "وقتك ضيّق — الأفضل خيار قريب وسريع.";
    case "moderate": return "عندك وقت لمحطة قوية أو اثنتين خفيفتين.";
    case "ample":    return "وقتك مناسب لخطة من محطتين.";
    case "spacious": return "وقتك مفتوح — تقدر تخطط ٢–٣ محطات.";
  }
}

/** Default visit minutes by category — tweak via tags later if needed. */
export function estimateVisitMin(place: Place): number {
  switch (place.category) {
    case "food":   return 90;
    case "sight":  return 70;
    case "event":  return 80;
    case "nature": return 60;
    case "bar":    return 60;
    case "coffee": return 45;
    case "sweet":  return 35;
    default:       return 45;
  }
}

/** Drive time guess in minutes (used for "arriving in X min" labels). */
export function estimateDriveMinFor(distanceKm: number | null): number | null {
  if (distanceKm == null) return null;
  // Match utils.ts buckets, simplified
  if (distanceKm < 2)       return Math.max(2, Math.round(distanceKm * 4));
  if (distanceKm < 6)       return Math.round(distanceKm * 3.7);
  if (distanceKm < 15)      return Math.round(distanceKm * 3.1);
  if (distanceKm < 35)      return Math.round(distanceKm * 1.6);
  return Math.round(distanceKm * 1.0);
}

export type OpenAtArrival = "open" | "closed" | "closes_soon" | "unknown";

/** What will the open status be when we ARRIVE, not now. */
export function openAtArrival(
  place: Place,
  now: Date,
  travelMin: number | null,
): OpenAtArrival {
  const arrival = new Date(now.getTime() + (travelMin ?? 0) * 60_000);
  const info = isOpenNow(place.opening_hours, arrival);
  if (info.kind === "free") return "unknown";
  if (info.kind === "shut") return "closed";
  // Open. How long until it closes from arrival?
  if (info.closeAt != null) {
    const cur = arrival.getHours() * 60 + arrival.getMinutes();
    const diff = info.closeAt >= cur ? info.closeAt - cur : 1440 - cur + info.closeAt;
    if (diff <= 45) return "closes_soon";
  }
  return "open";
}

// ─── Now Card data structure ────────────────────────────────────────────

export type CardLabel =
  | "best_now"
  | "near_safe"
  | "light_easy"
  | "alt"
  | "before_hotel"
  | "more";

export const CARD_LABEL_META: Record<CardLabel, { ar: string; emoji: string; accent: string }> = {
  best_now:     { ar: "أفضل قرار الآن",  emoji: "✨", accent: "border-coral" },
  near_safe:    { ar: "قريب ومضمون",     emoji: "📍", accent: "border-emerald-400" },
  light_easy:   { ar: "خفيف ومريح",      emoji: "😴", accent: "border-sky-300" },
  alt:          { ar: "خيار مختلف يستاهل", emoji: "💎", accent: "border-violet-400" },
  before_hotel: { ar: "قبل الفندق",      emoji: "🏨", accent: "border-sky-400" },
  more:         { ar: "خيار آخر",        emoji: "•",  accent: "border-stone-200" },
};

export type NowCardData = {
  place: Place;
  decision: Decision;
  label: CardLabel;
  score: number;
  /** One-sentence "ليش هذا؟" answer */
  reason: string;
  /** Bulleted breakdown for the "لماذا هذا؟" expansion */
  reasonBullets: string[];
  riskNotes: string[];
  distanceKm: number | null;
  travelMin: number | null;
  travelMode: "walk" | "drive" | null;
  visitMin: number;
  openAtArrival: OpenAtArrival;
  costLabel: string | null;
  ratingLabel: string | null;
};

// ─── Intent-aware scoring ────────────────────────────────────────────────

const PHOTO_KINDS = new Set([
  "rooftop", "viewpoint", "landmark", "monument", "garden",
  "beach", "park", "promenade", "museum",
]);
const QUIET_REGEX = /quiet|peaceful|calm|هادئ|هادي|سكون|ريلاكس|relax/i;
const TRENDING_REGEX = /trending|ترند|viral|انستقرام|انستاجرام|انستجرام|instagram/i;
const LOCAL_REGEX = /saudi|نجدي|najdi|سعودي|nicois|نيس|provençal|provencal|french|فرنسي|local/i;
const SUNSET_REGEX = /sunset|غروب|view|إطلال|مطل|rooftop|روف ?توب/i;

function pricePerPersonSar(place: Place, rates?: Partial<Record<Currency, number>>): number | null {
  if (place.cost_estimate == null || place.cost_estimate <= 0) return null;
  const r = rates?.[place.cost_currency] ?? DEFAULT_RATES_TO_SAR[place.cost_currency] ?? 1;
  return place.cost_estimate * r;
}

export type IntentScoreOptions = NowScoreOptions & {
  timeBudget?: TimeBudget;
  /** Whether budget influences score at all. False → ignore. */
  useBudget?: boolean;
  /** Per-intent sub-filter sets. Each match adds a small boost. */
  subfilters?: IntentSubfilters;
};

/** Composite Now Decision Score for a chosen intent.
 *
 *  Builds on nowScore() (which captures distance, confidence, variety,
 *  remaining time, soft budget). On top, intent + sub-filters tilt the
 *  result so each lane returns DIFFERENT places. */
export function nowScoreForIntent(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
  intent: Intent,
  opts?: IntentScoreOptions,
): number {
  if (decision.verdict === "skip" || decision.verdict === "too_far") return 0;
  // over_budget verdicts only exist when budgetMode === "strict" upstream.
  // When the caller wants to ignore budget (useBudget === false), score the
  // place anyway — otherwise we silently drop strict-mode rows that the user
  // has explicitly opted out of (audit fix 2026-06-15 B1).
  if (decision.verdict === "over_budget" && opts?.useBudget !== false) return 0;

  // Base composite — strip budget if not wanted
  const baseCtx = opts?.useBudget === false
    ? { ...ctx, budgetRemainingSar: undefined, budgetMode: "off" as const }
    : ctx;
  let s = nowScore(place, decision, baseCtx, opts);

  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  const distKm = ref && place.lat != null && place.lng != null
    ? haversineKm(ref, { lat: place.lat, lng: place.lng })
    : null;
  const visitMin = estimateVisitMin(place);
  const tagText = ((place.tags ?? []).join(" ") + " " + (place.highlights ?? []).join(" ")).toLowerCase();
  const text = `${place.name ?? ""} ${tagText} ${place.ai_summary ?? ""} ${place.review_summary ?? ""}`.toLowerCase();

  // Time-budget tilts
  switch (opts?.timeBudget) {
    case "tight":
      // Heavy bias toward short visits and close-by places
      if (visitMin <= 50) s += 12;
      else if (visitMin >= 90) s -= 10;
      if (distKm != null) {
        if (distKm < 2) s += 6;
        else if (distKm > 6) s -= 8;
      }
      break;
    case "moderate":
      if (visitMin <= 80) s += 4;
      else if (visitMin >= 110) s -= 4;
      break;
    case "ample":
      if (visitMin >= 60) s += 2;
      break;
    case "spacious":
      // Anything goes — slight bonus for richer visits
      if (visitMin >= 80) s += 3;
      break;
  }

  // Intent-specific tilts
  switch (intent) {
    case "decide_for_me":
      // Pure composite — nothing extra. nowScore + time budget speak for themselves.
      break;

    case "near_safe":
      if (!meetsQualityFloor(place, decision)) s -= 30;
      if (distKm != null && distKm < 2) s += 10;
      if (distKm != null && distKm > 6) s -= 6;
      break;

    case "light_easy":
      if (visitMin <= 50) s += 8;
      if (distKm != null && distKm > 3) s -= 8;
      // Prefer indoor/seated categories; deprioritize hike-style nature
      if (place.category === "sight") s -= 4;
      if (place.category === "coffee" || place.category === "sweet") s += 4;
      break;

    case "coffee":
      if (place.category !== "coffee" && place.category !== "sweet") return 0;
      // Sub-filters
      if (opts?.subfilters?.coffee) {
        const sub = opts.subfilters.coffee;
        if (sub.has("specialty") && (place.kind === "specialty" || place.kind === "roastery")) s += 8;
        if (sub.has("quiet_seating") && QUIET_REGEX.test(text)) s += 6;
        if (sub.has("photogenic") && (PHOTO_KINDS.has(place.kind ?? "") || /design|aesthetic|ديكور|تصميم/i.test(text))) s += 6;
        if (sub.has("pastry") && /pastry|croissant|baker|بيستري|كروسون|معجنات/i.test(text)) s += 6;
        if (sub.has("trending") && TRENDING_REGEX.test(text)) s += 4;
        if (sub.has("near") && distKm != null && distKm < 2) s += 6;
        if (sub.has("outdoor") && /terrace|تراس|outdoor|garden|حديقة/i.test(text)) s += 6;
      }
      break;

    case "food":
      if (place.category !== "food") return 0;
      if (opts?.subfilters?.food) {
        const sub = opts.subfilters.food;
        if (sub.has("quick") && distKm != null && distKm < 2 && visitMin <= 70) s += 6;
        if (sub.has("local") && LOCAL_REGEX.test(text)) s += 8;
        if (sub.has("family") && place.kind && /family|playground/i.test(place.kind)) s += 6;
        if (sub.has("luxury") && (place.price_level ?? 0) >= 3) s += 6;
        if (sub.has("budget") && (place.price_level ?? 0) > 0 && (place.price_level ?? 0) <= 2) s += 6;
        if (sub.has("dinner")) {
          const h = ctx.now.getHours();
          if (h >= 18 && h <= 23) s += 4;
        }
      }
      break;

    case "photo": {
      // Mix: rooftops, viewpoints, sights, scenic nature, sunset spots.
      // Track which generic boosts we awarded so an exact sub-filter match
      // doesn't double-pay for the same fact (audit fix 2026-06-15 B6).
      const isPhotoKind = PHOTO_KINDS.has(place.kind ?? "");
      const isSightOrNature = place.category === "sight" || place.category === "nature";
      if (isPhotoKind || isSightOrNature) s += 6;
      if (/design|aesthetic|view|إطلال|مطل|ديكور|تصميم|architecture/i.test(text)) s += 4;
      if (opts?.subfilters?.photo) {
        const sub = opts.subfilters.photo;
        if (sub.has("view") && /view|إطلال|مطل|vista/i.test(text)) s += 4;
        if (sub.has("sunset") && SUNSET_REGEX.test(text)) s += 6;
        if (sub.has("rooftop") && (place.kind === "rooftop" || /rooftop|روف ?توب/i.test(text))) {
          s += isPhotoKind ? 4 : 10;
        }
        if (sub.has("monument") && /monument|landmark|نصب|تاريخي/i.test(text)) {
          s += isSightOrNature ? 4 : 8;
        }
        if (sub.has("interior") && /design|interior|ديكور|aesthetic|تصميم/i.test(text)) s += 4;
        if (sub.has("nature") && place.category === "nature") s += 2;
      }
      break;
    }

    case "before_hotel":
      // Reward proximity to hotel + on-route
      if (isPlaceNearHotel(place, ctx.hotelLocation, 2.5)) s += 18;
      else if (isPlaceNearHotel(place, ctx.hotelLocation, 5)) s += 10;
      if (isOnRouteHome(place, ctx.currentLocation, ctx.hotelLocation, 3)) s += 12;
      if (visitMin <= 50) s += 4;
      break;

    case "sunset":
      // Time-aware: only score positively in golden-hour window (1h before
      // sunset; we proxy with hour >= 17 and < 21 lacking real sunset table).
      {
        const h = ctx.now.getHours();
        if (h < 16 || h >= 21) s -= 20;
      }
      if (SUNSET_REGEX.test(text) || PHOTO_KINDS.has(place.kind ?? "")) s += 12;
      break;

    case "nightlife":
      if (place.category === "bar") s += 10;
      if (/rooftop|lounge|bar|club|روف ?توب/i.test(text)) s += 6;
      {
        const h = ctx.now.getHours();
        if (h < 18) s -= 15;
      }
      break;

    case "family":
      if (place.category === "bar") return 0;
      if (place.kind && /family|playground|aquarium|zoo|amusement|kids|garden|park|beach|promenade|ice_cream|candy/i.test(place.kind)) s += 10;
      if (/family|kids|عائل|أطفال|اطفال/i.test(text)) s += 6;
      if (/bar|nightclub|cocktail|lounge|بار|سهرة/i.test(text)) s -= 12;
      break;

    case "luxury":
      if ((place.price_level ?? 0) >= 3) s += 8;
      if (place.is_editor_pick) s += 6;
      if (place.kind === "fine_dining" || place.kind === "michelin" || place.kind === "michelin_3") s += 8;
      // Don't exclude when over budget — risk note handles it
      break;

    case "trending":
      if (TRENDING_REGEX.test(text)) s += 10;
      if ((place.review_count ?? 0) >= 500 && (place.rating ?? 0) >= 4.5) s += 4;
      // New spots tend to be trending too
      if ((place.rating ?? 0) >= 4.6 && (place.review_count ?? 0) >= 50 && (place.review_count ?? 0) <= 1000) s += 4;
      break;

    case "local":
      if (LOCAL_REGEX.test(text)) s += 10;
      if (place.kind && /saudi|najdi|yemeni|nicois|french|british|provencal|provençal/i.test(place.kind)) s += 8;
      break;

    case "quiet":
      if (QUIET_REGEX.test(text)) s += 10;
      if (place.category === "bar") s -= 8;
      if (TRENDING_REGEX.test(text)) s -= 8; // trending = crowded
      break;
  }

  return Math.max(0, Math.min(100, Math.round(s)));
}

// ─── Card composition ────────────────────────────────────────────────────

/** Bulleted breakdown for "لماذا هذا؟" — short positive signals. */
export function nowReasonBullets(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
  intent: Intent,
  travelMin: number | null,
  openStat: OpenAtArrival,
  visitMin: number,
): string[] {
  const out: string[] = [];
  const r = place.rating ?? 0;
  const c = place.review_count ?? 0;

  // Time fit
  const minutesRemaining = (() => {
    const end = new Date(ctx.now);
    end.setHours(23, 0, 0, 0);
    return Math.max(0, Math.round((end.getTime() - ctx.now.getTime()) / 60000));
  })();
  if (minutesRemaining >= (travelMin ?? 0) + visitMin) {
    out.push("مناسب للوقت المتبقي");
  }

  // Open status
  if (openStat === "open") out.push("مفتوح عند الوصول");
  else if (openStat === "closes_soon") out.push("مفتوح لكن وقته ضيّق");
  else if (openStat === "unknown") out.push("ساعات العمل غير مؤكّدة — تحقّق");

  // Proximity
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  if (ref && place.lat != null && place.lng != null) {
    const km = haversineKm(ref, { lat: place.lat, lng: place.lng });
    if (km < 2) out.push("قريب جداً");
    else if (km < 5) out.push("مسافة معقولة");
  }

  // Quality
  if (place.is_editor_pick) out.push("اختيار محرّر");
  if (r >= 4.7 && c >= 200) out.push(`جودة عالية (★${r.toFixed(1)} · ${c >= 1000 ? `${(c/1000).toFixed(1)}k` : c} مراجعة)`);
  else if (r >= 4.5) out.push(`تقييم جيد ★${r.toFixed(1)}`);

  // Budget
  if (ctx.budgetRemainingSar != null && place.cost_estimate != null && place.cost_estimate > 0) {
    const sar = pricePerPersonSar(place, ctx.rates);
    if (sar != null && sar <= ctx.budgetRemainingSar * 0.6) out.push("ضمن الميزانية بمرونة");
  }

  // Intent-specific
  if (intent === "before_hotel" && isPlaceNearHotel(place, ctx.hotelLocation, 3)) {
    out.push("قريب من فندقك");
  }
  if (intent === "light_easy" && visitMin <= 50) {
    out.push("زيارة قصيرة لا تستهلك يومك");
  }
  if (intent === "local") {
    const text = (place.name + " " + (place.tags ?? []).join(" ")).toLowerCase();
    if (LOCAL_REGEX.test(text)) out.push("تجربة محلية");
  }

  return out.slice(0, 5);
}

/** One-sentence "ليش هذا؟" — tone-aware, short. */
export function nowReasonSentence(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
  intent: Intent,
  label: CardLabel,
): string {
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  const distKm = ref && place.lat != null && place.lng != null
    ? haversineKm(ref, { lat: place.lat, lng: place.lng })
    : null;
  const r = place.rating ?? 0;

  // Label dominates the framing
  switch (label) {
    case "near_safe":
      if (!meetsQualityFloor(place, decision)) return "أقرب خيار متاح؛ التقييم متوسط — قرّر إذا الراحة أهم.";
      if (distKm != null && distKm < 1.5) return "قريب ومضمون بدون ما يستهلك وقتك.";
      return "أقرب خيار جيد بدون تنازل عن الجودة.";
    case "light_easy":
      return "خيار خفيف ومريح — مشي قليل وزيارة قصيرة.";
    case "before_hotel":
      if (isPlaceNearHotel(place, ctx.hotelLocation, 2.5)) return "محطة خفيفة قريبة من فندقك قبل الرجوع.";
      if (isOnRouteHome(place, ctx.currentLocation, ctx.hotelLocation, 3)) return "في طريقك للفندق — بدون مشوار إضافي.";
      return "مناسب كآخر محطة قبل الرجوع.";
    case "alt":
      if (place.is_editor_pick) return "خيار مختلف عن المتوقّع، اختيار محرّر بمستوى أعلى.";
      if ((place.price_level ?? 0) >= 3) return "تجربة أقوى وأرقى لو تبي شيء مميّز.";
      return "خيار مختلف يستاهل التجربة.";
    case "best_now":
    case "more":
    default:
      // Intent-specific phrasing for best/more
      switch (intent) {
        case "coffee":
          return "قهوة مناسبة الآن — جودة جيدة بدون مشوار طويل.";
        case "food":
          return "مطعم مفتوح ومناسب لوقتك وميزانيتك.";
        case "photo":
          return "خيار بصري قوي يستاهل التصوير.";
        case "before_hotel":
          return "محطة قبل الفندق — قريبة وبدون عناء.";
        case "sunset":
          return "مناسب للغروب الآن.";
        case "nightlife":
          return "مكان مناسب لختام الليل.";
        case "family":
          return "مناسب للعائلة وبدون مفاجآت.";
        case "luxury":
          return "تجربة راقية تستاهل المناسبة.";
        case "trending":
          return "حالياً ترند — توقّع زحمة لكن التجربة جذابة.";
        case "local":
          return "تجربة محلية أصيلة من المدينة.";
        case "quiet":
          return "هادي ومناسب لو تبي راحة.";
        case "light_easy":
          return "خفيف ومريح بدون استهلاك يومك.";
        case "near_safe":
          return "قريب وبجودة موثوقة.";
        case "decide_for_me":
        default:
          if (r >= 4.7 && (place.review_count ?? 0) >= 200) return "خيار قوي بثقة عالية ومسافة معقولة.";
          if (distKm != null && distKm < 2) return "قريب ومفتوح وأقوى توازن حواليك الآن.";
          return "أفضل توازن بين التقييم والمسافة والوقت.";
      }
  }
}

/** Build a fully-derived NowCardData from a (place, decision) tuple. */
export function buildNowCard(
  place: Place,
  decision: Decision,
  ctx: DecisionContext,
  label: CardLabel,
  intent: Intent,
  score: number,
): NowCardData {
  const ref = ctx.currentLocation ?? ctx.hotelLocation ?? null;
  const distKm = ref && place.lat != null && place.lng != null
    ? haversineKm(ref, { lat: place.lat, lng: place.lng })
    : null;
  const visitMin = estimateVisitMin(place);
  // Travel: walk if <1.5km otherwise drive
  let travelMin: number | null = null;
  let travelMode: "walk" | "drive" | null = null;
  if (distKm != null) {
    if (distKm < 1.5) {
      travelMin = Math.max(1, Math.round(distKm * 1.2 * 12));
      travelMode = "walk";
    } else {
      travelMin = estimateDriveMinFor(distKm);
      travelMode = "drive";
    }
  }
  const openStat = openAtArrival(place, ctx.now, travelMin);

  // Cost — keep optional; only display when we have a number
  const costLabel = (() => {
    if (place.cost_estimate == null || place.cost_estimate <= 0) return null;
    const cur = place.cost_currency;
    if (cur === "SAR") return `${Math.round(place.cost_estimate)} ر.س`;
    return `~${Math.round(place.cost_estimate)} ${cur}`;
  })();

  const ratingLabel = place.rating != null
    ? `★ ${place.rating.toFixed(1)}${place.review_count ? ` · ${
        place.review_count >= 1000
          ? `${(place.review_count / 1000).toFixed(1)}k`
          : place.review_count
      } مراجعة` : ""}`
    : null;

  return {
    place,
    decision,
    label,
    score,
    reason: nowReasonSentence(place, decision, ctx, intent, label),
    reasonBullets: nowReasonBullets(place, decision, ctx, intent, travelMin, openStat, visitMin),
    riskNotes: riskNotes(place, decision, ctx),
    distanceKm: distKm,
    travelMin,
    travelMode,
    visitMin,
    openAtArrival: openStat,
    costLabel,
    ratingLabel,
  };
}
