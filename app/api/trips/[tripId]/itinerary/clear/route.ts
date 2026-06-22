// POST /api/trips/:tripId/itinerary/clear
// Body: { day_date?: string }
//   - With day_date: deletes every item in that day
//   - Without day_date: deletes every item across the whole trip
// Idempotent — calling on an already-empty target succeeds with deleted=0.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  day_date: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Verify trip ownership before any delete
  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();
  if (!trip) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Resolve target day_ids based on scope
  let dayIdQuery = supabase
    .from("itinerary_days")
    .select("id")
    .eq("trip_id", tripId);
  if (parsed.data.day_date) {
    dayIdQuery = dayIdQuery.eq("day_date", parsed.data.day_date);
  }
  const { data: dayRows, error: dayErr } = await dayIdQuery;
  if (dayErr) return NextResponse.json({ error: dayErr.message }, { status: 500 });

  const dayIds = (dayRows ?? []).map((d) => d.id);
  if (dayIds.length === 0) return NextResponse.json({ ok: true, deleted: 0 });

  const { error: delErr, count } = await supabase
    .from("itinerary_items")
    .delete({ count: "exact" })
    .in("day_id", dayIds);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: count ?? 0 });
}
