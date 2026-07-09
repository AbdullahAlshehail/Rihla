// GET  /api/passport  → all user_places_status rows for the caller
// POST /api/passport  → toggle a country's status (visited/wishlist/none)
//                       body: { code: "FR", status: "visited" | "wishlist" | null }

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { findCountry } from "@/lib/geo/countries";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_places_status")
    .select("entity_type, entity_key, status, city_label, visited_year, notes, updated_at")
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

const ToggleBody = z.object({
  code: z.string().length(2),
  // null → delete the row (mark as neither visited nor wishlist)
  status: z.enum(["visited", "wishlist"]).nullable(),
  visited_year: z.number().int().min(1900).max(2100).nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = ToggleBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { code, status, visited_year } = parsed.data;
  const upper = code.toUpperCase();
  if (!findCountry(upper)) {
    return NextResponse.json({ error: "unknown country code" }, { status: 400 });
  }

  if (status === null) {
    // Removing a country cascades to its cities. Two round-trips instead of
    // one .or() with a like-prefix — PostgREST's `like` filter uses `*` as
    // wildcard (not `%`), and encoding `*` inside `.or()` groups is brittle.
    // Explicit calls are unambiguous and both hit the RLS-scoped index.
    const [countryRes, citiesRes] = await Promise.all([
      supabase.from("user_places_status").delete()
        .eq("user_id", user.id)
        .eq("entity_type", "country")
        .eq("entity_key", upper),
      supabase.from("user_places_status").delete()
        .eq("user_id", user.id)
        .eq("entity_type", "city")
        .like("entity_key", `${upper}:%`),
    ]);
    const err = countryRes.error ?? citiesRes.error;
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: true });
  }

  const { error } = await supabase
    .from("user_places_status")
    .upsert({
      user_id: user.id,
      entity_type: "country",
      entity_key: upper,
      status,
      visited_year: visited_year ?? null,
    }, { onConflict: "user_id,entity_type,entity_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
