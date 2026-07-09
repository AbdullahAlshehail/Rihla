// Latest-trip lookup — powers the خطتي bottom-nav tab.
//
// The tab used to point at /plan, a server page whose ONLY job was to run
// this same query and redirect() to /trips/[id]/map?tab=plan. That extra
// hop (tap → RSC roundtrip → redirect → full map load) is what made the
// tab feel like "a page flashes, then the map appears". Pages that render
// BottomNav call this once (in parallel with their own queries) and hand
// the direct map URL down, so the tab navigates in a single hop.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function getLatestTripId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabase
    .from("trips")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

/** Direct href for the خطتي tab. Falls back to /plan (which auto-creates a
 *  default trip) only when the user has no trips yet. */
export function planHrefFor(tripId: string | null): string {
  return tripId ? `/trips/${tripId}/map?tab=plan` : "/plan";
}
