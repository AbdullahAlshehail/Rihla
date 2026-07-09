// POST /api/admin/trending-scan
// Body: { city_key?: string, city_label?: string, all_trip_cities?: boolean }
//
// Manual trigger from the map UI ("🔄 جلب الترند") or from the admin
// console. Scans ONE city per call (Netlify's 30s function ceiling caps us).
// When `all_trip_cities` is true, scans the city whose trending data is
// stalest among the caller's active trip cities — useful as a "scan next"
// loop from the UI.
//
// Auth: admin only. Trending is catalogue-level shared data populated
// automatically by the cross-user cron (app/api/cron/trending-scan); normal
// users READ the cached scores. On-demand scans (esp. force:true TTL bypass)
// spend Anthropic+Google money, so they are restricted to admins like the
// other /api/admin/* routes.

import { NextResponse } from "next/server";
import { createClient, createWriteClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { pickCandidates, scanCity, applyMatches, startRun, finishRun, type CategoryFocus } from "@/lib/trending/scan";

// Maps the user-facing focus to the schema category column(s). Brunch and
// breakfast pull from BOTH food + coffee — the venues often live under the
// coffee category in Google's taxonomy.
const FOCUS_TO_CATEGORY: Record<CategoryFocus, string[] | null> = {
  all: null,
  food: ["food"],
  brunch: ["food", "coffee"],
  breakfast: ["food", "coffee"],
  coffee: ["coffee"],
  sight: ["sight"],
  nature: ["nature"],
  sweet: ["sweet"],
  event: ["event"],
  bar: ["bar"],
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const cityKey = (body?.city_key as string | undefined)?.trim() || undefined;
  const cityLabel = (body?.city_label as string | undefined)?.trim() || undefined;
  const allTripCities = !!body?.all_trip_cities;
  const categoryFocus = (body?.category_focus as CategoryFocus | undefined) ?? "all";
  // `force: true` skips the TTL gate below and re-runs the paid scan even
  // if the city was scanned recently. Users trigger this via a dedicated
  // "🔄 حدّث الآن" button — a plain 🔥 tap uses the cache.
  const force = !!body?.force;

  if (!cityKey && !cityLabel && !allTripCities) {
    return NextResponse.json(
      { error: "must_supply_city_or_all_trip_cities" },
      { status: 400 },
    );
  }

  // Catalog writes (trending scores) need the service-role writer — repo RLS
  // grants authed users SELECT only on `places`.
  const admin = await createWriteClient();

  // Resolve target city
  let targetKey: string | undefined = cityKey;
  let targetLabel: string | undefined = cityLabel;

  if (allTripCities) {
    // Pick the user's trip cities; choose the stalest.
    const { data: trips } = await userClient
      .from("trips")
      .select("destination_city")
      .eq("user_id", user.id);

    const tripCityKeys = new Set<string>();
    for (const t of trips ?? []) {
      if (t.destination_city) tripCityKeys.add(t.destination_city.toLowerCase().trim());
    }

    if (tripCityKeys.size === 0) {
      return NextResponse.json({ error: "no_trip_cities" }, { status: 404 });
    }

    // Find the city with the oldest max(trending_updated_at), or one that
    // has never been scanned. Falls back to first trip city.
    const stalest = await pickStalestCity(admin, Array.from(tripCityKeys));
    if (stalest) {
      targetKey = stalest.cityKey;
      targetLabel = stalest.cityLabel;
    } else {
      targetKey = Array.from(tripCityKeys)[0];
    }
  }

  // Need at least a label to query — derive label from key if missing.
  if (!targetLabel && targetKey) {
    const { data } = await admin
      .from("places")
      .select("city_label")
      .eq("city", targetKey)
      .not("city_label", "is", null)
      .limit(1)
      .maybeSingle();
    targetLabel = data?.city_label ?? targetKey;
  }
  if (!targetKey && targetLabel) {
    const { data } = await admin
      .from("places")
      .select("city")
      .eq("city_label", targetLabel)
      .limit(1)
      .maybeSingle();
    targetKey = data?.city ?? targetLabel.toLowerCase();
  }

  if (!targetKey || !targetLabel) {
    return NextResponse.json({ error: "city_not_resolved" }, { status: 404 });
  }

  // ── TTL gate — 72 h server-side freshness cap ─────────────────────────
  // Prevents accidental double-charges when a user taps 🔥 twice within
  // hours. `force: true` overrides for explicit "refresh" actions.
  // Focused scans (coffee, food, ...) are ALLOWED to run even if a recent
  // "all" scan exists — otherwise a "قهاوي فقط" tap silently returns the
  // stale mixed-category cache and the user thinks nothing happened.
  const TTL_HOURS = 72;
  if (!force && categoryFocus === "all") {
    const { data: lastRow } = await admin
      .from("places")
      .select("trending_updated_at")
      .or(`city.eq.${targetKey},city_label.eq.${targetLabel}`)
      .not("trending_updated_at", "is", null)
      .order("trending_updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastAt = lastRow?.trending_updated_at ? new Date(lastRow.trending_updated_at) : null;
    if (lastAt) {
      const hoursAgo = (Date.now() - lastAt.getTime()) / 3_600_000;
      if (hoursAgo < TTL_HOURS) {
        return NextResponse.json({
          ok: true,
          cached: true,
          city: targetLabel,
          cityKey: targetKey,
          hoursAgo: Math.round(hoursAgo),
          lastAt: lastAt.toISOString(),
        });
      }
    }
  }

  // Exclude ONLY places scanned within the last 14 days. Older trending
  // rows are eligible to be re-picked — otherwise a place scanned once is
  // frozen forever and the list fossilizes. Append-only rule respected:
  // `applyMatches` overwrites, never deletes.
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: alreadyRows } = await admin
    .from("places")
    .select("id")
    .or(`city.eq.${targetKey},city_label.eq.${targetLabel}`)
    .gte("trending_updated_at", fourteenDaysAgo);
  // Focused scans skip the 14-day gate: an "all" run marks the good coffee
  // places trending, which starved a later "قهاوي" scan down to 0 candidates.
  // Safe: applyMatches overwrites (append-only), trend_sources upserts on
  // (place_id, source_url) — no duplicate rows.
  const excludeIds = categoryFocus === "all"
    ? new Set<string>((alreadyRows ?? []).map((r) => r.id))
    : new Set<string>();

  // Focused scans filter categories at the DB level (edits 5+6). "الكل"
  // passes categories: undefined so pickCandidates returns everything.
  const catFilter = FOCUS_TO_CATEGORY[categoryFocus];
  const candidates = await pickCandidates(admin, {
    city: targetKey,
    city_label: targetLabel,
  }, { excludeIds, categories: catFilter ?? undefined });

  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      city: targetLabel,
      empty: true,
      message: "no_candidates_in_city",
    });
  }

  const runId = await startRun(admin, { key: targetKey, label: targetLabel }, "manual", user.id);

  let result;
  try {
    result = await scanCity({
      cityKey: targetKey,
      cityLabel: targetLabel,
      candidates,
      categoryFocus,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishRun(admin, runId, {
      status: "failed",
      candidates_count: candidates.length,
      error: msg,
    });
    // Return JSON so the client toast shows the real reason (e.g.
    // `anthropic_key_missing`) instead of an opaque `http_500`.
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const apply = await applyMatches(admin, targetKey, targetLabel, result.matches, {
    scanRunId: runId ?? undefined,
  });

  await finishRun(admin, runId, {
    status: result.warnings.length ? "partial" : "ok",
    candidates_count: candidates.length,
    matches_count: result.matches.length,
    new_count: apply.written,
    verified_count: apply.verified,
    model: "claude-haiku-4-5-20251001",
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    searches: result.searches,
    cost_usd: Number(result.costUsd.toFixed(4)),
    duration_ms: result.durationMs,
    error: result.warnings.join("; ") || undefined,
  });

  return NextResponse.json({
    ok: true,
    city: targetLabel,
    cityKey: targetKey,
    runId,
    matches: result.matches.length,
    written: apply.written,
    verified: apply.verified,
    candidates: candidates.length,
    skippedExisting: excludeIds.size,   // already-trending places excluded
    searches: result.searches,
    durationMs: result.durationMs,
    costUsd: Number(result.costUsd.toFixed(4)),
    warnings: result.warnings,
  });
}

async function pickStalestCity(
  admin: Awaited<ReturnType<typeof createClient>>,
  cityKeys: string[],
): Promise<{ cityKey: string; cityLabel: string } | null> {
  if (cityKeys.length === 0) return null;
  // Reduce to per-city max(trending_updated_at) in JS, then pick the city
  // whose NEWEST scan is oldest. The old `order(nulls first).limit(50)`
  // returned an arbitrary city because every city has null-trending rows.
  const { data } = await admin
    .from("places")
    .select("city,city_label,trending_updated_at")
    .in("city", cityKeys);

  const byCity = new Map<string, { label: string; maxAt: number }>();
  for (const row of data ?? []) {
    if (!row.city) continue;
    const at = row.trending_updated_at ? Date.parse(row.trending_updated_at) : 0;
    const cur = byCity.get(row.city);
    if (!cur) {
      byCity.set(row.city, { label: row.city_label ?? row.city, maxAt: at });
    } else if (at > cur.maxAt) {
      cur.maxAt = at;
    }
  }
  let pick: { cityKey: string; cityLabel: string } | null = null;
  let oldest = Infinity;
  for (const [key, v] of byCity) {
    if (v.maxAt < oldest) { oldest = v.maxAt; pick = { cityKey: key, cityLabel: v.label }; }
  }
  return pick;
}
