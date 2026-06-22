import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Trip, BudgetAssumptions } from "@/lib/supabase/database.types";
import TripSettingsForm from "@/components/TripSettingsForm";
import BottomNav from "@/components/BottomNav";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const supabase = await createClient();
  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).single();
  if (!trip) notFound();
  const { data: budget } = await supabase
    .from("budget_assumptions")
    .select("*")
    .eq("trip_id", tripId)
    .maybeSingle();

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <Link href={`/trips/${tripId}`} className="text-sea text-sm font-bold inline-block mb-3">
        ← {(trip as Trip).name}
      </Link>
      <h1 className="font-serif font-extrabold text-2xl text-sea mb-5">إعدادات الرحلة</h1>
      <TripSettingsForm
        trip={trip as Trip}
        budget={(budget as BudgetAssumptions) ?? null}
      />
      <BottomNav active="trips" />
    </main>
  );
}
