// POST /api/trips/:tripId/bookings/:bookingId/use-as-hotel
// Copies hotel-booking location/name into trips.hotel_* so the rest of the
// app (NowScreen, distance chips, "return to hotel") picks it up.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _req: Request,
  { params }: { params: { tripId: string; bookingId: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: booking, error: bErr } = await supabase
    .from("trip_bookings")
    .select("type,title,address,lat,lng,location_name")
    .eq("id", params.bookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", user.id)
    .single();

  if (bErr || !booking) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (booking.type !== "hotel") {
    return NextResponse.json({ error: "only hotel bookings can be used as the trip hotel" }, { status: 400 });
  }

  // Build a partial update so we never silently null existing coords/address
  // when the booking lacks them. Only overwrite a field when the booking has
  // a meaningful value for it (audit 2026-06-15).
  const patch: Record<string, string | number> = {
    hotel_name: booking.location_name ?? booking.title,
  };
  if (booking.address)  patch.hotel_address = booking.address;
  if (booking.lat != null && booking.lng != null) {
    patch.hotel_lat = booking.lat;
    patch.hotel_lng = booking.lng;
  }

  const { error: tErr } = await supabase
    .from("trips")
    .update(patch)
    .eq("id", params.tripId)
    .eq("user_id", user.id);

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
