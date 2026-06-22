// Flexible day view — shows today's plan (or first planned day if today is
// outside the trip range) grouped into 5 narrative phases:
// الصباح · بعد الظهر · الغداء/العشاء · آخر اليوم · رجعة الفندق
//
// Coexists with /plan (the classic 5-slot editor). No new Google calls.

import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { ItineraryDay, ItineraryItem, Place, Trip } from "@/lib/supabase/database.types";
import { PLACE_LIST_COLUMNS } from "@/lib/supabase/database.types";
import DayView from "@/components/DayView";
import { regionFilterClauseFor } from "@/lib/utils";

export const dynamic = "force-dynamic";

type ItemWithPlace = ItineraryItem & { places: Place };

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const supabase = await createClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (!trip) notFound();
  const t = trip as Trip;

  // Find which day to show: today's date if matched, otherwise the first day
  const { data: days } = await supabase
    .from("itinerary_days")
    .select("*")
    .eq("trip_id", tripId)
    .order("day_date", { ascending: true });

  const allDays = (days ?? []) as ItineraryDay[];
  const todayStr = todayDateString();
  const todayDay = allDays.find((d) => d.day_date === todayStr) ?? allDays[0] ?? null;

  // Fetch items for the selected day (joined with places)
  let items: ItemWithPlace[] = [];
  if (todayDay) {
    const { data } = await supabase
      .from("itinerary_items")
      .select("*, places(*)")
      .eq("day_id", todayDay.id)
      .order("position", { ascending: true });
    items = (data ?? []) as ItemWithPlace[];
  }

  // Catalogue — region-aware (Riviera trip → all 10 Côte d'Azur cities)
  let catQuery = supabase
    .from("places")
    .select(PLACE_LIST_COLUMNS)
    .order("rating", { ascending: false, nullsFirst: false })
    .order("review_count", { ascending: false, nullsFirst: false })
    .limit(600);
  const regionClause = regionFilterClauseFor(t.destination_city);
  if (regionClause) {
    catQuery = catQuery.or(regionClause);
  } else if (t.destination_city) {
    catQuery = catQuery.or(
      `city.ilike.%${t.destination_city.toLowerCase()}%,city_label.ilike.%${t.destination_city}%`,
    );
  }
  const { data: catalogue } = await catQuery;

  return (
    <DayView
      trip={t}
      day={todayDay}
      items={items}
      catalogue={(catalogue ?? []) as Place[]}
      allDays={allDays}
    />
  );
}
