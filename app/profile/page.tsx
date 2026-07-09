import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";
import BottomNav from "@/components/BottomNav";
import BudgetMeter from "@/components/BudgetMeter";
import { isAdminEmail } from "@/lib/admin";
import { Globe } from "lucide-react";
import { TOTAL_COUNTRIES } from "@/lib/geo/countries";
import { getLatestTripId, planHrefFor } from "@/lib/trips/latest";
import ThemeToggle from "@/components/ThemeToggle";
import AccountHeader from "@/components/AccountHeader";
import SocialSection from "@/components/SocialSection";
import ShareStudio from "@/components/ShareStudio";
import { ReplayOnboardingRow } from "@/components/Onboarding";
import { friendlyName, utcDateStr } from "@/lib/social/format";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // All reads are independent — fan out in parallel (single RTT).
  const [
    profileRes,
    pointsRes,
    streakRes,
    tripsRes,
    countriesRes,
    checkinsRes,
    latestTripId,
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("display_name, username, avatar_emoji")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_points").select("coins").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("user_streaks")
      .select("current_streak, longest_streak, last_active, freezes")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("trips").select("*", { count: "exact", head: true }),
    supabase
      .from("user_places_status")
      .select("*", { count: "exact", head: true })
      .eq("entity_type", "country")
      .eq("status", "visited"),
    // Own check-ins → distinct cities, today-done flag, total count.
    supabase
      .from("checkins")
      .select("created_at, place:places(city_label, city)")
      .eq("user_id", user.id),
    getLatestTripId(supabase),
  ]);

  const profile = profileRes.data;
  const coins = pointsRes.data?.coins ?? 0;
  const streak = {
    current: streakRes.data?.current_streak ?? 0,
    longest: streakRes.data?.longest_streak ?? 0,
    lastActive: streakRes.data?.last_active ?? null,
    freezes: streakRes.data?.freezes ?? 2,
  };

  type CheckinRow = {
    created_at: string;
    place: { city_label: string | null; city: string | null } | null;
  };
  const checkins = (checkinsRes.data ?? []) as unknown as CheckinRow[];
  const cities = new Set(
    checkins
      .map((c) => c.place?.city_label ?? c.place?.city)
      .filter((c): c is string => !!c),
  ).size;
  const today = utcDateStr();
  const todayDone = checkins.some((c) => c.created_at.slice(0, 10) === today);

  const countries = countriesRes.count ?? 0;
  const trips = tripsRes.count ?? 0;
  const pct = Math.round((countries / TOTAL_COUNTRIES) * 100);
  const name = friendlyName(profile?.display_name ?? null, profile?.username ?? null, user.email);
  const memberYear = new Date(user.created_at).getFullYear();
  const planHref = planHrefFor(latestTripId);

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-4">
      <AccountHeader
        userId={user.id}
        name={name}
        username={profile?.username ?? null}
        avatarEmoji={profile?.avatar_emoji ?? null}
        memberYear={memberYear}
        coins={coins}
        countries={countries}
        cities={cities}
        trips={trips}
        streak={streak}
        todayDone={todayDone}
        planHref={planHref}
      />

      {/* Friend activity feed + friends manager (search / requests / list) */}
      <SocialSection hasUsername={!!profile?.username} />

      {/* Growth: share studio (travel card) */}
      <ShareStudio
        data={{
          name,
          username: profile?.username ?? null,
          pct,
          countries,
          cities,
          coins,
          longestStreak: streak.longest,
          checkins: checkins.length,
        }}
      />

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
              {countries > 0
                ? `${countries} دولة زرتها · ${pct}% من العالم`
                : "تتبّع الدول اللي زرتها والمدن اللي ودّك تروح لها"}
            </div>
          </div>
          <span className="text-xl opacity-90">←</span>
        </div>
      </Link>

      {/* Settings */}
      <div className="mt-4">
        <h2 className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-2 px-1">الإعدادات</h2>
        <div className="flex flex-col gap-2">
          <ThemeToggle />
          <ReplayOnboardingRow />
        </div>
      </div>

      <BudgetMeter />

      {isAdminEmail(user.email) && (
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

      {/* Account */}
      <div className="mt-4 bg-card border border-line rounded-2xl p-5 shadow space-y-3">
        <div>
          <div className="text-xs text-muted">البريد</div>
          <div className="font-bold text-sm" dir="ltr">{user.email ?? "—"}</div>
        </div>
        <div className="pt-3 border-t border-line-soft">
          <SignOutButton />
        </div>
      </div>

      <BottomNav active="profile" planHref={planHref} />
    </main>
  );
}
