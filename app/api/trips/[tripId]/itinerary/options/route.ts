// GET /api/trips/:tripId/itinerary/options?dayId=...&slot=morning
// Returns top scored candidate places for a slot on a specific day.
// Marks which are already used in the same day (any slot) or in another day.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { loadUserTaste } from "@/lib/scoring/loadUserTaste";
import { SLOT_CATS, isOpenOnDayIdx, SLOT_SHORT } from "@/lib/slots";
import type { Place, Trip, Slot, Category } from "@/lib/supabase/database.types";
import { regionFilterClauseFor } from "@/lib/utils";

export async function GET(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const dayId = searchParams.get("dayId");
  const slot = searchParams.get("slot") as Slot | null;
  if (!dayId || !slot || !SLOT_CATS[slot]) {
    return NextResponse.json({ error: "missing dayId or slot" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Load trip + day in one round trip
  const [{ data: trip }, { data: day }] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).single(),
    supabase.from("itinerary_days").select("*").eq("id", dayId).single(),
  ]);
  if (!trip || !day) return NextResponse.json({ error: "not found" }, { status: 404 });
  const t = trip as Trip;
  const dayOfWeek = new Date(day.day_date + "T00:00:00").getDay();
  const targetCity = day.city ?? t.destination_city;

  // All items already in this trip (to mark "in this day" vs "in other day")
  const { data: tripItems } = await supabase
    .from("itinerary_items")
    .select("id, slot, place_id, day_id, itinerary_days!inner(trip_id, day_date)")
    .eq("itinerary_days.trip_id", tripId);

  const inSameDay = new Map<string, Slot>(); // place_id → which slot in current day
  const inOtherDay = new Set<string>();
  for (const it of (tripItems as any[]) ?? []) {
    if (it.day_id === dayId) inSameDay.set(it.place_id, it.slot);
    else inOtherDay.add(it.place_id);
  }

  // Load all candidates for this slot's allowed cats + matching city
  const cats = SLOT_CATS[slot];
  let q = supabase.from("places").select("*").in("category", cats as Category[]);
  const regionClause = regionFilterClauseFor(targetCity);
  if (regionClause) {
    q = q.or(regionClause);
  } else if (targetCity) {
    q = q.or(
      `city.ilike.%${targetCity.toLowerCase()}%,city_label.ilike.%${targetCity}%`
    );
  }
  const { data: places } = await q.limit(200);

  // Get user ratings + saves for personalization
  const placeIds = (places ?? []).map((p) => p.id);
  const [{ data: ratings }, { data: saved }] = await Promise.all([
    supabase.from("user_place_ratings").select("place_id, stars, verdict").in("place_id", placeIds),
    supabase.from("user_saved_places").select("place_id").in("place_id", placeIds),
  ]);
  const ratingBy = new Map(ratings?.map((r) => [r.place_id, r]) ?? []);
  const savedSet = new Set(saved?.map((s) => s.place_id));
  const hotelLoc = t.hotel_lat != null && t.hotel_lng != null
    ? { lat: t.hotel_lat, lng: t.hotel_lng } : null;
  const userTaste = await loadUserTaste(user.id);

  // Filter out closed-on-this-day, score, and rank
  const scored = ((places ?? []) as Place[])
    .filter((p) => isOpenOnDayIdx(p.opening_hours, dayOfWeek))
    .map((p) => {
      const ur = ratingBy.get(p.id);
      const { score, reasonAr } = computeSmartScore(p, {
        hotelLocation: hotelLoc,
        budgetStyle: t.budget_style,
        userSaved: savedSet.has(p.id),
        userRating: ur?.stars ?? null,
        userVerdict: (ur?.verdict as "love" | "meh" | "skip" | null) ?? null,
        preferredCategories: (t.preferences as { categories?: string[] })?.categories,
        userTaste,
      });
      // Boost category priority — first cat in SLOT_CATS gets the most points
      const catRank = cats.indexOf(p.category);
      const catBonus = catRank === 0 ? 5 : catRank === 1 ? 2 : 0;
      // Prefer same-city
      const cityBonus = targetCity && (p.city === targetCity || p.city_label === targetCity) ? 8 : 0;
      const finalScore = score + catBonus + cityBonus;
      const inThisDaySlot = inSameDay.get(p.id);
      return {
        place: p,
        score: finalScore,
        reasonAr,
        in_this_day_slot: inThisDaySlot ? SLOT_SHORT[inThisDaySlot] : null,
        in_other_day: !inThisDaySlot && inOtherDay.has(p.id),
      };
    });

  scored.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    options: scored.slice(0, 14),
    slot,
    city: targetCity,
  });
}
