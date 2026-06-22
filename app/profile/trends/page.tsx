// /profile/trends — explicit control panel for the user to scan trending
// places per city. One row per region city with: current trending count,
// last scan timestamp, and a "🔥 جلب الترند" button.
//
// Auth: any authenticated user (no admin gate — they pay for their own scans).

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import TrendsManagement, { type CityRow } from "@/components/TrendsManagement";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ── Aggregate per-city stats from places + trend_discovery_runs ──
  // Cheap two-query approach — both run in parallel.
  const [{ data: cityRows }, { data: runRows }] = await Promise.all([
    supabase
      .from("places")
      .select("city_label, trending_score")
      .not("city_label", "is", null),
    supabase
      .from("trend_discovery_runs")
      .select("city_label, started_at, status, matches_count, cost_usd")
      .order("started_at", { ascending: false })
      .limit(200),
  ]);

  // Group places into per-city total/trending-count counters.
  const byCity = new Map<string, { total: number; trending: number }>();
  for (const r of (cityRows ?? [])) {
    const label = (r.city_label ?? "").trim();
    if (!label) continue;
    const cur = byCity.get(label) ?? { total: 0, trending: 0 };
    cur.total += 1;
    if ((r.trending_score ?? 0) >= 50) cur.trending += 1;
    byCity.set(label, cur);
  }

  // Pick the latest scan per city
  const lastRunByCity = new Map<string, typeof runRows extends (infer T)[] | null ? T : never>();
  for (const run of (runRows ?? [])) {
    const label = (run.city_label ?? "").trim();
    if (!label || lastRunByCity.has(label)) continue;
    lastRunByCity.set(label, run);
  }

  const cities: CityRow[] = Array.from(byCity.entries())
    .filter(([, v]) => v.total >= 5)   // skip cities with almost no catalogue
    .sort((a, b) => b[1].total - a[1].total)
    .map(([label, v]) => {
      const lr = lastRunByCity.get(label);
      return {
        city_label: label,
        total: v.total,
        trending: v.trending,
        last_scan_at: lr?.started_at ?? null,
        last_scan_status: lr?.status ?? null,
        last_scan_matches: lr?.matches_count ?? null,
        last_scan_cost: lr?.cost_usd != null ? Number(lr.cost_usd) : null,
      };
    });

  return <TrendsManagement cities={cities} />;
}
