// Budget estimator — SAR only at the UI layer. Internally converts every cost
// to SAR using the trip's locked-in rates snapshot (so a saved trip's totals
// don't drift if exchange rates change later).
//
// Confidence is HIGH only when:
//   - All items used in the calculation have cost_confidence='high'
//   - Hotel / flight / transport / misc are user-provided
// MEDIUM when costs are estimated by us (PLACE_META etc).
// LOW when many items are missing prices or assumptions are guesses.

import type { Place, Trip, Confidence } from "@/lib/supabase/database.types";

export type BudgetInput = {
  trip: Pick<Trip, "rates" | "travelers">;
  flightSar?: number;
  hotelPerNightSar?: number;
  nights?: number;
  transportDailySar?: number;
  miscDailySar?: number;
  placesByDay: Array<Array<{ place: Pick<Place, "cost_estimate" | "cost_currency" | "cost_confidence">; customCostSar?: number | null }>>;
};

export type BudgetOutput = {
  perPerson: {
    flight: number;
    hotel: number;
    transport: number;
    misc: number;
    activities: number;
    total: number;
  };
  total: number;
  travelers: number;
  confidence: Confidence;
  assumptions: string[];   // human-readable Arabic notes
};

export function estimateBudget(input: BudgetInput): BudgetOutput {
  const travelers = Math.max(1, input.trip.travelers ?? 1);
  const rates = input.trip.rates ?? { SAR: 1 };
  const rateFor = (cur: string) => rates[cur] ?? 1;

  const nights = input.nights ?? Math.max(0, input.placesByDay.length - 1);
  const flight = input.flightSar ?? 0;
  const hotel = (input.hotelPerNightSar ?? 0) * nights;
  const days = input.placesByDay.length;
  const transport = (input.transportDailySar ?? 0) * days * travelers;
  const misc = (input.miscDailySar ?? 0) * days * travelers;

  // Activity cost: per-person, summed across all days.
  let activities = 0;
  let lowConfItems = 0, totalItems = 0;
  for (const day of input.placesByDay) {
    for (const it of day) {
      totalItems++;
      if (it.customCostSar != null) {
        activities += it.customCostSar;
        continue;
      }
      const est = it.place.cost_estimate ?? 0;
      if (est <= 0) continue;
      const sar = it.place.cost_currency === "SAR" ? est : est * rateFor(it.place.cost_currency);
      activities += sar;
      if (it.place.cost_confidence === "low") lowConfItems++;
    }
  }
  activities *= travelers;

  // Confidence: blend item confidence + presence of user-entered numbers.
  let confidence: Confidence = "medium";
  const userEntered = (flight > 0 ? 1 : 0) + (hotel > 0 ? 1 : 0) + (transport > 0 ? 1 : 0) + (misc > 0 ? 1 : 0);
  if (lowConfItems / Math.max(1, totalItems) > 0.3) confidence = "low";
  else if (userEntered >= 3 && lowConfItems === 0) confidence = "high";

  const total = flight + hotel + transport + misc + activities;

  const assumptions: string[] = [];
  if (!input.flightSar) assumptions.push("لم تُدخل تكلفة الطيران بعد");
  if (!input.hotelPerNightSar) assumptions.push("لم تُدخل سعر الفندق");
  if (!input.transportDailySar) assumptions.push("المواصلات اليومية بدون قيمة — قدّرها لو تستخدم تاكسي");
  if (lowConfItems > 0) assumptions.push(`${lowConfItems} مكان عنده تقدير سعر ضعيف الثقة`);
  if (totalItems === 0) assumptions.push("ما في أماكن في الخطة بعد — التكلفة تشمل الإقامة فقط");

  return {
    perPerson: {
      flight: flight / travelers,
      hotel: hotel / travelers,
      transport: transport / travelers,
      misc: misc / travelers,
      activities: activities / travelers,
      total: total / travelers,
    },
    total,
    travelers,
    confidence,
    assumptions,
  };
}

export function confidenceLabel(c: Confidence): string {
  return c === "high" ? "ثقة عالية" : c === "medium" ? "ثقة متوسطة" : "ثقة منخفضة";
}
export function confidenceColor(c: Confidence): string {
  return c === "high" ? "text-ok" : c === "medium" ? "text-gold" : "text-danger";
}
