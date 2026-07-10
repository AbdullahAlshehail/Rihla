// رحلاتي — two inner tabs:
//   📍 أماكني — city-coverage of the user's REAL activity (check-ins, saves,
//               ratings) against the places catalogue.
//   🛂 جوازي  — "Been"-style world coverage tracker (countries + cities).

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PassportTabs from "@/components/PassportTabs";
import BottomNav from "@/components/BottomNav";
import Onboarding from "@/components/Onboarding";
import { getLatestTripId, planHrefFor } from "@/lib/trips/latest";
import {
  aggregateEngagement, computeVisitedRollup, TEASER_CANDIDATES,
  type CheckinRow, type SavedRow, type RatingRow, type TeaserCity,
} from "@/lib/places/myPlaces";
import { cityFromKey } from "@/lib/utils";

export const dynamic = "force-dynamic";

export type PassportRow = {
  entity_type: "country" | "city";
  entity_key: string;
  status: "visited" | "wishlist";
  city_label: string | null;
  visited_year: number | null;
  notes: string | null;
  updated_at: string;
};

const PLACE_JOIN = "place:places(id, name, city, city_label, category, country_code)";

export default async function PassportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // All five reads are independent — fan out in parallel.
  const [
    { data: statusRows },
    latestTripId,
    { data: checkinRows },
    { data: savedRows },
    { data: ratingRows },
  ] = await Promise.all([
    supabase
      .from("user_places_status")
      .select("entity_type, entity_key, status, city_label, visited_year, notes, updated_at")
      .eq("user_id", user.id),
    getLatestTripId(supabase),
    supabase
      .from("checkins")
      .select(`place_id, is_first_visit, created_at, ${PLACE_JOIN}`)
      .eq("user_id", user.id),
    supabase
      .from("user_saved_places")
      .select(`place_id, saved_at, ${PLACE_JOIN}`)
      .eq("user_id", user.id),
    supabase
      .from("user_place_ratings")
      .select(`place_id, stars, updated_at, ${PLACE_JOIN}`)
      .eq("user_id", user.id),
  ]);

  const passportRows = (statusRows ?? []) as PassportRow[];

  // ONE canonical "visited" aggregate (check-ins ∪ «زرتها» markers, rolled
  // up place → city → country) — consumed by BOTH tabs so numbers agree.
  const visited = computeVisitedRollup(
    (checkinRows ?? []) as unknown as CheckinRow[],
    passportRows,
  );

  const myPlaces = aggregateEngagement(
    (checkinRows ?? []) as unknown as CheckinRow[],
    (savedRows ?? []) as unknown as SavedRow[],
    (ratingRows ?? []) as unknown as RatingRow[],
    visited,
  );

  // Second wave: catalogue totals. One cheap HEAD count per city — the user
  // is active in a handful of cities, plus a few teaser candidates.
  const activeKeys = new Set(myPlaces.cities.map((c) => c.key));
  const candidates = TEASER_CANDIDATES.filter((t) => !activeKeys.has(t.key) && !activeKeys.has(t.label));
  const countFor = (key: string, label: string) =>
    supabase
      .from("places")
      .select("id", { count: "exact", head: true })
      .or(`city.eq.${key},city_label.eq.${label}`)
      .then(({ count }) => count ?? 0);

  const [activeCounts, teaserCounts] = await Promise.all([
    Promise.all(myPlaces.cities.map((c) => countFor(c.key, c.label))),
    Promise.all(candidates.map((t) => countFor(t.key, t.label))),
  ]);

  myPlaces.cities.forEach((c, i) => {
    // Never show coverage above 100% even if the catalogue shrank.
    c.total = Math.max(activeCounts[i], c.places.length);
  });
  myPlaces.teasers = candidates
    .map((t, i): TeaserCity => ({
      key: t.key,
      label: t.label,
      flag: cityFromKey(t.key)?.flag ?? "📍",
      total: teaserCounts[i],
    }))
    .filter((t) => t.total > 0)
    .slice(0, 4);

  return (
    <>
      <PassportTabs
        initialRows={passportRows}
        myPlaces={myPlaces}
        derived={{ countries: visited.derivedCountries, cities: visited.derivedCities }}
        planHref={planHrefFor(latestTripId)}
      />
      {/* First-run welcome — shows once per device (localStorage rihla_onboarded). */}
      <Onboarding />
      <BottomNav active="passport" planHref={planHrefFor(latestTripId)} />
    </>
  );
}
