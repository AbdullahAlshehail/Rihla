// New /plan view: server fetches days/items/catalogue and hands off to
// PlanScreen (client). Multi-day tabs, phase-based DayView style, one-tap
// add via AddToPlanSheet. Old InteractiveDayCard view retired here — its
// schema is unchanged, so the data carries forward intact.

import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type {
  Trip, ItineraryDay, ItineraryItem, Place, BudgetAssumptions,
} from "@/lib/supabase/database.types";
import { PLACE_LIST_COLUMNS } from "@/lib/supabase/database.types";
import BottomNav from "@/components/BottomNav";
import BudgetSummary from "@/components/BudgetSummary";
import PlanScreen from "@/components/PlanScreen";
import { estimateBudget } from "@/lib/budget/estimator";
import { regionFilterClauseFor } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ItemWithPlace = ItineraryItem & { places: Place };

export default async function PlanPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const supabase = await createClient();

  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).single();
  if (!trip) notFound();
  const t = trip as Trip;

  // Lazy-create itinerary_days for the trip range
  if (t.start_date && t.end_date) {
    const start = new Date(t.start_date);
    const end = new Date(t.end_date);
    const dates: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    if (dates.length) {
      await supabase
        .from("itinerary_days")
        .upsert(
          dates.map((d) => ({ trip_id: tripId, day_date: d, city: t.destination_city ?? null })),
          { onConflict: "trip_id,day_date", ignoreDuplicates: true },
        );
    }
  }

  // Parallel fetch — days, items, catalogue, budget
  const daysResult = await supabase
    .from("itinerary_days")
    .select("*")
    .eq("trip_id", tripId)
    .order("day_date");
  const days = (daysResult.data ?? []) as ItineraryDay[];

  let catalogueQuery = supabase
    .from("places")
    .select(PLACE_LIST_COLUMNS)
    .order("rating", { ascending: false, nullsFirst: false })
    .order("review_count", { ascending: false, nullsFirst: false })
    .limit(600);
  const regionClause = regionFilterClauseFor(t.destination_city);
  if (regionClause) {
    catalogueQuery = catalogueQuery.or(regionClause);
  } else if (t.destination_city) {
    catalogueQuery = catalogueQuery.or(
      `city.ilike.%${t.destination_city.toLowerCase()}%,city_label.ilike.%${t.destination_city}%`,
    );
  }

  const [
    { data: items },
    { data: catalogue },
    { data: budget },
  ] = await Promise.all([
    supabase
      .from("itinerary_items")
      .select("*, places(*)")
      .in("day_id", days.map((d) => d.id))
      .order("position"),
    catalogueQuery,
    supabase.from("budget_assumptions").select("*").eq("trip_id", tripId).maybeSingle(),
  ]);

  const itemsTyped = (items ?? []) as ItemWithPlace[];
  const cat = (catalogue ?? []) as Place[];

  // Budget rollup (unchanged from previous version)
  const placesByDay = days.map((d) =>
    itemsTyped.filter((x) => x.day_id === d.id).map((it) => ({
      place: {
        cost_estimate: it.places.cost_estimate,
        cost_currency: it.places.cost_currency,
        cost_confidence: it.places.cost_confidence,
      },
      customCostSar: it.custom_cost_sar,
    })),
  );
  const b = (budget as BudgetAssumptions | null);
  const budgetSummary = estimateBudget({
    trip: { rates: t.rates ?? { SAR: 1 }, travelers: t.travelers },
    flightSar: b?.flight_total_sar,
    hotelPerNightSar: b?.hotel_per_night_sar,
    nights: b?.nights,
    transportDailySar: b?.transport_daily_sar,
    miscDailySar: b?.misc_daily_sar,
    placesByDay,
  });

  return (
    <>
      <PlanScreen
        trip={t}
        days={days}
        items={itemsTyped}
        catalogue={cat}
      />
      {days.length > 0 && (
        <div className="max-w-2xl mx-auto px-4 pb-24 -mt-4">
          <BudgetSummary summary={budgetSummary} tripId={tripId} />
        </div>
      )}
      <BottomNav active="trips" />

      {/* Quick link back to discovery if the catalogue is small */}
      {cat.length < 10 && (
        <div className="max-w-2xl mx-auto px-4 -mt-2 pb-24">
          <Link
            href={`/trips/${tripId}/places`}
            className="block bg-white border border-dashed border-sea text-sea text-center font-bold text-xs py-2.5 rounded-xl"
          >
            🔍 استكشف أماكن جديدة من Google Maps
          </Link>
        </div>
      )}
    </>
  );
}
