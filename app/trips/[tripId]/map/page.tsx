// Full-screen interactive map for the trip's region.
//
// Default scope: ONLY the cities that are in the user's plan ("trip cities"):
//   • the trip's destination_city
//   • every distinct city where the user has saved a place
//
// This keeps the map focused on places the user actually cares about. An
// optional `?expand=region` query opens the dropdown to the wider region so
// they can discover something new without leaving the page.

import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import type { Place, Trip } from "@/lib/supabase/database.types";
import { PLACE_MAP_COLUMNS } from "@/lib/supabase/database.types";
import { getRegionForCity } from "@/lib/utils";
import MapScreen from "@/components/MapScreen";

export const dynamic = "force-dynamic";

export default async function MapPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ expand?: string }>;
}) {
  const { tripId } = await params;
  const { expand } = await searchParams;
  const expandToRegion = expand === "region";

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (!trip) notFound();
  const t = trip as Trip;

  // ── Discover the user's "plan cities" in two cheap queries ────────────
  // We do them in parallel with the saved-set fetch we already need.
  const { data: savedRows } = await supabase
    .from("user_saved_places")
    .select("place_id")
    .eq("user_id", user.id);
  const savedIds = (savedRows ?? []).map((s) => s.place_id);

  // Resolve saved place IDs to their cities (just enough columns to build
  // a `tripCities` set, not the full PLACE row).
  const { data: savedCityRows } = savedIds.length > 0
    ? await supabase
      .from("places")
      .select("id, city, city_label")
      .in("id", savedIds)
    : { data: [] };

  // ── Build the canonical "trip cities" set ──────────────────────────────
  // city.key is the lowercase English key the catalogue uses; city.label is
  // the Arabic display we show in the UI. We track both because the source
  // catalogue rows may use either column.
  const tripCityKeys = new Set<string>();
  const tripCityLabels = new Set<string>();
  const region = getRegionForCity(t.destination_city);

  // 1) Destination city (best-effort from the region atlas first, else free-form).
  if (region) {
    // If `destination_city` matches a region's key/label, default the trip to
    // the region's PRIMARY city (first listed) — keeps fresh trips focused
    // until the user saves a place.
    tripCityKeys.add(region.cities[0]);
    tripCityLabels.add(region.citiesAr[0]);
  } else if (t.destination_city) {
    tripCityKeys.add(t.destination_city.toLowerCase().trim());
    tripCityLabels.add(t.destination_city.trim());
  }

  // 2) Every saved-place's city extends the plan.
  for (const p of (savedCityRows ?? [])) {
    if (p.city) tripCityKeys.add(p.city.toLowerCase().trim());
    if (p.city_label) tripCityLabels.add(p.city_label.trim());
  }

  // Region escape hatch: when `?expand=region` is set, widen the query to
  // every city in the trip's region. We still tell the client the original
  // trip cities so it can highlight "your plan" in the dropdown.
  const queryCityKeys = expandToRegion && region
    ? Array.from(new Set([...tripCityKeys, ...region.cities]))
    : Array.from(tripCityKeys);
  const queryCityLabels = expandToRegion && region
    ? Array.from(new Set([...tripCityLabels, ...region.citiesAr]))
    : Array.from(tripCityLabels);

  // ── Places query ──────────────────────────────────────────────────────
  // ANY city in the resolved set, ranked by rating. Per-city fairness isn't
  // needed here because the set is small (typically 1–3 cities).
  const PER_QUERY = expandToRegion ? 800 : 400;
  const orParts: string[] = [];
  for (const k of queryCityKeys) orParts.push(`city.eq.${k}`);
  for (const l of queryCityLabels) orParts.push(`city_label.eq.${l}`);

  const placeQuery = orParts.length > 0
    ? supabase
      .from("places")
      .select(PLACE_MAP_COLUMNS)
      .or(orParts.join(","))
      .order("rating", { ascending: false, nullsFirst: false })
      .order("review_count", { ascending: false, nullsFirst: false })
      .limit(PER_QUERY)
    : supabase
      .from("places")
      .select(PLACE_MAP_COLUMNS)
      .order("rating", { ascending: false, nullsFirst: false })
      .limit(PER_QUERY);

  const { data: places } = await placeQuery;

  // List of region cities NOT in plan — let the dropdown offer them as a
  // one-tap expansion ("+ استكشف نيس" etc).
  const extraRegionCities = region
    ? region.citiesAr
      .map((label, i) => ({ key: region.cities[i], label }))
      .filter((c) => !tripCityKeys.has(c.key) && !tripCityLabels.has(c.label))
    : [];

  return (
    <MapScreen
      trip={t}
      places={(places ?? []) as Place[]}
      initialSavedSet={new Set(savedIds)}
      tripCities={Array.from(tripCityLabels)}
      extraRegionCities={extraRegionCities}
      regionAr={region?.ar ?? null}
      expandedToRegion={expandToRegion}
    />
  );
}
