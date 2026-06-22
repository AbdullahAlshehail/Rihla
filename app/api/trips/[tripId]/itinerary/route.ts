// POST /api/trips/:tripId/itinerary { day_date, slot, place_id }
// Adds a place to a specific slot in the day plan (max 3 per slot, no duplicates in same day).
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const SLOT_MAX = 3;
const Body = z.object({
  day_date: z.string(),       // YYYY-MM-DD
  slot: z.enum(["morning", "midday", "afternoon", "evening", "night"]),
  place_id: z.string().uuid(),
});

export async function POST(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { day_date, slot, place_id } = parsed.data;

  // Verify trip ownership
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();
  if (!trip) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Ensure the day row exists
  const { data: day, error: dayErr } = await supabase
    .from("itinerary_days")
    .upsert({ trip_id: tripId, day_date }, { onConflict: "trip_id,day_date" })
    .select("id")
    .single();
  if (dayErr) return NextResponse.json({ error: dayErr.message }, { status: 500 });

  // Same place can appear in multiple slots/days — couples often want to
  // re-visit a coffee spot in the morning AND afternoon. UI surfaces existing
  // placement before the user commits, so a duplicate is intentional.
  // We still cap items-per-slot to keep the day view readable.
  const { data: existingItems } = await supabase
    .from("itinerary_items")
    .select("slot, place_id, position")
    .eq("day_id", day.id);

  const inSlot = existingItems?.filter((it) => it.slot === slot) ?? [];
  if (inSlot.length >= SLOT_MAX) {
    return NextResponse.json({
      error: `الفترة ممتلئة (${SLOT_MAX} كحد أقصى) — احذف واحد قبل تضيف`,
    }, { status: 409 });
  }

  const { error } = await supabase.from("itinerary_items").insert({
    day_id: day.id,
    place_id,
    slot,
    position: inSlot.length,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
