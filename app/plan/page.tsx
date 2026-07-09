// خطتي — shortcut route that lands the user directly on their trip's map.
// If they have a trip, redirect to its map. If not, auto-create a default
// "خطتي" trip so the user never has to navigate trip-creation upfront.

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Pick the most recently created trip. Simpler than surfacing a picker
  // — the user's mental model is "my plan," not "which of my trips."
  const { data: trips } = await supabase
    .from("trips")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);

  if (trips && trips.length > 0) {
    redirect(`/trips/${trips[0].id}/map?tab=plan`);
  }

  // No trip yet — create a default one on the fly. World-scope so it
  // works regardless of where the user actually travels.
  const { data: created, error } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      name: "خطتي",
      destination_city: "عالمي",
      travelers: 1,
      budget_style: "mid",
      preferences: [],
    })
    .select("id")
    .single();

  if (error || !created) {
    // Fall back to the manual creation flow rather than showing an error.
    redirect("/trips/new");
  }

  redirect(`/trips/${created.id}/map?tab=plan`);
}
