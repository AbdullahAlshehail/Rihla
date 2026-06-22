// POST /api/places/search { query, lat?, lng? }
// 1) First search seeded places in DB by name/city (free, instant).
// 2) If no key OR results are thin, AND a Google key is configured, query Google Places.
// 3) Returns a unified shape that the UI can render.
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { searchPlaces } from "@/lib/google/places";

const Body = z.object({
  query: z.string().min(1),
  lat: z.number().optional(),
  lng: z.number().optional(),
  city: z.string().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { query, lat, lng, city } = parsed.data;

  // 1) Seeded matches first
  let dbQuery = supabase.from("places").select("*").limit(20);
  dbQuery = dbQuery.or(
    `name.ilike.%${query}%,tags.cs.{${query}},tip.ilike.%${query}%`
  );
  if (city) dbQuery = dbQuery.eq("city", city);
  const { data: seeded } = await dbQuery;

  // 2) Google fallback (only when key present)
  let google: Awaited<ReturnType<typeof searchPlaces>> | null = null;
  if ((seeded?.length ?? 0) < 5) {
    google = await searchPlaces({ query, lat, lng, userId: user.id });
  }

  return NextResponse.json({
    seeded: seeded ?? [],
    google: google?.places ?? [],
    mock: google?.mock ?? false,
    cached: google?.cached ?? false,
  });
}
