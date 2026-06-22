// GET /api/admin/usage-detail
// Precise, live API usage broken down by SKU, with last-update timestamp,
// daily counts, and projected month-end cost. Admin-only.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";

const FREE_TIER: Record<string, number> = {
  place_photo: 1_000,
  place_details: 5_000,
  places_search: 5_000,
  places_nearby_discover: 5_000,
  routes_matrix: 5_000,
  geocode: 10_000,
};
const PRICE_PER_1000_USD: Record<string, number> = {
  place_photo: 7,
  place_details: 17,
  places_search: 32,
  places_nearby_discover: 32,
  routes_matrix: 5,
  geocode: 5,
};
const SKU_AR: Record<string, { ar: string; emoji: string }> = {
  place_photo:              { ar: "صور Place",       emoji: "📸" },
  place_details:            { ar: "تفاصيل Place",   emoji: "🔍" },
  places_search:            { ar: "بحث Places",      emoji: "🧭" },
  places_nearby_discover:   { ar: "Places القريبة",  emoji: "📍" },
  routes_matrix:            { ar: "مصفوفة المسارات", emoji: "🛣" },
  geocode:                  { ar: "Geocoding",      emoji: "📐" },
};

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // KSA = UTC+3 — derive month/day boundaries in Asia/Riyadh so a 1 a.m. call
  // doesn't bucket to last month's totals (audit fix 2026-06-15).
  const KSA_OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowKsa = new Date(Date.now() + KSA_OFFSET_MS);
  // Strip the offset before formatting parts via UTC accessors
  const yKsa = nowKsa.getUTCFullYear();
  const mKsa = nowKsa.getUTCMonth();
  const dKsa = nowKsa.getUTCDate();
  // Convert "first day of this KSA month, 00:00 KSA" back to a real UTC instant
  const monthStart = new Date(Date.UTC(yKsa, mKsa, 1) - KSA_OFFSET_MS);
  const dayStart = new Date(Date.UTC(yKsa, mKsa, dKsa) - KSA_OFFSET_MS);

  // Override Supabase's default 1000-row cap — required once we exceed 1k
  // log rows in a month (audit fix 2026-06-15: counts would silently
  // under-report otherwise).
  const [{ data: monthRows }, { data: dayRows }, { data: latest }] = await Promise.all([
    supabase.from("api_usage_log").select("operation, cache_hit")
      .gte("created_at", monthStart.toISOString()).range(0, 99_999),
    supabase.from("api_usage_log").select("operation, cache_hit")
      .gte("created_at", dayStart.toISOString()).range(0, 49_999),
    supabase.from("api_usage_log").select("operation, cache_hit, created_at")
      .order("created_at", { ascending: false }).limit(1),
  ]);

  type Row = { operation: string; cache_hit: boolean };
  const monthByOp: Record<string, { real: number; cache: number }> = {};
  for (const r of (monthRows ?? []) as Row[]) {
    const slot = monthByOp[r.operation] ??= { real: 0, cache: 0 };
    if (r.cache_hit) slot.cache++; else slot.real++;
  }
  const dayByOp: Record<string, { real: number; cache: number }> = {};
  for (const r of (dayRows ?? []) as Row[]) {
    const slot = dayByOp[r.operation] ??= { real: 0, cache: 0 };
    if (r.cache_hit) slot.cache++; else slot.real++;
  }

  // Build per-SKU rows
  const ops = Array.from(new Set([
    ...Object.keys(SKU_AR),
    ...Object.keys(monthByOp),
    ...Object.keys(dayByOp),
  ]));
  const skus = ops.map((op) => {
    const m = monthByOp[op] ?? { real: 0, cache: 0 };
    const d = dayByOp[op] ?? { real: 0, cache: 0 };
    const free = FREE_TIER[op] ?? 0;
    const price = PRICE_PER_1000_USD[op] ?? 0;
    const billable = Math.max(0, m.real - free);
    const monthCostUsd = (billable * price) / 1000;
    const fullValueUsd = (m.real * price) / 1000;
    return {
      op,
      ar: SKU_AR[op]?.ar ?? op,
      emoji: SKU_AR[op]?.emoji ?? "•",
      month_real: m.real,
      month_cache: m.cache,
      day_real: d.real,
      day_cache: d.cache,
      free_tier_monthly: free,
      pct_of_free: free > 0 ? Math.round((m.real / free) * 10000) / 100 : 0,
      billable_calls: billable,
      month_cost_usd: Math.round(monthCostUsd * 10000) / 10000,
      full_value_usd: Math.round(fullValueUsd * 10000) / 10000,
    };
  }).sort((a, b) => b.pct_of_free - a.pct_of_free);

  // Totals
  const totalRealMonth = skus.reduce((s, x) => s + x.month_real, 0);
  const totalCostUsd = skus.reduce((s, x) => s + x.month_cost_usd, 0);
  const totalValueUsd = skus.reduce((s, x) => s + x.full_value_usd, 0);

  const latestRow = (latest ?? [])[0] as { operation: string; cache_hit: boolean; created_at: string } | undefined;

  return NextResponse.json({
    asOf: new Date().toISOString(),
    monthStart: monthStart.toISOString(),
    dayStart: dayStart.toISOString(),
    skus,
    totals: {
      real_calls_month: totalRealMonth,
      actual_cost_usd: Math.round(totalCostUsd * 10000) / 10000,
      value_at_full_price_usd: Math.round(totalValueUsd * 10000) / 10000,
      monthly_soft_cap_usd: 1.0,
    },
    last_call: latestRow ? {
      at: latestRow.created_at,
      operation: latestRow.operation,
      cache_hit: latestRow.cache_hit,
    } : null,
  });
}
