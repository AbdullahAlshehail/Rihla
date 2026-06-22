// GET  /api/trips      → list current user's trips
// POST /api/trips      → create a new trip
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { geocode } from "@/lib/google/geocode";

const CreateTrip = z.object({
  name: z.string().min(1).max(120),
  destination_city: z.string().min(1).max(120),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  travelers: z.number().int().min(1).max(20).default(2),
  budget_style: z.enum(["economical", "mid", "luxury"]).default("mid"),
  hotel_name: z.string().optional().nullable(),
  hotel_address: z.string().optional().nullable(),
  preferences: z.array(z.string()).optional().default([]),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trips: data });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateTrip.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const f = parsed.data;

  // Best-effort geocoding (skipped silently when no Google key).
  let hotel_lat: number | null = null;
  let hotel_lng: number | null = null;
  let hotel_place_id: string | null = null;
  let hotel_address: string | null = f.hotel_address ?? null;
  if (f.hotel_address) {
    const { result } = await geocode(f.hotel_address, user.id);
    if (result) {
      hotel_lat = result.lat;
      hotel_lng = result.lng;
      hotel_place_id = result.place_id;
      hotel_address = result.formatted_address;
    }
  }

  const { data, error } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      name: f.name,
      destination_city: f.destination_city,
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      travelers: f.travelers,
      budget_style: f.budget_style,
      hotel_name: f.hotel_name || null,
      hotel_address,
      hotel_lat,
      hotel_lng,
      hotel_place_id,
      preferences: { categories: f.preferences },
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
