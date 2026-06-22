// GET /api/cron/trending-scan
//
// Netlify-scheduled function (declared in netlify.toml). Picks the SINGLE
// stalest city across all users' active trips and scans it. We process one
// city per invocation to stay safely under the 30s function ceiling.
//
// "Active trip city" = any trip whose start_date is within the next 30 days
// OR whose end_date is still in the future. Trip cities are scanned every
// 24h; non-trip catalogue cities are scanned every 3 days as a fallback.
//
// Auth: requires Authorization: Bearer $CRON_SECRET. Netlify injects this
// from the function's environment when scheduled.

import { NextResponse } from "next/server";
import { adminSupabase, pickCandidates, scanCity, applyMatches } from "@/lib/trending/scan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const TRIP_CITY_TTL_HOURS = 24;
const CATALOGUE_CITY_TTL_HOURS = 72;

export async function GET(req: Request) {
  // Cron secret check
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Cron needs cross-user access → service role required. If the key isn't
  // configured yet (early setup phase), no-op rather than 500 the scheduler.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, skipped: "service_role_not_configured" });
  }
  const admin = adminSupabase();

  // 1) Find active-trip cities (next 30 days, or currently happening)
  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: activeTrips } = await admin
    .from("trips")
    .select("destination_city,start_date,end_date")
    .or(`start_date.lte.${horizon},end_date.gte.${now.toISOString()}`);

  const tripCityKeys = new Set<string>();
  for (const t of activeTrips ?? []) {
    if (t.destination_city) tripCityKeys.add(t.destination_city.toLowerCase().trim());
  }

  // 2) Pick the stalest eligible city — trip cities first (24h TTL),
  //    catalogue fallback (72h TTL).
  const target = await pickNextCity(admin, tripCityKeys);
  if (!target) {
    return NextResponse.json({ ok: true, skipped: "all_cities_fresh" });
  }

  const candidates = await pickCandidates(admin, {
    city: target.cityKey,
    city_label: target.cityLabel,
  });
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no_candidates", city: target.cityLabel });
  }

  const result = await scanCity({
    cityKey: target.cityKey,
    cityLabel: target.cityLabel,
    candidates,
  });
  const apply = await applyMatches(admin, target.cityKey, target.cityLabel, result.matches);

  return NextResponse.json({
    ok: true,
    city: target.cityLabel,
    cityKey: target.cityKey,
    isTrip: tripCityKeys.has(target.cityKey),
    matches: result.matches.length,
    written: apply.written,
    cleared: apply.cleared,
    searches: result.searches,
    durationMs: result.durationMs,
    costUsd: Number(result.costUsd.toFixed(4)),
  });
}

// Picks the next city to scan, applying TTL by city class (trip / catalogue).
// Returns the single highest-priority stale city, or null if everything's fresh.
async function pickNextCity(
  admin: ReturnType<typeof adminSupabase>,
  tripCityKeys: Set<string>,
): Promise<{ cityKey: string; cityLabel: string } | null> {
  // Pull every (city, last_scan) pair we have.
  const { data: rows } = await admin
    .from("places")
    .select("city,city_label,trending_updated_at")
    .not("city", "is", null);

  // Reduce to per-city max(updated_at).
  const stats = new Map<string, { label: string; lastScan: number | null }>();
  for (const r of rows ?? []) {
    const key = r.city as string;
    if (!key) continue;
    const ts = r.trending_updated_at ? new Date(r.trending_updated_at).getTime() : null;
    const cur = stats.get(key);
    if (!cur) {
      stats.set(key, { label: r.city_label ?? key, lastScan: ts });
    } else if (ts && (cur.lastScan == null || ts > cur.lastScan)) {
      cur.lastScan = ts;
    }
  }

  const now = Date.now();
  const tripThreshold = now - TRIP_CITY_TTL_HOURS * 3600_000;
  const catalogueThreshold = now - CATALOGUE_CITY_TTL_HOURS * 3600_000;

  let bestTrip: { key: string; label: string; lastScan: number | null } | null = null;
  let bestCatalogue: { key: string; label: string; lastScan: number | null } | null = null;

  for (const [key, val] of stats) {
    const isTrip = tripCityKeys.has(key);
    const threshold = isTrip ? tripThreshold : catalogueThreshold;
    const isStale = val.lastScan == null || val.lastScan < threshold;
    if (!isStale) continue;
    const bucket = isTrip ? "trip" : "catalogue";
    const entry = { key, label: val.label, lastScan: val.lastScan };
    if (bucket === "trip") {
      if (!bestTrip || (entry.lastScan ?? -Infinity) < (bestTrip.lastScan ?? -Infinity)) {
        bestTrip = entry;
      }
    } else {
      if (!bestCatalogue || (entry.lastScan ?? -Infinity) < (bestCatalogue.lastScan ?? -Infinity)) {
        bestCatalogue = entry;
      }
    }
  }

  const winner = bestTrip ?? bestCatalogue;
  return winner ? { cityKey: winner.key, cityLabel: winner.label } : null;
}
