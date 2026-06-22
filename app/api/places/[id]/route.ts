// GET /api/places/:id  → place details (DB-first, optional Google enrichment)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlaceDetails } from "@/lib/google/places";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: place, error } = await supabase
    .from("places")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !place) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Optionally refresh from Google if we have its google_place_id and our cache is stale.
  let google_fresh = null;
  if (place.google_place_id) {
    const { data: { user } } = await supabase.auth.getUser();
    const g = await getPlaceDetails(place.google_place_id, user?.id ?? null);
    google_fresh = g.place;
  }
  return NextResponse.json({ place, google_fresh });
}
