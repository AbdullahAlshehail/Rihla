// Passport — "Been-app"-style world coverage tracker. Countries the user
// has visited or wants to visit, cities within each, and coverage stats.

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PassportScreen from "@/components/PassportScreen";
import BottomNav from "@/components/BottomNav";
import { getLatestTripId, planHrefFor } from "@/lib/trips/latest";

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

export default async function PassportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Rows + latest-trip lookup are independent — fan out in parallel.
  const [{ data }, latestTripId] = await Promise.all([
    supabase
      .from("user_places_status")
      .select("entity_type, entity_key, status, city_label, visited_year, notes, updated_at")
      .eq("user_id", user.id),
    getLatestTripId(supabase),
  ]);

  return (
    <>
      <PassportScreen initialRows={(data ?? []) as PassportRow[]} />
      <BottomNav active="passport" planHref={planHrefFor(latestTripId)} />
    </>
  );
}
