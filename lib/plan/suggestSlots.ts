// Given a place, propose the 3 best (day, phase) slots to add it to.
// Scoring rewards: empty slots, meal-time match, category match,
// proximity (next-empty day comes first).

import type { ItineraryDay, ItineraryItem, Place, Slot } from "@/lib/supabase/database.types";
import { PHASES, type PhaseDef } from "./phases";
import { mealTimes } from "@/lib/discover/offerings";
import { fmtDayLong } from "@/lib/utils";

export type SlotSuggestion = {
  day: ItineraryDay;
  phase: PhaseDef;
  /** Higher = better. Used only for ranking, not shown. */
  score: number;
  /** Compact label for the chip — e.g., "يوم ٢ 🌙 العشاء (فارغ)" */
  label: string;
  /** Subtext under the chip — e.g., "الإثنين · ٧–١٠م" or "موجود مكان آخر" */
  hint: string;
  isEmpty: boolean;
  /** True when THIS specific place is already scheduled in this slot.
   *  Add is still allowed (duplicates intentional), but the UI warns first. */
  hasThisPlace: boolean;
};

export function suggestSlotsFor(
  place: Place,
  days: ItineraryDay[],
  items: ItineraryItem[],
  opts: { limit?: number } = {},
): SlotSuggestion[] {
  const limit = opts.limit ?? 3;
  if (days.length === 0) return [];

  const meals = mealTimes(place).map((m) => m.key);

  // Build a count of items per (day_id, slot) so we know what's empty,
  // and a separate set of (day_id, slot) keys where THIS place is already
  // scheduled — used to warn before adding a duplicate.
  const counts = new Map<string, number>();
  const thisPlaceIn = new Set<string>();
  for (const it of items) {
    const k = `${it.day_id}:${it.slot}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (it.place_id === place.id) thisPlaceIn.add(k);
  }

  const ranked: SlotSuggestion[] = [];
  for (const day of days) {
    for (const phase of PHASES) {
      const slot: Slot = phase.slots[0];
      const k = `${day.id}:${slot}`;
      const n = counts.get(k) ?? 0;
      const isEmpty = n === 0;
      const hasThisPlace = thisPlaceIn.has(k);

      let score = 0;

      // 1. Empty phase is the biggest signal
      if (isEmpty) score += 40;
      else if (n === 1) score -= 5;
      else score -= 20; // already 2+ items here

      // 2. Strong negative if this exact place is already here — we still
      //    show the option (duplicates allowed) but rank it well below
      //    empty options elsewhere.
      if (hasThisPlace) score -= 50;

      // 3. Meal time match — exact dinner→dinner is the strongest pairing
      if (meals.length > 0 && phase.mealKeys?.some((k) => meals.includes(k))) {
        score += 30;
      }

      // 4. Category match (food → midday/evening, coffee → morning, etc.)
      if (phase.preferredCategory?.includes(place.category)) {
        score += 15;
      } else if (place.category === "food" && (phase.key === "midday" || phase.key === "evening")) {
        score += 10; // food always works at meals even without explicit pref
      }

      // 5. Earlier days slightly preferred — easier mental model: "let me lock
      //    in the start of the trip first"
      const dayIdx = days.indexOf(day);
      score -= dayIdx * 0.5;

      if (score <= 0) continue;

      const wkDay = fmtDayLong(day.day_date);
      const hint = hasThisPlace
        ? `${wkDay} · ${phase.timeAr} · ⚠️ مضاف هنا — تبيه مرة ثانية؟`
        : isEmpty
        ? `${wkDay} · ${phase.timeAr} · فارغ`
        : `${wkDay} · ${phase.timeAr} · ${n} موجود`;

      ranked.push({
        day, phase, score, isEmpty, hasThisPlace,
        label: `يوم ${dayIdx + 1} · ${phase.emoji} ${phase.ar}`,
        hint,
      });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit);
}
