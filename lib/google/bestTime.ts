// Derive a "best time to visit" hint from category + opening_hours.
// Pure function — no Google API. Used in PlaceCard chip + PlaceDetailSheet
// hours section to help users slot the place into a phase of their day.

import type { Place } from "@/lib/supabase/database.types";

export type BestTime = {
  emoji: string;
  ar: string;          // short label e.g. "صباحاً" or "العشاء"
  hint?: string;       // optional reason e.g. "أهدأ قبل ١١ ص"
};

const CATEGORY_DEFAULTS: Record<string, BestTime> = {
  food:    { emoji: "🌙", ar: "العشاء",   hint: "أكثر حيوية مساءً" },
  coffee:  { emoji: "🌅", ar: "الصباح",   hint: "هدوء وضوء طبيعي" },
  sight:   { emoji: "🌅", ar: "الصباح",   hint: "قبل الزحمة والحر" },
  nature:  { emoji: "🌆", ar: "العصر",    hint: "إضاءة دافئة وأقل حرارة" },
  sweet:   { emoji: "🌆", ar: "بعد الظهر" },
  bar:     { emoji: "🌃", ar: "بعد العشاء" },
  event:   { emoji: "🌙", ar: "المساء" },
};

const KIND_OVERRIDES: Record<string, BestTime> = {
  // breakfast/brunch wins regardless of category
  brunch:    { emoji: "🥐", ar: "البرانش",  hint: "٩-١٢ ص" },
  bakery:    { emoji: "🌅", ar: "الصباح",   hint: "الخبز طازج" },
  // sights worth seeing at sunset
  view:           { emoji: "🌇", ar: "الغروب",   hint: "ساعة ذهبية" },
  observation_deck:{ emoji: "🌇", ar: "الغروب",  hint: "ساعة ذهبية" },
  beach:          { emoji: "🌆", ar: "العصر",   hint: "أهدأ + شمس مائلة" },
  // night-only
  cocktail:  { emoji: "🌃", ar: "بعد العشاء" },
  club:      { emoji: "🌃", ar: "الليل" },
  wine_bar:  { emoji: "🌙", ar: "المساء" },
  // morning-only
  museum:    { emoji: "🌅", ar: "الصباح",   hint: "أهدأ قبل ١١ ص" },
  gallery:   { emoji: "🌅", ar: "الصباح" },
  market:    { emoji: "🌅", ar: "الصباح",   hint: "أطزج بضاعة" },
};

/** Parses a "HH:MM AM/PM-HH:MM AM/PM" opening string into [openMin, closeMin]
 *  in minutes-since-midnight. Returns null on unrecognised forms. */
function parseRange(s: string): [number, number] | null {
  // Accept "9:00 AM-11:00 PM", "11:30 AM - 2:00 PM", or 24h "09:00-23:00"
  const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  const toMin = (h: number, mn: number, ap?: string) => {
    let H = h;
    if (ap) {
      const isPm = ap.toUpperCase() === "PM";
      if (isPm && H !== 12) H += 12;
      if (!isPm && H === 12) H = 0;
    }
    return H * 60 + mn;
  };
  return [
    toMin(parseInt(m[1], 10), parseInt(m[2], 10), m[3]),
    toMin(parseInt(m[4], 10), parseInt(m[5], 10), m[6]),
  ];
}

/** Try to pick a best-time band from the actual opening hours. e.g. if the
 *  place opens only 7-11 AM, "breakfast" wins regardless of category. */
function fromOpeningHours(p: Place): BestTime | null {
  const hrs = p.opening_hours;
  if (!hrs || hrs.length === 0) return null;
  // Pick the median day's interval to avoid weirdness on a single off day.
  const ranges = hrs.map(parseRange).filter((r): r is [number, number] => r != null);
  if (ranges.length < 3) return null;
  // Sort by open time
  ranges.sort((a, b) => a[0] - b[0]);
  const mid = ranges[Math.floor(ranges.length / 2)];
  const [open, close] = mid;
  // Breakfast-only: closes before 12pm
  if (close <= 12 * 60) {
    return { emoji: "🌅", ar: "الصباح", hint: "يقفل قبل الظهر" };
  }
  // Night-only: opens after 6pm
  if (open >= 18 * 60) {
    return { emoji: "🌃", ar: "المساء" };
  }
  return null;
}

/** Public — returns null if no useful signal. */
export function bestTimeFor(p: Place): BestTime | null {
  if (p.kind && KIND_OVERRIDES[p.kind]) return KIND_OVERRIDES[p.kind];
  const fromHours = fromOpeningHours(p);
  if (fromHours) return fromHours;
  return CATEGORY_DEFAULTS[p.category] ?? null;
}
