import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Trip } from "@/lib/supabase/database.types";
import { fmtDayLong } from "@/lib/utils";
import BottomNav from "@/components/BottomNav";
import SignOutButton from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const supabase = await createClient();
  const { data: trips } = await supabase
    .from("trips")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <header className="flex items-baseline justify-between mb-6">
        <div>
          <h1 className="font-serif font-extrabold text-2xl text-sea">رحلاتي</h1>
          <p className="text-xs text-muted mt-1">كل خطة محفوظة لك</p>
        </div>
        <SignOutButton />
      </header>

      {(!trips || trips.length === 0) ? (
        <div className="bg-card border border-line rounded-2xl p-8 text-center shadow">
          <div className="text-5xl mb-3">🗺️</div>
          <p className="text-muted text-sm leading-relaxed mb-5">
            ما عندك رحلات لحد الحين.<br />ابدأ بإنشاء رحلتك الأولى.
          </p>
          <Link
            href="/trips/new"
            className="inline-block bg-coral text-white font-bold px-6 py-3 rounded-xl min-h-[48px]"
          >
            ＋ رحلة جديدة
          </Link>
        </div>
      ) : (
        <>
          <Link
            href="/trips/new"
            className="block w-full bg-coral text-white text-center font-bold py-3 rounded-xl mb-4 shadow"
          >
            ＋ رحلة جديدة
          </Link>
          <div className="space-y-3">
            {(trips as Trip[]).map((t) => (
              <Link
                key={t.id}
                href={`/trips/${t.id}`}
                prefetch
                className="block bg-card border border-line rounded-2xl p-4 shadow active:scale-[.99] transition"
              >
                <div className="font-serif font-extrabold text-lg text-ink">{t.name}</div>
                <div className="text-xs text-muted mt-1">
                  {t.destination_city ?? "—"}
                  {t.start_date && <> · {fmtDayLong(t.start_date)}</>}
                  {t.travelers && <> · {t.travelers} شخص</>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <BottomNav active="trips" />
    </main>
  );
}
