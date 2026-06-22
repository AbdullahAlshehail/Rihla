// POST /api/trips/:tripId/bookings — create a new booking entry
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const BookingTypeEnum = z.enum(["flight", "hotel", "event", "transport", "expense", "file"]);
const PaidEnum = z.enum(["paid", "unpaid", "partial", "unknown"]);
const CurrencyEnum = z.enum(["SAR", "EUR", "USD", "GBP", "AED"]);

const Body = z.object({
  type: BookingTypeEnum,
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).nullable().optional(),
  start_at: z.string().datetime().nullable().optional(),
  end_at: z.string().datetime().nullable().optional(),
  location_name: z.string().max(200).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  currency: CurrencyEnum.nullable().optional(),
  paid_status: PaidEnum.default("unknown"),
  reference: z.string().max(120).nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
  file_path: z.string().max(500).nullable().optional(),
  file_mime: z.string().max(80).nullable().optional(),
}).refine(
  (d) => !d.start_at || !d.end_at || new Date(d.end_at) >= new Date(d.start_at),
  { message: "end_at must be on or after start_at", path: ["end_at"] },
);

export async function POST(req: Request, { params }: { params: { tripId: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Verify the trip belongs to this user before insert (RLS would also block,
  // but a clean 403 is friendlier than a generic 500 from a policy violation).
  const { data: trip, error: tErr } = await supabase
    .from("trips").select("id").eq("id", params.tripId).eq("user_id", user.id).single();
  if (tErr || !trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("trip_bookings")
    .insert({
      user_id: user.id,
      trip_id: params.tripId,
      ...parsed.data,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ booking: data });
}
