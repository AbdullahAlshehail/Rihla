// GET    /api/trips/:tripId  → trip details
// PATCH  /api/trips/:tripId  → update trip + budget
// DELETE /api/trips/:tripId  → delete trip
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { geocode } from "@/lib/google/geocode";

const Patch = z.object({
  trip: z.object({
    name: z.string().min(1).optional(),
    destination_city: z.string().optional(),
    start_date: z.string().optional().nullable(),
    end_date: z.string().optional().nullable(),
    travelers: z.number().int().min(1).max(20).optional(),
    budget_style: z.enum(["economical", "mid", "luxury"]).optional(),
    hotel_name: z.string().optional().nullable(),
    hotel_address: z.string().optional().nullable(),
  }).optional(),
  budget: z.object({
    flight_total_sar: z.number().min(0).optional(),
    hotel_per_night_sar: z.number().min(0).optional(),
    nights: z.number().int().min(0).optional(),
    transport_daily_sar: z.number().min(0).optional(),
    misc_daily_sar: z.number().min(0).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    notes: z.string().nullable().optional(),
  }).optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  // Defense-in-depth: RLS would also block this, but the explicit 401 is
  // cheaper and clearer than letting RLS return an empty row.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("trips")
    .select("*, budget_assumptions(*)")
    .eq("id", tripId)
    .eq("user_id", user.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ trip: data });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = Patch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { trip, budget } = parsed.data;

  if (trip) {
    const update: Record<string, unknown> = { ...trip };
    if (trip.hotel_address !== undefined && trip.hotel_address) {
      const { result } = await geocode(trip.hotel_address, user.id);
      if (result) {
        update.hotel_lat = result.lat;
        update.hotel_lng = result.lng;
        update.hotel_place_id = result.place_id;
        update.hotel_address = result.formatted_address;
      }
    }
    const { error } = await supabase
      .from("trips")
      .update(update)
      .eq("id", tripId)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (budget) {
    const { error } = await supabase
      .from("budget_assumptions")
      .upsert({ trip_id: tripId, ...budget }, { onConflict: "trip_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await supabase
    .from("trips")
    .delete()
    .eq("id", tripId)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
