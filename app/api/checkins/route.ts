// POST /api/checkins — geofenced check-in. Body: { place_id, lat, lng, rating?, vibes?, shout? }
//
// The GPS geofence (≤150m) is enforced SERVER-SIDE inside the Postgres
// `create_checkin` SECURITY DEFINER function — the `checkins` table has no
// INSERT policy, so a client cannot bypass it with a direct write. This route
// only forwards the caller's submitted position; the DB decides.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  place_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  vibes: z.array(z.string().max(40)).max(12).nullable().optional(),
  shout: z.string().max(280).nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { place_id, lat, lng, rating, vibes, shout } = parsed.data;

  const { data, error } = await supabase.rpc("create_checkin", {
    p_place_id: place_id,
    p_lat: lat,
    p_lng: lng,
    p_rating: rating ?? null,
    p_vibes: vibes ?? null,
    p_shout: shout ?? null,
  });

  if (error) {
    // The geofence raises `too_far:<metres>` — surface it so the UI can tell
    // the user exactly how far off they are without leaking anything else.
    const msg = error.message ?? "checkin_failed";
    if (msg.includes("too_far")) {
      const m = msg.match(/too_far:(\d+)/);
      return NextResponse.json(
        { error: "too_far", distance_m: m ? Number(m[1]) : null },
        { status: 422 },
      );
    }
    if (msg.includes("place_has_no_coordinates")) {
      return NextResponse.json({ error: "no_coordinates" }, { status: 422 });
    }
    if (msg.includes("location_required")) {
      return NextResponse.json({ error: "location_required" }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ ok: true, checkin: data });
}
