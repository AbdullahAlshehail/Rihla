import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import SignOutButton from "@/components/SignOutButton";
import BottomNav from "@/components/BottomNav";
import BudgetMeter from "@/components/BudgetMeter";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { count: tripCount } = await supabase
    .from("trips")
    .select("*", { count: "exact", head: true });
  const { count: savedCount } = await supabase
    .from("user_saved_places")
    .select("*", { count: "exact", head: true });

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <header className="mb-6">
        <h1 className="font-serif font-extrabold text-2xl text-sea">حسابي</h1>
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

      <BudgetMeter />

      {isAdminEmail(user?.email) && (
        <Link
          href="/profile/admin"
          className="mt-4 block bg-stone-900 text-white rounded-2xl p-4 shadow-md active:scale-[0.98] transition"
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

      <BottomNav active="profile" />
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
