// Given a list of (place, decision) tuples, pick the cards for the
// "وين أروح الآن؟" screen.
//
// Layered ranking (Phase 2A):
//   1. الأفضل الآن        — highest composite nowScore (was: confidence only)
//   2. قريب ومريح         — closest WITH quality floor (was: just closest)
//   3. أفخم / تجربة أقوى  — highest price_level + nowScore tiebreak
//   4. قبل الرجوع للفندق  — best near-hotel / on-route candidate (conditional)
//
// Pure function. No I/O.

import type { Place } from "@/lib/supabase/database.types";
import {
  type Decision, type DecisionContext,
  type Intent, type IntentScoreOptions, type NowCardData, type CardLabel,
  type TimeBudget,
  meetsQualityFloor, nowScore, isPlaceNearHotel, isOnRouteHome,
  nowScoreForIntent, buildNowCard, estimateVisitMin,
} from "@/lib/decision/engine";
import { haversineKm } from "@/lib/utils";

export type ScoredPlace = { place: Place; decision: Decision };

export type ThreeCards = {
  best: ScoredPlace | null;
  near: ScoredPlace | null;
  luxury: ScoredPlace | null;
};

export type FourCards = ThreeCards & {
  hotelReturn: ScoredPlace | null;
};

const RECOMMENDABLE: Decision["verdict"][] = ["recommended", "good_if_nearby"];

// LEGACY — kept for compatibility with anything still calling pickThreeCards
// directly. New code should use pickCards() which is preference-aware.
export function pickThreeCards(
  items: ScoredPlace[],
  refLocation: { lat: number; lng: number } | null,
): ThreeCards {
  const eligible = items.filter((it) => RECOMMENDABLE.includes(it.decision.verdict));

  const recommended = eligible.filter((it) => it.decision.verdict === "recommended");
  const best = recommended.sort((a, b) => {
    const c = b.decision.confidence - a.decision.confidence;
    if (c !== 0) return c;
    return (b.place.rating ?? 0) - (a.place.rating ?? 0);
  })[0] ?? null;

  const distance = (p: Place): number => {
    if (!refLocation || p.lat == null || p.lng == null) return Infinity;
    return haversineKm(refLocation, { lat: p.lat, lng: p.lng });
  };
  const nearCandidates = eligible.filter((it) => it !== best);
  const near = nearCandidates
    .map((it) => ({ it, dKm: distance(it.place) }))
    .sort((a, b) => a.dKm - b.dKm)[0]?.it ?? null;

  const luxuryCandidates = recommended.filter((it) => it !== best && it !== near);
  const luxury = luxuryCandidates.sort((a, b) => {
    const pl = (b.place.price_level ?? 0) - (a.place.price_level ?? 0);
    if (pl !== 0) return pl;
    return b.decision.confidence - a.decision.confidence;
  })[0] ?? null;

  return { best, near, luxury };
}

// ─── Phase 2A: nowScore-driven picking ──────────────────────────────────

export type PickContext = DecisionContext & {
  refLocation: { lat: number; lng: number } | null;
  /** How many extra cards to offer after the 3 primary picks. */
  extraCount?: number;
  /** Skip tokens per tone — lets the UI cycle "بدّل" past the first match. */
  skip?: { best?: number; near?: number; luxury?: number; hotelReturn?: number };
};

export type CardPicks = FourCards & {
  /** Additional decent options the user can reveal via "اعرض خيارات أكثر". */
  more: ScoredPlace[];
};

/** Score-driven picker for the Now Screen.
 *
 *  Layers on nowScore so distance, remaining day time, budget pressure, and
 *  the active preference mode all influence which place lands in each lane.
 *  Each lane uses its OWN scoring tilt — e.g. "near" lane runs nowScore with
 *  preferenceMode forced to "near" so the quality-floor + proximity bias
 *  apply even when the user is in a different mode. */
export function pickCards(items: ScoredPlace[], ctx: PickContext): CardPicks {
  const eligible = items.filter((it) => RECOMMENDABLE.includes(it.decision.verdict));
  if (eligible.length === 0) {
    return { best: null, near: null, luxury: null, hotelReturn: null, more: [] };
  }

  // Helper: score every eligible item under a given mode + variety state.
  const scoreUnder = (mode: PickContext["preferenceMode"], seenCats: Place["category"][]) =>
    (it: ScoredPlace) => nowScore(it.place, it.decision, { ...ctx, preferenceMode: mode }, {
      alreadyPickedCategories: seenCats,
    });

  // ── 1. BEST: highest nowScore under user's active mode
  const skipBest = ctx.skip?.best ?? 0;
  const bestSorted = [...eligible].sort(
    (a, b) => scoreUnder(ctx.preferenceMode, [])(b) - scoreUnder(ctx.preferenceMode, [])(a),
  );
  const best = bestSorted[skipBest] ?? bestSorted[0] ?? null;

  // ── 2. NEAR: closest AMONG quality-floor candidates (no random 3.6★ wins)
  const nearSeen = best ? [best.place.category] : [];
  const nearPool = eligible
    .filter((it) => it !== best && meetsQualityFloor(it.place, it.decision));
  // Fallback: if nothing passes the floor (sparse catalogue) relax it but
  // still avoid the absolute lowest-confidence picks.
  const nearSource = nearPool.length > 0
    ? nearPool
    : eligible.filter((it) => it !== best && it.decision.confidence >= 60);
  const skipNear = ctx.skip?.near ?? 0;
  const nearSorted = [...nearSource].sort(
    (a, b) => scoreUnder("near", nearSeen)(b) - scoreUnder("near", nearSeen)(a),
  );
  const near = nearSorted[skipNear] ?? nearSorted[0] ?? null;

  // ── 3. LUXURY: highest price_level + nowScore tilt; respect variety
  const luxurySeen = [
    ...(best ? [best.place.category] : []),
    ...(near ? [near.place.category] : []),
  ];
  const luxuryPool = eligible
    .filter((it) => it !== best && it !== near && (it.place.price_level ?? 0) >= 2);
  const skipLux = ctx.skip?.luxury ?? 0;
  const luxurySorted = [...luxuryPool].sort((a, b) => {
    const pl = (b.place.price_level ?? 0) - (a.place.price_level ?? 0);
    if (pl !== 0) return pl;
    return scoreUnder("luxury", luxurySeen)(b) - scoreUnder("luxury", luxurySeen)(a);
  });
  const luxury = luxurySorted[skipLux] ?? luxurySorted[0] ?? null;

  // ── 4. HOTEL RETURN: best on-route / near-hotel pick.
  // Shown automatically late afternoon onward, OR whenever the user has
  // explicitly toggled the "رجّعني للفندق" preference (in which case the
  // hour gate is meaningless).
  let hotelReturn: ScoredPlace | null = null;
  const hour = ctx.now.getHours();
  const isLateEnough = hour >= 16;
  const userAsked = ctx.preferenceMode === "hotel_return";
  const hasHotel = ctx.hotelLocation != null;
  if (hasHotel && (isLateEnough || userAsked)) {
    const used = new Set<ScoredPlace>([best, near, luxury].filter((x): x is ScoredPlace => x != null));
    const hrSeen = [
      ...(best ? [best.place.category] : []),
      ...(near ? [near.place.category] : []),
      ...(luxury ? [luxury.place.category] : []),
    ];
    const hrPool = eligible.filter((it) => {
      if (used.has(it)) return false;
      return (
        isPlaceNearHotel(it.place, ctx.hotelLocation, 5) ||
        isOnRouteHome(it.place, ctx.currentLocation, ctx.hotelLocation, 3)
      );
    });
    const skipHR = ctx.skip?.hotelReturn ?? 0;
    const hrSorted = [...hrPool].sort(
      (a, b) => scoreUnder("hotel_return", hrSeen)(b) - scoreUnder("hotel_return", hrSeen)(a),
    );
    hotelReturn = hrSorted[skipHR] ?? hrSorted[0] ?? null;
  }

  // ── "اعرض خيارات أكثر": remaining decent picks
  const placed = new Set<ScoredPlace>(
    [best, near, luxury, hotelReturn].filter((x): x is ScoredPlace => x != null),
  );
  const moreSeen = [
    ...(best ? [best.place.category] : []),
    ...(near ? [near.place.category] : []),
    ...(luxury ? [luxury.place.category] : []),
    ...(hotelReturn ? [hotelReturn.place.category] : []),
  ];
  const morePool = eligible.filter((it) => !placed.has(it));
  const more = [...morePool]
    .sort(
      (a, b) => scoreUnder(ctx.preferenceMode, moreSeen)(b) - scoreUnder(ctx.preferenceMode, moreSeen)(a),
    )
    .slice(0, Math.max(0, ctx.extraCount ?? 4));

  return { best, near, luxury, hotelReturn, more };
}

// ─── Phase 2B: Intent-driven picking ────────────────────────────────────

export type IntentPickContext = DecisionContext & {
  intent: Intent;
  timeBudget: TimeBudget;
  subfilters?: IntentScoreOptions["subfilters"];
  useBudget?: boolean;
  extraCount?: number;
  /** Per-lane swap tokens — cycles past the top match. */
  skip?: Partial<Record<CardLabel, number>>;
};

export type IntentPicks = {
  /** 3 (or 4 with before_hotel) primary cards to render first. */
  primary: NowCardData[];
  /** Additional decent options for "اعرض خيارات أكثر". */
  more: NowCardData[];
};

const RECOMMENDABLE_VERDICTS = new Set<Decision["verdict"]>([
  "recommended", "good_if_nearby", "closed_soon", "low_confidence",
]);

/** Sort helper. */
function sortByScore<T extends { score: number }>(arr: T[]): T[] {
  return arr.slice().sort((a, b) => b.score - a.score);
}

/** Builds the 3 (or 4) lanes for a given intent.
 *
 *  Each lane re-scores under its own intent so the user gets MEANINGFULLY
 *  different cards in each slot instead of three flavors of the same place. */
export function pickCardsByIntent(items: ScoredPlace[], ctx: IntentPickContext): IntentPicks {
  const eligible = items.filter((it) => RECOMMENDABLE_VERDICTS.has(it.decision.verdict));
  if (eligible.length === 0) return { primary: [], more: [] };

  const baseScoreOpts: IntentScoreOptions = {
    timeBudget: ctx.timeBudget,
    useBudget: ctx.useBudget,
    subfilters: ctx.subfilters,
  };

  // Helper — score a place under a given intent + variety state
  const scoreFor = (intent: Intent, seenCats: Place["category"][]) =>
    (it: ScoredPlace) => nowScoreForIntent(it.place, it.decision, ctx, intent, {
      ...baseScoreOpts,
      alreadyPickedCategories: seenCats,
    });

  // Optional category filter for "single-category" intents (coffee/food).
  const restrictByIntent = (pool: ScoredPlace[]): ScoredPlace[] => {
    switch (ctx.intent) {
      case "coffee": return pool.filter((p) => p.place.category === "coffee" || p.place.category === "sweet");
      case "food":   return pool.filter((p) => p.place.category === "food");
      case "before_hotel":
        if (!ctx.hotelLocation) return [];
        return pool.filter((p) =>
          isPlaceNearHotel(p.place, ctx.hotelLocation, 5)
          || isOnRouteHome(p.place, ctx.currentLocation, ctx.hotelLocation, 3),
        );
      default: return pool;
    }
  };
  const restricted = restrictByIntent(eligible);
  // Fallback: if restricted is empty, fall back to full eligible — empty
  // state UI will explain why we relaxed.
  const pool = restricted.length > 0 ? restricted : eligible;

  // ── Pick the "best now" under the active intent ─────────
  const skipBest = ctx.skip?.best_now ?? 0;
  const bestSorted = pool.slice().sort((a, b) => scoreFor(ctx.intent, [])(b) - scoreFor(ctx.intent, [])(a));
  const bestPlace = bestSorted[skipBest] ?? bestSorted[0] ?? null;

  // ── "Near & safe" lane — closest passing the quality floor, score under "near_safe"
  const nearSeen: Place["category"][] = bestPlace ? [bestPlace.place.category] : [];
  const nearPool = pool
    .filter((it) => it !== bestPlace && meetsQualityFloor(it.place, it.decision));
  const nearSource = nearPool.length > 0
    ? nearPool
    : pool.filter((it) => it !== bestPlace && it.decision.confidence >= 60);
  const skipNear = ctx.skip?.near_safe ?? 0;
  const nearSorted = nearSource.slice().sort(
    (a, b) => scoreFor("near_safe", nearSeen)(b) - scoreFor("near_safe", nearSeen)(a),
  );
  const nearPlace = nearSorted[skipNear] ?? nearSorted[0] ?? null;

  // ── Third lane depends on intent:
  //  - When the active intent already implies a flavor (light/coffee/photo/etc),
  //    the 3rd card is "alt" = highest score that differs in CATEGORY.
  //  - For decide_for_me + near_safe + before_hotel, prefer "light_easy" framing
  //    if tight time, otherwise "alt".
  const thirdSeen: Place["category"][] = [
    ...(bestPlace ? [bestPlace.place.category] : []),
    ...(nearPlace ? [nearPlace.place.category] : []),
  ];
  let thirdLabel: CardLabel = "alt";
  let thirdSorted: ScoredPlace[] = [];
  if (ctx.timeBudget === "tight" && (ctx.intent === "decide_for_me" || ctx.intent === "near_safe")) {
    thirdLabel = "light_easy";
    thirdSorted = pool
      .filter((it) => it !== bestPlace && it !== nearPlace)
      .slice()
      .sort((a, b) => scoreFor("light_easy", thirdSeen)(b) - scoreFor("light_easy", thirdSeen)(a));
  } else {
    // alt: max nowScore under current intent, excluding repeated categories
    thirdSorted = pool
      .filter((it) => it !== bestPlace && it !== nearPlace)
      .slice()
      .sort((a, b) => scoreFor(ctx.intent, thirdSeen)(b) - scoreFor(ctx.intent, thirdSeen)(a));
  }
  const skipThird = ctx.skip?.[thirdLabel] ?? 0;
  const thirdPlace = thirdSorted[skipThird] ?? thirdSorted[0] ?? null;

  // ── Optional 4th card: "before hotel" — only when time-of-day says so, or
  //    when user explicitly chose the before_hotel intent. Cap at 22:00 so
  //    we don't suggest a wind-down stop at 2am, and skip the lane when the
  //    primary "best_now" already sits next to the hotel (audit fix 2026-06-15).
  let beforeHotelPlace: ScoredPlace | null = null;
  const bestAlreadyNearHotel = bestPlace
    && isPlaceNearHotel(bestPlace.place, ctx.hotelLocation, 2.5);
  if (
    ctx.intent !== "before_hotel" &&
    ctx.hotelLocation &&
    !bestAlreadyNearHotel &&
    (ctx.now.getHours() >= 16 && ctx.now.getHours() < 22)
  ) {
    const used = new Set<ScoredPlace>(
      [bestPlace, nearPlace, thirdPlace].filter((x): x is ScoredPlace => x != null),
    );
    const hrSeen: Place["category"][] = [
      ...(bestPlace ? [bestPlace.place.category] : []),
      ...(nearPlace ? [nearPlace.place.category] : []),
      ...(thirdPlace ? [thirdPlace.place.category] : []),
    ];
    const hrPool = eligible.filter((it) => {
      if (used.has(it)) return false;
      return (
        isPlaceNearHotel(it.place, ctx.hotelLocation, 5)
        || isOnRouteHome(it.place, ctx.currentLocation, ctx.hotelLocation, 3)
      );
    });
    const skipHR = ctx.skip?.before_hotel ?? 0;
    const hrSorted = hrPool.slice().sort(
      (a, b) => scoreFor("before_hotel", hrSeen)(b) - scoreFor("before_hotel", hrSeen)(a),
    );
    beforeHotelPlace = hrSorted[skipHR] ?? hrSorted[0] ?? null;
  }

  // ── Build NowCardData[] from picks ───────────────────────────────────
  const buildAt = (it: ScoredPlace | null, label: CardLabel, intent: Intent): NowCardData | null => {
    if (!it) return null;
    const sc = nowScoreForIntent(it.place, it.decision, ctx, intent, baseScoreOpts);
    return buildNowCard(it.place, it.decision, ctx, label, intent, sc);
  };

  const primaryRaw: Array<NowCardData | null> = [
    buildAt(bestPlace, "best_now", ctx.intent),
    buildAt(nearPlace, "near_safe", "near_safe"),
    buildAt(thirdPlace, thirdLabel, thirdLabel === "light_easy" ? "light_easy" : ctx.intent),
    buildAt(beforeHotelPlace, "before_hotel", "before_hotel"),
  ];
  const primary = primaryRaw.filter((x): x is NowCardData => x != null);

  // Dedupe (defensive — should not happen because we excluded above)
  const seenIds = new Set(primary.map((p) => p.place.id));

  // ── Time-budget cap: if tight, show at most 1 strong card unless user
  //    is explicitly browsing more.
  let primaryCapped = primary;
  if (ctx.timeBudget === "tight" && ctx.intent === "decide_for_me") {
    primaryCapped = primary.slice(0, 1);
  }

  // ── "اعرض خيارات أكثر"
  const morePool = eligible.filter((it) => !seenIds.has(it.place.id));
  const moreSeen = primary.map((p) => p.place.category);
  const moreSorted = morePool
    .slice()
    .sort((a, b) => scoreFor(ctx.intent, moreSeen)(b) - scoreFor(ctx.intent, moreSeen)(a))
    .slice(0, Math.max(0, ctx.extraCount ?? 4));
  const more = moreSorted.map((it) => {
    const sc = nowScoreForIntent(it.place, it.decision, ctx, ctx.intent, baseScoreOpts);
    return buildNowCard(it.place, it.decision, ctx, "more", ctx.intent, sc);
  });

  return { primary: primaryCapped, more };
}
