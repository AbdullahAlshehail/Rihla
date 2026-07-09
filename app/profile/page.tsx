import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";
import BottomNav from "@/components/BottomNav";
import BudgetMeter from "@/components/BudgetMeter";
import { isAdminEmail } from "@/lib/admin";
import { Globe } from "lucide-react";
import { TOTAL_COUNTRIES } from "@/lib/geo/countries";
import { getLatestTripId, planHrefFor } from "@/lib/trips/latest";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  // All five reads are independent — was a sequential await chain
  // (~4 × RTT) that delayed first paint on every tab switch to حسابي.
  const [
    { data: { user } },
    { count: tripCount },
    { count: savedCount },
    { count: visitedCount },
    latestTripId,
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("trips").select("*", { count: "exact", head: true }),
    supabase.from("user_saved_places").select("*", { count: "exact", head: true }),
    supabase
      .from("user_places_status")
      .select("*", { count: "exact", head: true })
      .eq("entity_type", "country")
      .eq("status", "visited"),
    getLatestTripId(supabase),
  ]);
  const pct = Math.round(((visitedCount ?? 0) / TOTAL_COUNTRIES) * 100);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <header className="mb-6">
        <h1 className="font-extrabold tracking-tight text-2xl text-sea">حسابي</h1>
      </header>

      <div className="bg-card border border-line rounded-2xl p-5 shadow space-y-3">
        <div>
          <div className="text-xs text-muted">البريد</div>
          <div className="font-bold text-sm" dir="ltr">{user?.email ?? "—"}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <Stat label="رحلات" value={tripCount ?? 0} />
          <Stat label="محفوظات" value={savedCount ?? 0} />
        </div>
        <div className="pt-4 border-t border-line-soft mt-4">
          <SignOutButton />
        </div>
      </div>

      <Link
        href="/passport"
        className="mt-4 block bg-gradient-to-br from-sea to-sea-600 text-white rounded-2xl p-4 shadow-md active:scale-[0.98] transition"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-base inline-flex items-center gap-1.5">
              <Globe size={18} aria-hidden="true" />
              <span>جواز سفري</span>
            </div>
            <div className="text-[12px] opacity-90 mt-1">
              {(visitedCount ?? 0) > 0
                ? `${visitedCount} دولة زرتها · ${pct}% من العالم`
                : "تتبّع الدول اللي زرتها والمدن اللي ودّك تروح لها"}
            </div>
          </div>
          <span className="text-xl opacity-90">←</span>
        </div>
      </Link>

      {/* Settings */}
      <div className="mt-4">
        <h2 className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-2 px-1">الإعدادات</h2>
        <ThemeToggle />
      </div>

      <BudgetMeter />

      {isAdminEmail(user?.email) && (
        <Link
          href="/profile/admin"
          className="mt-4 block bg-ink text-card rounded-2xl p-4 shadow-md active:scale-[0.98] transition"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-extrabold text-base">🛠 لوحة الإدارة</div>
              <div className="text-[12px] opacity-85 mt-0.5">
                استهلاك Google API، جلب أماكن، تحميل صور
              </div>
            </div>
            <span className="text-xl">←</span>
          </div>
        </Link>
      )}

      <BottomNav active="profile" planHref={planHrefFor(latestTripId)} />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-sand/40 rounded-xl py-3 px-4">
      <div className="font-serif font-extrabold text-2xl">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
