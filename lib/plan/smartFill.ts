// Smart auto-fill for the plan view. Produces a balanced, geographically-aware,
// non-repeating set of (day, phase, place) picks for empty slots.
//
// Differs from a naive "top alternative per phase":
//   1. **No global repeats** — same place won't be picked twice across the
//      whole fill, even when the local alternatives list would suggest it.
//   2. **Cuisine/kind rotation** — if Day 1 dinner is Japanese, Day 2 dinner
//      penalizes Japanese candidates so the trip feels varied.
//   3. **Geographic clustering** — picks closer to the previously-placed item
//      in the same day score higher (cuts down on city-crossing zigzags).
//   4. **Wishlist priority** — saved places get a real boost.
//   5. **User history** — places the user rated 'skip' are filtered out.

import type { ItineraryDay, ItineraryItem, Place } from "@/lib/supabase/database.types";
import { PHASES, type PhaseDef } from "./phases";
import { decide } from "@/lib/decision/engine";
import { mealTimes } from "@/lib/discover/offerings";
import { haversineKm } from "@/lib/utils";

export type FillPick = {
  day: ItineraryDay;
  phase: PhaseDef;
  place: Place;
  score: number;
  /** Human-readable why-we-picked-it — shown in the preview UI */
  reasons: string[];
};

export type FillInput = {
  days: ItineraryDay[];
  items: ItineraryItem[];
  catalogue: Place[];
  savedSet: Set<string>;
  userRatings: Map<string, { stars: number | null; verdict: "love" | "meh" | "skip" | null }>;
  hotelLocation: { lat: number; lng: number } | null;
  /** When provided, only that day is filled; otherwise the whole trip */
  targetDayId?: string;
};

export function computeSmartFill(input: FillInput): FillPick[] {
  const { days, items, catalogue, savedSet, userRatings, hotelLocation, targetDayId } = input;
  if (days.length === 0 || catalogue.length === 0) return [];

  const now = new Date();

  // Build a quick lookup of which (day, slot) are already filled
  const filledSlots = new Set<string>();
  const placedKinds = new Map<string, string[]>(); // dayId → kinds used
  const placedPlaceIds = new Set<string>();
  for (const it of items) {
    filledSlots.add(`${it.day_id}:${it.slot}`);
    placedPlaceIds.add(it.place_id);
    const p = catalogue.find((c) => c.id === it.place_id);
    if (p?.kind) {
      const arr = placedKinds.get(it.day_id) ?? [];
      arr.push(p.kind);
      placedKinds.set(it.day_id, arr);
    }
  }

  // Filter out places the user explicitly said skip
  const candidatePool = catalogue.filter((p) => {
    const r = userRatings.get(p.id);
    return r?.verdict !== "skip";
  });

  // Track picks across this fill so we never duplicate
  const usedInFill = new Set<string>();
  const kindsByDay = new Map<string, string[]>(placedKinds); // mutable copy
  const picksByDay = new Map<string, FillPick[]>();

  const targetDays = targetDayId ? days.filter((d) => d.id === targetDayId) : days;

  for (const day of targetDays) {
    for (const phase of PHASES) {
      const slot = phase.slots[0];
      if (filledSlots.has(`${day.id}:${slot}`)) continue;

      // Build candidate list for this phase
      const phaseCands = candidatePool.filter((p) => {
        if (usedInFill.has(p.id)) return false;
        if (placedPlaceIds.has(p.id)) return false; // already on the plan elsewhere
        // Category match — primary filter
        if (phase.preferredCategory && !phase.preferredCategory.includes(p.category)) {
          // Food fallback: midday/evening accept any food regardless of pref
          if (!(p.category === "food" && (phase.key === "midday" || phase.key === "evening"))) {
            return false;
          }
        }
        return true;
      });

      if (phaseCands.length === 0) continue;

      // Geographic anchor — previous item placed in this fill or existing
      const dayPicks = picksByDay.get(day.id) ?? [];
      const previousAnchor: { lat: number; lng: number } | null = (() => {
        // Look backward through phases for the last placed point
        const phaseOrder = PHASES.map((p) => p.key);
        const myIdx = phaseOrder.indexOf(phase.key);
        for (let i = myIdx - 1; i >= 0; i--) {
          const earlier = phaseOrder[i];
          const fromFill = dayPicks.find((dp) => dp.phase.key === earlier);
          if (fromFill?.place.lat != null && fromFill?.place.lng != null) {
            return { lat: fromFill.place.lat, lng: fromFill.place.lng };
          }
          const earlierSlot = PHASES.find((p) => p.key === earlier)?.slots[0];
          if (!earlierSlot) continue;
          const existing = items.find((it) => it.day_id === day.id && it.slot === earlierSlot);
          if (existing) {
            const p = catalogue.find((c) => c.id === existing.place_id);
            if (p?.lat != null && p?.lng != null) {
              return { lat: p.lat, lng: p.lng };
            }
          }
        }
        return hotelLocation;
      })();

      const kindsToday = kindsByDay.get(day.id) ?? [];

      // Score each candidate
      const scored = phaseCands.map((p) => {
        const reasons: string[] = [];
        let score = 0;

        // 1. Decision engine confidence as the base
        const dec = decide(p, {
          now,
          currentLocation: null,
          hotelLocation,
          preferenceMode: null,
        });
        score += dec.confidence;

        // 2. Wishlist heavy boost
        if (savedSet.has(p.id)) {
          score += 35;
          reasons.push("في قائمتك المحفوظة");
        }

        // 3. User-loved places get a boost
        const r = userRatings.get(p.id);
        if (r?.verdict === "love") {
          score += 20;
          reasons.push("سبق وأحببتها");
        } else if (r?.stars != null && r.stars >= 4) {
          score += 12;
          reasons.push(`قيمته ${r.stars}★`);
        }

        // 4. Meal-time match — strong signal for food/coffee
        const meals = mealTimes(p).map((m) => m.key);
        if (phase.mealKeys && meals.some((m) => phase.mealKeys!.includes(m))) {
          score += 18;
          reasons.push(`يناسب ${phase.ar}`);
        }

        // 5. High rating + many reviews — proven crowd-pleaser
        if (p.rating != null && p.rating >= 4.6 && (p.review_count ?? 0) >= 500) {
          score += 8;
          reasons.push(`★${p.rating} مع ${p.review_count}+ زائر`);
        }

        // 6. Geographic clustering — penalize long hops
        if (previousAnchor && p.lat != null && p.lng != null) {
          const km = haversineKm(previousAnchor, { lat: p.lat, lng: p.lng });
          if (km < 1) {
            score += 10;
            reasons.push("على بعد دقائق من السابق");
          } else if (km < 3) score += 4;
          else if (km > 10) score -= 8;
        }

        // 7. Kind diversity within the day — avoid 3 italians in a row
        if (p.kind && kindsToday.filter((k) => k === p.kind).length > 0) {
          score -= 12;
        }

        // 8. Editor pick gets a small nudge — curators' choice
        if (p.is_editor_pick) {
          score += 5;
          reasons.push("اختيار محرر");
        }

        return { p, score, reasons };
      });

      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      if (!best || best.score <= 0) continue;

      const pick: FillPick = {
        day,
        phase,
        place: best.p,
        score: best.score,
        reasons: best.reasons.slice(0, 2), // keep card tidy
      };
      usedInFill.add(best.p.id);
      if (best.p.kind) {
        const arr = kindsByDay.get(day.id) ?? [];
        arr.push(best.p.kind);
        kindsByDay.set(day.id, arr);
      }
      const dayArr = picksByDay.get(day.id) ?? [];
      dayArr.push(pick);
      picksByDay.set(day.id, dayArr);
    }
  }

  // Flatten in day → phase order so the preview reads naturally
  const out: FillPick[] = [];
  for (const day of targetDays) {
    const dayPicks = picksByDay.get(day.id) ?? [];
    out.push(...dayPicks);
  }
  return out;
}

/** Returns up to N additional alternatives for a single (day, phase) in case
 *  the user wants to swap the proposed pick. */
export function alternativePicksFor(
  input: FillInput,
  pickedSet: Set<string>, // place IDs already in the fill, to skip
  day: ItineraryDay,
  phase: PhaseDef,
  limit = 5,
): Place[] {
  const { items, catalogue, savedSet, userRatings, hotelLocation } = input;
  const now = new Date();

  const candidates = catalogue.filter((p) => {
    if (pickedSet.has(p.id)) return false;
    if (items.some((it) => it.place_id === p.id)) return false;
    const r = userRatings.get(p.id);
    if (r?.verdict === "skip") return false;
    if (phase.preferredCategory && !phase.preferredCategory.includes(p.category)) {
      if (!(p.category === "food" && (phase.key === "midday" || phase.key === "evening"))) {
        return false;
      }
    }
    return true;
  });

  const scored = candidates.map((p) => {
    let s = decide(p, { now, currentLocation: null, hotelLocation, preferenceMode: null }).confidence;
    if (savedSet.has(p.id)) s += 35;
    return { p, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.p);
}
