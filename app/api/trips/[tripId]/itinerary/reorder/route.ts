// POST /api/trips/:tripId/itinerary/reorder { day_id, ordered_ids }
// Atomically reassigns position 0..N-1 to all items in a day in the given
// order. Replaces the racy two-PATCH swap that the UI used to do.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  day_id: z.string().uuid(),
  ordered_ids: z.array(z.string().uuid()).min(1).max(50),
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
  const { day_id, ordered_ids } = parsed.data;

  const { data: trip } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();
  if (!trip) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The user owns this trip — but the supplied `day_id` could still belong to
  // a DIFFERENT trip they own. Verify the day lives under the right trip
  // before mutating, or the URL `tripId` becomes decorative.
  const { data: day } = await supabase
    .from("itinerary_days")
    .select("trip_id")
    .eq("id", day_id)
    .single();
  if (!day || day.trip_id !== tripId) {
    return NextResponse.json({ error: "day not in trip" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("itinerary_items")
    .select("id, day_id, place_id, slot")
    .eq("day_id", day_id);
  const existingById = new Map((existing ?? []).map((r) => [r.id, r]));
  if (ordered_ids.length !== existingById.size || !ordered_ids.every((id) => existingById.has(id))) {
    return NextResponse.json({ error: "ordered_ids must contain all items in the day exactly once" }, { status: 400 });
  }

  // Single atomic upsert — was N parallel UPDATEs, which were both racy on
  // failure and serialized at the Postgres layer (= N RTTs of latency).
  const rows = ordered_ids.map((id, idx) => {
    const r = existingById.get(id)!;
    return { id, day_id: r.day_id, place_id: r.place_id, slot: r.slot, position: idx };
  });
  const { error } = await supabase
    .from("itinerary_items")
    .upsert(rows, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
