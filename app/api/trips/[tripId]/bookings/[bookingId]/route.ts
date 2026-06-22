// PATCH/DELETE /api/trips/:tripId/bookings/:bookingId
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PaidEnum = z.enum(["paid", "unpaid", "partial", "unknown"]);
const CurrencyEnum = z.enum(["SAR", "EUR", "USD", "GBP", "AED"]);

const PatchBody = z.object({
  title: z.string().min(1).max(200).optional(),
  subtitle: z.string().max(200).nullable().optional(),
  start_at: z.string().datetime().nullable().optional(),
  end_at: z.string().datetime().nullable().optional(),
  location_name: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  currency: CurrencyEnum.nullable().optional(),
  paid_status: PaidEnum.optional(),
  reference: z.string().max(120).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  file_path: z.string().max(500).nullable().optional(),
  file_mime: z.string().max(80).nullable().optional(),
}).refine(
  (d) => !d.start_at || !d.end_at || new Date(d.end_at) >= new Date(d.start_at),
  { message: "end_at must be on or after start_at", path: ["end_at"] },
);

async function getOwnedBooking(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  tripId: string,
  bookingId: string,
) {
  return supabase
    .from("trip_bookings")
    .select("*")
    .eq("id", bookingId)
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .single();
}

export async function PATCH(
  req: Request,
  { params }: { params: { tripId: string; bookingId: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("trip_bookings")
    .update(parsed.data)
    .eq("id", params.bookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ booking: data });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { tripId: string; bookingId: string } },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Fetch first so we can clean up the attached file (if any)
  const { data: booking } = await getOwnedBooking(supabase, user.id, params.tripId, params.bookingId);

  const { error } = await supabase
    .from("trip_bookings")
    .delete()
    .eq("id", params.bookingId)
    .eq("trip_id", params.tripId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (booking?.file_path) {
    // Fire-and-forget — file removal failure should not undo the booking
    // deletion. Storage RLS already restricts to the owner.
    await supabase.storage.from("booking-files").remove([booking.file_path]).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
