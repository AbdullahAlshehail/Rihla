// POST   /api/passport/cities  → add a city under a visited country
//                                 body: { country: "FR", city: "نيس", status?: "visited"|"wishlist" }
// DELETE /api/passport/cities  → remove a city
//                                 body: { country: "FR", city: "نيس" }

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { findCountry } from "@/lib/geo/countries";

// Slug + composite key so lookups are cheap and predictable.
function cityKey(country: string, city: string) {
  const slug = city
    .trim()
    .toLowerCase()
    .replace(/[\s]+/g, "-")
    // strip characters that break URL / key comparison (keep Arabic letters)
    .replace(/[^\p{L}\p{N}-]/gu, "");
  return `${country.toUpperCase()}:${slug}`;
}

const AddBody = z.object({
  country: z.string().length(2),
  city: z.string().min(1).max(120),
  status: z.enum(["visited", "wishlist"]).default("visited"),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = AddBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { country, city, status } = parsed.data;
  const upper = country.toUpperCase();
  if (!findCountry(upper)) {
    return NextResponse.json({ error: "unknown country" }, { status: 400 });
  }

  const key = cityKey(upper, city);
  const { error } = await supabase
    .from("user_places_status")
    .upsert({
      user_id: user.id,
      entity_type: "city",
      entity_key: key,
      city_label: city.trim(),
      status,
    }, { onConflict: "user_id,entity_type,entity_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, key });
}

const RemoveBody = z.object({
  country: z.string().length(2),
  city: z.string().min(1).max(120),
});

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = RemoveBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { country, city } = parsed.data;
  const key = cityKey(country, city);
  const { error } = await supabase
    .from("user_places_status")
    .delete()
    .eq("user_id", user.id)
    .eq("entity_type", "city")
    .eq("entity_key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
