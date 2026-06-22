// Server-side helper: load user history from Supabase and infer their taste.
// Cached per request (small queries — DB is fast).

import { createClient } from "@/lib/supabase/server";
import { buildUserTaste, EMPTY_TASTE, type UserTaste } from "@/lib/scoring/userTaste";

export async function loadUserTaste(userId: string): Promise<UserTaste> {
  const supabase = await createClient();

  // Pull itinerary items + saved + ratings — joined to places for category/kind/highlights
  const [{ data: itineraryRows }, { data: savedRows }, { data: ratingRows }] = await Promise.all([
    supabase
      .from("itinerary_items")
      .select("places!inner(category, kind, highlights, price_level)")
      .limit(200),
    supabase
      .from("user_saved_places")
      .select("places!inner(category, kind, highlights)")
      .eq("user_id", userId)
      .limit(200),
    supabase
      .from("user_place_ratings")
      .select("stars, places!inner(category, kind, highlights)")
      .eq("user_id", userId)
      .limit(200),
  ]);

  const itinerary = (itineraryRows ?? []).map((r: any) => ({
    category: r.places.category,
    kind: r.places.kind,
    highlights: r.places.highlights,
    price_level: r.places.price_level,
  }));
  const saved = (savedRows ?? []).map((r: any) => ({
    category: r.places.category,
    kind: r.places.kind,
    highlights: r.places.highlights,
  }));
  const ratings = (ratingRows ?? []).map((r: any) => ({
    stars: r.stars,
    category: r.places.category,
    kind: r.places.kind,
    highlights: r.places.highlights,
  }));

  return buildUserTaste({ itinerary, saved, ratings });
}
