// POST /api/trips/:tripId/itinerary/suggest { day_id }
// Auto-fills empty slots in a day with the top-scored open place per slot.
// Won't overwrite slots that already have items. Avoids using a place that's
// already placed anywhere else in the trip.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { SLOT_CATS, SLOT_ORDER, isOpenOnDayIdx } from "@/lib/slots";
import type { Place, Trip, Slot, Category } from "@/lib/supabase/database.types";
import { regionFilterClauseFor } from "@/lib/utils";

const Body = z.object({ day_id: z.string().uuid() });

export async function POST(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const [{ data: trip }, { data: day }] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).eq("user_id", user.id).single(),
    supabase.from("itinerary_days").select("*").eq("id", parsed.data.day_id).single(),
  ]);
  if (!trip || !day) return NextResponse.json({ error: "not found" }, { status: 404 });
  const t = trip as Trip;
  const dayOfWeek = new Date(day.day_date + "T00:00:00").getDay();
  const targetCity = day.city ?? t.destination_city;

  // Existing items in trip (to avoid reusing)
  const { data: tripItems } = await supabase
    .from("itinerary_items")
    .select("id, slot, place_id, day_id, itinerary_days!inner(trip_id)")
    .eq("itinerary_days.trip_id", tripId);

  const usedAnywhere = new Set<string>((tripItems as any[])?.map((it) => it.place_id) ?? []);
  const inSlotCount = new Map<Slot, number>();
  for (const it of (tripItems as any[]) ?? []) {
    if (it.day_id === parsed.data.day_id) {
      inSlotCount.set(it.slot as Slot, (inSlotCount.get(it.slot as Slot) ?? 0) + 1);
    }
  }

  // Load candidate places (all open today, in target city, in any slot's cats)
  const allCats = Array.from(new Set(SLOT_ORDER.flatMap((s) => SLOT_CATS[s])));
  let q = supabase.from("places").select("*").in("category", allCats as Category[]);
  if (targetCity) {
    const regionClause = regionFilterClauseFor(targetCity);
    if (regionClause) {
      q = q.or(regionClause);
    } else {
      q = q.or(`city.ilike.%${targetCity.toLowerCase()}%,city_label.ilike.%${targetCity}%`);
    }
  }
  const { data: places } = await q.limit(300);
  const candidates = ((places ?? []) as Place[]).filter((p) =>
    isOpenOnDayIdx(p.opening_hours, dayOfWeek)
  );

  const hotelLoc = t.hotel_lat != null && t.hotel_lng != null
    ? { lat: t.hotel_lat, lng: t.hotel_lng } : null;

  let filled = 0, skipped = 0, empty = 0;

  // For each empty slot, pick the best unused candidate matching slot cats.
  for (const slot of SLOT_ORDER) {
    if ((inSlotCount.get(slot) ?? 0) > 0) {
      skipped++;
      continue;
    }
    const cats = SLOT_CATS[slot];
    const inCats = candidates.filter((p) => cats.includes(p.category as Category) && !usedAnywhere.has(p.id));
    if (inCats.length === 0) {
      empty++;
      continue;
    }
    // Score and pick top
    const scored = inCats.map((p) => {
      const { score } = computeSmartScore(p, {
        hotelLocation: hotelLoc,
        budgetStyle: t.budget_style,
      });
      const catRank = cats.indexOf(p.category as Category);
      const catBonus = catRank === 0 ? 5 : catRank === 1 ? 2 : 0;
      const cityBonus = targetCity && (p.city === targetCity || p.city_label === targetCity) ? 8 : 0;
      return { p, score: score + catBonus + cityBonus };
    });
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0].p;

    const { error } = await supabase.from("itinerary_items").insert({
      day_id: parsed.data.day_id,
      place_id: pick.id,
      slot,
      position: 0,
    });
    if (error) {
      empty++;
      continue;
    }
    usedAnywhere.add(pick.id);
    inSlotCount.set(slot, 1);
    filled++;
  }

  return NextResponse.json({ filled, skipped, empty });
}
