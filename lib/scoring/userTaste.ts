// Infer user "taste" from their itinerary picks + saved places + ratings.
// Used to personalize smart score across all places.
//
// Heuristic — the more you pick/save/rate well, the stronger the preference.
// Stored implicitly via behavior — no need for an explicit preferences table.

import type { Category } from "@/lib/supabase/database.types";

export type UserTaste = {
  topCategories: Category[];     // up to 3, ordered by strength
  topKinds: string[];             // up to 4
  topHighlights: string[];        // up to 5
  preferredPriceLevel: number | null; // 1..4, median of picked places
  affinityCount: number;          // total observed picks (gives confidence)
};

export const EMPTY_TASTE: UserTaste = {
  topCategories: [],
  topKinds: [],
  topHighlights: [],
  preferredPriceLevel: null,
  affinityCount: 0,
};

/** Build user taste from raw history rows (typed loosely so it's flexible). */
export function buildUserTaste(history: {
  itinerary: Array<{ category: string; kind: string | null; highlights: string[] | null; price_level: number | null }>;
  saved: Array<{ category: string; kind: string | null; highlights: string[] | null }>;
  ratings: Array<{ stars: number; category: string; kind: string | null; highlights: string[] | null }>;
}): UserTaste {
  const catScore: Record<string, number> = {};
  const kindScore: Record<string, number> = {};
  const hlScore: Record<string, number> = {};
  const priceLevels: number[] = [];

  // Itinerary picks count strongest (intent to actually visit)
  for (const it of history.itinerary) {
    catScore[it.category] = (catScore[it.category] ?? 0) + 3;
    if (it.kind) kindScore[it.kind] = (kindScore[it.kind] ?? 0) + 3;
    for (const h of it.highlights ?? []) hlScore[h] = (hlScore[h] ?? 0) + 2;
    if (it.price_level != null) priceLevels.push(it.price_level);
  }
  // Saved = wishlist (medium signal)
  for (const s of history.saved) {
    catScore[s.category] = (catScore[s.category] ?? 0) + 1;
    if (s.kind) kindScore[s.kind] = (kindScore[s.kind] ?? 0) + 1;
    for (const h of s.highlights ?? []) hlScore[h] = (hlScore[h] ?? 0) + 1;
  }
  // Ratings — strong signal in both directions
  for (const r of history.ratings) {
    if (r.stars >= 4) {
      catScore[r.category] = (catScore[r.category] ?? 0) + 4;
      if (r.kind) kindScore[r.kind] = (kindScore[r.kind] ?? 0) + 4;
      for (const h of r.highlights ?? []) hlScore[h] = (hlScore[h] ?? 0) + 3;
    } else if (r.stars <= 2) {
      catScore[r.category] = (catScore[r.category] ?? 0) - 3;
      if (r.kind) kindScore[r.kind] = (kindScore[r.kind] ?? 0) - 3;
    }
  }

  const sortDesc = (m: Record<string, number>) =>
    Object.entries(m)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([k]) => k);

  const topCategories = sortDesc(catScore).slice(0, 3) as Category[];
  const topKinds = sortDesc(kindScore).slice(0, 4);
  const topHighlights = sortDesc(hlScore).slice(0, 5);

  let preferredPriceLevel: number | null = null;
  if (priceLevels.length > 0) {
    const sorted = priceLevels.slice().sort((a, b) => a - b);
    preferredPriceLevel = sorted[Math.floor(sorted.length / 2)];
  }

  return {
    topCategories,
    topKinds,
    topHighlights,
    preferredPriceLevel,
    affinityCount: history.itinerary.length + history.saved.length + history.ratings.length,
  };
}
