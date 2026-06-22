// Server entry for "الحجوزات والتكاليف". Fetches trip + bookings server-side
// then hands off to BookingsScreen. RLS enforces ownership; we still check
// the trip exists for a clean 404.

import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import type { Trip, TripBooking } from "@/lib/supabase/database.types";
import BookingsScreen from "@/components/BookingsScreen";

export const dynamic = "force-dynamic";

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (!trip) notFound();

  const { data: bookings } = await supabase
    .from("trip_bookings")
    .select("*")
    .eq("trip_id", tripId)
    .order("start_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  return (
    <BookingsScreen
      trip={trip as Trip}
      initialBookings={(bookings ?? []) as TripBooking[]}
    />
  );
}
