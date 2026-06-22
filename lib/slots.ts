// Slot ↔ category mapping. Same logic as the original HTML prototype.
// Each slot accepts multiple categories, ordered by primary→fallback.
import type { Slot, Category } from "@/lib/supabase/database.types";

export const SLOT_MAX = 3;

export const SLOT_ORDER: Slot[] = ["morning", "midday", "afternoon", "evening", "night"];

export const SLOT_CATS: Record<Slot, Category[]> = {
  morning: ["coffee", "sweet", "sight", "nature", "event"],
  midday: ["food", "sight", "event", "nature"],
  afternoon: ["sight", "nature", "event", "sweet", "food"],
  evening: ["food", "bar", "sight", "event"],
  night: ["bar", "food", "event", "sight"],
};

export const SLOT_LABEL: Record<Slot, string> = {
  morning: "☕ صباح · ٧–١١",
  midday: "🍽️ غداء · ١٢–١٥",
  afternoon: "🏛 بعد الظهر · ١٥–١٨",
  evening: "🍷 عشاء · ١٩–٢٢",
  night: "🥂 سهرة · ٢٢+",
};

export const SLOT_SHORT: Record<Slot, string> = {
  morning: "صباح",
  midday: "غداء",
  afternoon: "بعد الظهر",
  evening: "عشاء",
  night: "سهرة",
};

export const SLOT_HINT: Record<Slot, string> = {
  morning: "قهوة · حلا · متاحف · فعاليات صباحية",
  midday: "الغداء · معالم · أنشطة",
  afternoon: "معالم · طبيعة · فعاليات · ألعاب",
  evening: "العشاء · بار · معالم مضاءة",
  night: "بار · فعاليات ليلية · معالم",
};

// Is this place open on day-of-week dayIdx (0=Sun..6=Sat)?
export function isOpenOnDayIdx(opening_hours: string[] | null, dayIdx: number): boolean {
  if (!opening_hours || opening_hours.length === 0) return true; // unspecified = always open
  const slot = opening_hours[dayIdx];
  if (!slot) return false; // empty string = closed
  return slot.trim().length > 0;
}

export type Slot_ = Slot;
