// POST /api/places/[id]/enrich
// Lazy enrichment endpoint. Returns the updated place row.
// No-op if already fresh (< 30 days) or no API key set.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enrichPlaceFromGoogle, needsEnrichment } from "@/lib/google/enrich";
import { summarizeReviews } from "@/lib/ai/groq";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: place } = await supabase.from("places").select("*").eq("id", id).single();
  if (!place) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!needsEnrichment(place)) {
    return NextResponse.json({ place, refreshed: false });
  }

  if (!place.google_place_id) {
    return NextResponse.json({ place, refreshed: false, reason: "no_google_id" });
  }

  const result = await enrichPlaceFromGoogle(
    id,
    place.google_place_id,
    place.name,
    place.city_label ?? place.city,
  );
  if (!result.ok) {
    return NextResponse.json({ place, refreshed: false, reason: result.reason });
  }

  // Optional: Groq AI summary of fresh reviews (silent if no GROQ_API_KEY)
  if (result.patch?.google_reviews && result.patch.google_reviews.length > 0) {
    const summary = await summarizeReviews(place.name, result.patch.google_reviews);
    if (summary) {
      const sb = await createClient(); // re-use authed client to write own row (allowed via service role anyway)
      await sb.from("places").update({ ai_summary: summary }).eq("id", id);
    }
  }

  // Re-fetch
  const { data: updated } = await supabase.from("places").select("*").eq("id", id).single();
  return NextResponse.json({ place: updated, refreshed: true });
}
