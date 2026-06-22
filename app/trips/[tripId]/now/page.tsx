// Server entry for "وين أروح الآن؟". Fetches the trip + place catalog +
// user history (saves/ratings/verdicts), then hands off to a client-side
// NowScreen that runs the Decision Engine in the browser.
//
// No new Google calls happen here — we work off cached places only.

import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Place, Trip } from "@/lib/supabase/database.types";
import { PLACE_CARD_COLUMNS } from "@/lib/supabase/database.types";
import NowScreen from "@/components/NowScreen";
import { getRegionForCity } from "@/lib/utils";

type UserVerdict = "love" | "meh" | "skip";

export const dynamic = "force-dynamic";

export default async function NowPage({
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

  // Build place catalog — slim columns + per-city fairness for regions so the
  // Now Decision Engine considers up to 600 candidates per city in the region.
  const region = getRegionForCity(t.destination_city);
  const PER_CITY = 600;
  let placeQuery;
  if (region) {
    placeQuery = supabase
      .rpc("places_top_per_city", {
        city_keys: region.cities,
        city_labels: region.citiesAr,
        per_city: PER_CITY,
      })
      .select(PLACE_CARD_COLUMNS);
  } else if (t.destination_city) {
    placeQuery = supabase
      .from("places")
      .select(PLACE_CARD_COLUMNS)
      .order("rating", { ascending: false, nullsFirst: false })
      .order("review_count", { ascending: false, nullsFirst: false })
      .limit(PER_CITY)
      .or(`city.ilike.%${t.destination_city.toLowerCase()}%,city_label.ilike.%${t.destination_city}%`);
  } else {
    placeQuery = supabase
      .from("places")
      .select(PLACE_CARD_COLUMNS)
      .order("rating", { ascending: false, nullsFirst: false })
      .limit(PER_CITY);
  }

  const [{ data: places }, { data: saved }, { data: ratings }] = await Promise.all([
    placeQuery,
    supabase.from("user_saved_places").select("place_id"),
    supabase.from("user_place_ratings").select("place_id, stars, verdict"),
  ]);

  const initialSavedSet = new Set((saved ?? []).map((s) => s.place_id));
  const ratingsMap: Record<string, number> = {};
  const verdictsMap: Record<string, UserVerdict> = {};
  for (const r of (ratings ?? []) as Array<{ place_id: string; stars: number | null; verdict: string | null }>) {
    if (r.stars != null) ratingsMap[r.place_id] = r.stars;
    if (r.verdict === "love" || r.verdict === "meh" || r.verdict === "skip") {
      verdictsMap[r.place_id] = r.verdict;
    }
  }

  const userHistory = {
    saved: Array.from(initialSavedSet),
    ratings: ratingsMap,
    verdicts: verdictsMap,
  };

  return (
    <NowScreen
      trip={t}
      places={(places ?? []) as Place[]}
      userHistory={userHistory}
      initialSavedSet={initialSavedSet}
    />
  );
}
