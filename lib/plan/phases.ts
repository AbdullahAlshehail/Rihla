// Shared phase definitions — concrete time labels so the user sees the
// actual hours, not abstract "morning/evening". Keep this as the single
// source of truth across PlanScreen, QuickAddPicker, and Smart Plan.

import type { Place, Slot } from "@/lib/supabase/database.types";

export type PhaseDef = {
  key: string;
  ar: string;
  emoji: string;
  /** Concrete time range — shown in the UI under the phase title */
  timeAr: string;
  /** Approximate start/end hour (0-23). Used by suggestions. */
  startHour: number;
  endHour: number;
  slots: Slot[];
  preferredCategory?: Place["category"][];
  /** Which meal-time keys (from offerings.ts) naturally fit this phase. */
  mealKeys?: string[];
};

export const PHASES: PhaseDef[] = [
  {
    key: "morning",
    ar: "الصباح",
    emoji: "🌅",
    timeAr: "٧ – ١٠ ص",
    startHour: 7, endHour: 10,
    slots: ["morning"],
    preferredCategory: ["coffee", "sight"],
    mealKeys: ["breakfast", "brunch"],
  },
  {
    key: "midday",
    ar: "الغداء",
    emoji: "🍽",
    timeAr: "١٢ – ٣ ظ",
    startHour: 12, endHour: 15,
    slots: ["midday"],
    preferredCategory: ["food"],
    mealKeys: ["lunch", "brunch"],
  },
  {
    key: "afternoon",
    ar: "بعد الظهر",
    emoji: "🌆",
    timeAr: "٣ – ٦ ع",
    startHour: 15, endHour: 18,
    slots: ["afternoon"],
    preferredCategory: ["sight", "nature", "sweet"],
    mealKeys: ["snack"],
  },
  {
    key: "evening",
    ar: "العشاء",
    emoji: "🌙",
    timeAr: "٧ – ١٠ م",
    startHour: 19, endHour: 22,
    slots: ["evening"],
    preferredCategory: ["food"],
    mealKeys: ["dinner"],
  },
  {
    key: "night",
    ar: "آخر اليوم",
    emoji: "🌃",
    timeAr: "١٠م – بعد",
    startHour: 22, endHour: 24,
    slots: ["night"],
    preferredCategory: ["bar", "event", "sweet"],
    mealKeys: [],
  },
];

export function phaseForSlot(slot: Slot): PhaseDef | undefined {
  return PHASES.find((p) => p.slots.includes(slot));
}
