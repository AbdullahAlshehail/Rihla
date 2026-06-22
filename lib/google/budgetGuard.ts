// In-app budget guard for Google Maps Platform calls.
//
// Reflects the post-March-2025 Google pricing model:
//  - NO more universal $200/month credit
//  - Each SKU has its own monthly free tier:
//      Geocoding / Autocomplete / Place Details Essentials: 10,000/month
//      Nearby Search + Text Search (Legacy and Pro):         5,000/month
//      Place Details Pro:                                    5,000/month
//      Place Photo:                                          1,000/month  ← critical
//
// Two layers:
//  1. Daily caps (per op) — sane upper bound for personal use.
//  2. Monthly soft cap ($10) — paranoia ceiling. If projected month cost
//     crosses this, NEW non-cached calls are refused.
//
// Cache hits are free and don't count against any cap.

import { createWriteClient } from "@/lib/supabase/server";

export type BudgetOp =
  | "places_search"
  | "place_details"
  | "places_nearby_discover"
  | "routes_matrix"
  | "geocode"
  | "place_photo"
  | "find_place";

// Daily caps — tuned to exhaust ~95% of each SKU's monthly free tier without
// crossing into billable territory. User explicitly wants to use the full free
// allowance from Google, so the caps below sit a hair under the monthly free
// limit. The monthly $ soft cap stays as a last-resort kill switch.
//
//   daily_cap × 30 ≤ monthly_free_tier × 0.95
//
const DEFAULT_DAILY_CAP: Record<BudgetOp, number> = {
  places_search: 150,          // 4,500/month vs 5,000 free
  place_details: 150,          // 4,500/month vs 5,000 free
  places_nearby_discover: 150, // 4,500/month vs 5,000 free
  routes_matrix: 100,          // free in most regions
  geocode: 300,                // 9,000/month vs 10,000 free
  // Tightest SKU: only 1,000 free photos/month. 30/day = 900/month.
  // With the proxy + 30-day CDN cache, the same image is served only once,
  // so 30 truly NEW photo loads/day covers heavy growth without billing.
  place_photo: 30,
  // Find Place from Text shares the same free tier slot as places_search.
  // Cheap user-driven action; cap at 100/day.
  find_place: 100,
};

// Per-SKU monthly free tier (after which Google bills).
// Used by `getMonthlyUsage()` to show how much room is left in the free tier.
export const MONTHLY_FREE_TIER: Record<BudgetOp, number> = {
  places_search: 5_000,
  place_details: 5_000,
  places_nearby_discover: 5_000,
  routes_matrix: 5_000,
  geocode: 10_000,
  place_photo: 1_000, // tightest — guard this one carefully
  find_place: 5_000,
};

// Per-call price AFTER the free tier is exhausted (USD per 1000).
const PRICE_PER_1000_USD: Record<BudgetOp, number> = {
  places_search: 32,
  place_details: 17,
  places_nearby_discover: 32,
  routes_matrix: 5,
  geocode: 5,
  place_photo: 7,
  find_place: 17,
};

// Hard global ceilings (final fail-safe). Configurable via env.
// Global daily cap raised to sum of per-SKU caps (~830) so a single big day
// can use the full free-tier slice across SKUs simultaneously.
const GLOBAL_DAILY_CAP = Number(process.env.BUDGET_GLOBAL_DAILY_CAP ?? 850);
// Monthly soft cap = $1 instead of $10. We're already gated by per-SKU caps
// that stay inside the free tier, so this only trips if something drifts and
// actually starts billing. At $17/1000 for details, $1 = ~58 billable calls
// past the free tier — enough headroom to notice + react before damage.
const MONTHLY_SOFT_CAP_USD = Number(process.env.BUDGET_MONTHLY_SOFT_CAP_USD ?? 1);

function capFor(op: BudgetOp): number {
  const envKey = `BUDGET_${op.toUpperCase()}_DAILY`;
  const fromEnv = process.env[envKey];
  if (fromEnv && Number.isFinite(Number(fromEnv))) return Number(fromEnv);
  return DEFAULT_DAILY_CAP[op];
}

export type BudgetStatus = {
  allowed: boolean;
  used: number;
  cap: number;
  globalUsed: number;
  globalCap: number;
  monthlyCostUsd: number;
  monthlyCapUsd: number;
  reason?: string;
};

/** Returns {allowed:false} when daily cap, global cap, or monthly $ cap is hit. */
export async function checkBudget(op: BudgetOp): Promise<BudgetStatus> {
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return {
      allowed: true, used: 0, cap: capFor(op),
      globalUsed: 0, globalCap: GLOBAL_DAILY_CAP,
      monthlyCostUsd: 0, monthlyCapUsd: MONTHLY_SOFT_CAP_USD,
    };
  }

  try {
    const sb = await createWriteClient();
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

    const [opDay, globalDay, monthAll] = await Promise.all([
      sb.from("api_usage_log").select("id", { count: "exact", head: true })
        .eq("operation", op).eq("cache_hit", false).gte("created_at", dayStart.toISOString()),
      sb.from("api_usage_log").select("id", { count: "exact", head: true })
        .eq("cache_hit", false).gte("created_at", dayStart.toISOString()),
      sb.from("api_usage_log").select("operation")
        .eq("cache_hit", false).gte("created_at", monthStart.toISOString()),
    ]);

    const used = opDay.count ?? 0;
    const globalUsed = globalDay.count ?? 0;
    const cap = capFor(op);

    // Compute estimated monthly $ cost: sum of (calls beyond free tier) × price
    const monthByOp = new Map<string, number>();
    for (const row of (monthAll.data ?? []) as Array<{ operation: string }>) {
      monthByOp.set(row.operation, (monthByOp.get(row.operation) ?? 0) + 1);
    }
    let monthlyCostUsd = 0;
    for (const [opName, calls] of monthByOp) {
      const tier = MONTHLY_FREE_TIER[opName as BudgetOp] ?? 0;
      const price = PRICE_PER_1000_USD[opName as BudgetOp] ?? 0;
      const billable = Math.max(0, calls - tier);
      monthlyCostUsd += (billable / 1000) * price;
    }
    monthlyCostUsd = Math.round(monthlyCostUsd * 100) / 100;

    if (monthlyCostUsd >= MONTHLY_SOFT_CAP_USD) {
      return {
        allowed: false, used, cap,
        globalUsed, globalCap: GLOBAL_DAILY_CAP,
        monthlyCostUsd, monthlyCapUsd: MONTHLY_SOFT_CAP_USD,
        reason: `Monthly soft cap $${MONTHLY_SOFT_CAP_USD} reached (cost so far $${monthlyCostUsd}).`,
      };
    }
    if (globalUsed >= GLOBAL_DAILY_CAP) {
      return {
        allowed: false, used, cap,
        globalUsed, globalCap: GLOBAL_DAILY_CAP,
        monthlyCostUsd, monthlyCapUsd: MONTHLY_SOFT_CAP_USD,
        reason: `Global daily cap ${GLOBAL_DAILY_CAP} reached.`,
      };
    }
    if (used >= cap) {
      return {
        allowed: false, used, cap,
        globalUsed, globalCap: GLOBAL_DAILY_CAP,
        monthlyCostUsd, monthlyCapUsd: MONTHLY_SOFT_CAP_USD,
        reason: `Daily cap for ${op} (${cap}) reached.`,
      };
    }
    return {
      allowed: true, used, cap,
      globalUsed, globalCap: GLOBAL_DAILY_CAP,
      monthlyCostUsd, monthlyCapUsd: MONTHLY_SOFT_CAP_USD,
    };
  } catch (e) {
    // Fail-OPEN if the log table is unreachable. App-level safety is still
    // in caches + lazy fetching; user-side Google Cloud quotas are the
    // ultimate backstop.
    console.warn("[budgetGuard] check failed — failing open:", e);
    return {
      allowed: true, used: 0, cap: capFor(op),
      globalUsed: 0, globalCap: GLOBAL_DAILY_CAP,
      monthlyCostUsd: 0, monthlyCapUsd: MONTHLY_SOFT_CAP_USD,
    };
  }
}

/** Daily + monthly usage breakdown for the dashboard. */
export async function getDailyUsage(): Promise<{
  byOp: Array<{
    op: string;
    usedToday: number;
    dailyCap: number;
    pctDaily: number;
    usedThisMonth: number;
    monthlyFreeTier: number;
    pctMonthlyFree: number;
    pricePer1000Usd: number;
    billableThisMonth: number;
    monthlyCostUsd: number;
  }>;
  globalUsedToday: number;
  globalDailyCap: number;
  monthlyCostUsd: number;
  monthlySoftCapUsd: number;
}> {
  try {
    const sb = await createWriteClient();
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

    const [day, month] = await Promise.all([
      sb.from("api_usage_log").select("operation, cache_hit").gte("created_at", dayStart.toISOString()),
      sb.from("api_usage_log").select("operation, cache_hit").gte("created_at", monthStart.toISOString()),
    ]);

    const dayByOp = new Map<string, number>();
    const monthByOp = new Map<string, number>();
    let globalUsedToday = 0;
    for (const r of (day.data ?? []) as Array<{ operation: string; cache_hit: boolean }>) {
      if (r.cache_hit) continue;
      dayByOp.set(r.operation, (dayByOp.get(r.operation) ?? 0) + 1);
      globalUsedToday++;
    }
    for (const r of (month.data ?? []) as Array<{ operation: string; cache_hit: boolean }>) {
      if (r.cache_hit) continue;
      monthByOp.set(r.operation, (monthByOp.get(r.operation) ?? 0) + 1);
    }

    const ops: BudgetOp[] = [
      "places_search", "place_details", "places_nearby_discover",
      "routes_matrix", "geocode", "place_photo",
    ];

    let monthlyCostUsd = 0;
    const byOp = ops.map((op) => {
      const usedToday = dayByOp.get(op) ?? 0;
      const dailyCap = capFor(op);
      const usedThisMonth = monthByOp.get(op) ?? 0;
      const tier = MONTHLY_FREE_TIER[op];
      const price = PRICE_PER_1000_USD[op];
      const billableThisMonth = Math.max(0, usedThisMonth - tier);
      const opCostUsd = Math.round((billableThisMonth / 1000) * price * 100) / 100;
      monthlyCostUsd += opCostUsd;
      return {
        op,
        usedToday,
        dailyCap,
        pctDaily: dailyCap > 0 ? Math.round((usedToday / dailyCap) * 100) : 0,
        usedThisMonth,
        monthlyFreeTier: tier,
        pctMonthlyFree: tier > 0 ? Math.round((usedThisMonth / tier) * 100) : 0,
        pricePer1000Usd: price,
        billableThisMonth,
        monthlyCostUsd: opCostUsd,
      };
    });

    return {
      byOp,
      globalUsedToday,
      globalDailyCap: GLOBAL_DAILY_CAP,
      monthlyCostUsd: Math.round(monthlyCostUsd * 100) / 100,
      monthlySoftCapUsd: MONTHLY_SOFT_CAP_USD,
    };
  } catch {
    return {
      byOp: [],
      globalUsedToday: 0,
      globalDailyCap: GLOBAL_DAILY_CAP,
      monthlyCostUsd: 0,
      monthlySoftCapUsd: MONTHLY_SOFT_CAP_USD,
    };
  }
}
