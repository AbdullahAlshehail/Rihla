// Unified trip page — 2 tabs (خطتي + اكتشف) + small ✨ "الآن" CTA.
// Deep links (/now, /day, /plan, /places) remain available.

import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type {
  Trip, ItineraryDay, ItineraryItem, Place, BudgetAssumptions,
} from "@/lib/supabase/database.types";
import { PLACE_CARD_COLUMNS } from "@/lib/supabase/database.types";
import { getRegionForCity } from "@/lib/utils";
import { loadUserTaste } from "@/lib/scoring/loadUserTaste";
import BottomNav from "@/components/BottomNav";
import TripScreen from "@/components/TripScreen";

export const dynamic = "force-dynamic";

type ItemWithPlace = ItineraryItem & { places: Place };

export default async function TripDetail({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const supabase = await createClient();

  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).single();
  if (!trip) notFound();
  const t = trip as Trip;

  // Sync days with the trip's current range — but ONLY if there's a mismatch.
  // We do a single SELECT first; the upsert/delete only fire when needed.
  // This is the page's hottest path so the no-op fast path matters.
  if (t.start_date && t.end_date) {
    const start = new Date(t.start_date);
    const end = new Date(t.end_date);
    const validDates = new Set<string>();
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      validDates.add(d.toISOString().slice(0, 10));
    }

    const { data: existingDays } = await supabase
      .from("itinerary_days")
      .select("id, day_date")
      .eq("trip_id", tripId);
    const existing = existingDays ?? [];
    const existingDates = new Set(existing.map((d) => d.day_date));

    // Need to add?
    const toAdd = Array.from(validDates).filter((d) => !existingDates.has(d));
    if (toAdd.length > 0) {
      await supabase
        .from("itinerary_days")
        .upsert(
          toAdd.map((d) => ({ trip_id: tripId, day_date: d, city: t.destination_city ?? null })),
          { onConflict: "trip_id,day_date", ignoreDuplicates: true },
        );
    }

    // Need to remove (only empty days outside range)?
    const outOfRange = existing.filter((d) => !validDates.has(d.day_date));
    if (outOfRange.length > 0) {
      const outIds = outOfRange.map((d) => d.id);
      const { data: occupiedRows } = await supabase
        .from("itinerary_items")
        .select("day_id")
        .in("day_id", outIds);
      const occupiedSet = new Set((occupiedRows ?? []).map((r) => r.day_id));
      const safeToDelete = outOfRange.filter((d) => !occupiedSet.has(d.id)).map((d) => d.id);
      if (safeToDelete.length > 0) {
        await supabase.from("itinerary_days").delete().in("id", safeToDelete);
      }
    }
  }

  // Catalogue — slim columns (PLACE_CARD_COLUMNS, ~600 bytes/row vs 3 KB on
  // the full list). When the destination belongs to a region, we call the
  // per-city RPC so Côte d'Azur returns up to 600 *for each* of Nice/Cannes/
  // Monaco rather than 1,800 dominated by the largest city. Single-city
  // destinations stick to a plain SELECT with ilike.
  const region = getRegionForCity(t.destination_city);
  const PER_CITY = 600;
  let catalogueQuery;
  if (region) {
    catalogueQuery = supabase
      .rpc("places_top_per_city", {
        city_keys: region.cities,
        city_labels: region.citiesAr,
        per_city: PER_CITY,
      })
      .select(PLACE_CARD_COLUMNS);
  } else if (t.destination_city) {
    catalogueQuery = supabase
      .from("places")
      .select(PLACE_CARD_COLUMNS)
      .order("rating", { ascending: false, nullsFirst: false })
      .order("review_count", { ascending: false, nullsFirst: false })
      .limit(PER_CITY)
      .or(`city.ilike.%${t.destination_city.toLowerCase()}%,city_label.ilike.%${t.destination_city}%`);
  } else {
    catalogueQuery = supabase
      .from("places")
      .select(PLACE_CARD_COLUMNS)
      .order("rating", { ascending: false, nullsFirst: false })
      .limit(PER_CITY);
  }

  // Get the user FIRST so we can fire loadUserTaste in parallel with the rest.
  const { data: { user } } = await supabase.auth.getUser();
  const userTastePromise = user ? loadUserTaste(user.id) : Promise.resolve(null);

  // Inner-join itinerary_items to itinerary_days so the trip filter happens
  // server-side. Massive win over fetching all items + JS filter.
  const [
    { data: daysRows },
    { data: catalogueRows },
    { data: itemsRows },
    { data: savedRows },
    { data: ratingsRows },
    { data: budgetRow },
    userTaste,
    { data: hiddenRows },
  ] = await Promise.all([
    supabase.from("itinerary_days").select("*").eq("trip_id", tripId).order("day_date"),
    catalogueQuery,
    supabase
      .from("itinerary_items")
      .select("*, places(*), itinerary_days!inner(trip_id)")
      .eq("itinerary_days.trip_id", tripId)
      .order("position"),
    supabase.from("user_saved_places").select("place_id"),
    supabase.from("user_place_ratings").select("place_id, stars, verdict"),
    supabase.from("budget_assumptions").select("*").eq("trip_id", tripId).maybeSingle(),
    userTastePromise,
    supabase.from("user_hidden_places").select("place_id"),
  ]);

  const days = (daysRows ?? []) as ItineraryDay[];
  const catalogue = (catalogueRows ?? []) as Place[];
  const items = (itemsRows ?? []) as ItemWithPlace[]; // already filtered server-side

  // Photo count derived from the catalogue we already fetched — no extra query.
  const photoCount = catalogue.filter((p) => p.photo_url != null).length;

  const savedSet = new Set((savedRows ?? []).map((s) => s.place_id));
  const hiddenSet = new Set((hiddenRows ?? []).map((h) => h.place_id));
  const userRatings = new Map<string, { stars: number | null; verdict: "love" | "meh" | "skip" | null }>();
  for (const r of (ratingsRows ?? []) as Array<{ place_id: string; stars: number | null; verdict: string | null }>) {
    userRatings.set(r.place_id, {
      stars: r.stars,
      verdict: (r.verdict === "love" || r.verdict === "meh" || r.verdict === "skip") ? r.verdict : null,
    });
  }

  return (
    <>
      <TripScreen
        trip={t}
        days={days}
        items={items}
        catalogue={catalogue}
        savedSet={savedSet}
        hiddenSet={hiddenSet}
        userRatings={userRatings}
        userTaste={userTaste}
        regionPlacesCount={catalogue.length}
        regionPhotoCount={photoCount}
        budget={budgetRow as BudgetAssumptions | null}
      />
      <BottomNav active="trips" />
    </>
  );
}
