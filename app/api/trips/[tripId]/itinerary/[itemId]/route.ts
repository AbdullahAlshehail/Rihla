// DELETE /api/trips/:tripId/itinerary/:itemId  → remove a place from the plan
// PATCH  /api/trips/:tripId/itinerary/:itemId  → swap place_id (used by DayView)
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { itemId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // RLS in itinerary_items ensures we only delete our own (via trip ownership).
  const { error } = await supabase.from("itinerary_items").delete().eq("id", itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Accepts any subset of:
//  - place_id  → swap the place
//  - slot      → move to a different phase same day
//  - day_date  → move to a different day (auto-creates the day row)
const PatchBody = z.object({
  place_id: z.string().uuid().optional(),
  slot: z.enum(["morning", "midday", "afternoon", "evening", "night"]).optional(),
  day_date: z.string().optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ tripId: string; itemId: string }> }
) {
  const { tripId, itemId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const update: Record<string, unknown> = {};
  if (parsed.data.place_id) update.place_id = parsed.data.place_id;
  if (parsed.data.slot) update.slot = parsed.data.slot;

  // Moving to a different day requires resolving (or creating) the day row.
  // Trip ownership is enforced via RLS on itinerary_days.
  if (parsed.data.day_date) {
    const { data: day, error: dayErr } = await supabase
      .from("itinerary_days")
      .upsert({ trip_id: tripId, day_date: parsed.data.day_date }, { onConflict: "trip_id,day_date" })
      .select("id")
      .single();
    if (dayErr) return NextResponse.json({ error: dayErr.message }, { status: 500 });
    update.day_id = day.id;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no changes" }, { status: 400 });
  }

  const { error } = await supabase
    .from("itinerary_items")
    .update(update)
    .eq("id", itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
