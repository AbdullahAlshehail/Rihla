// POST /api/admin/trending-scan
// Body: { city_key?: string, city_label?: string, all_trip_cities?: boolean }
//
// Manual trigger from the map UI ("🔄 جلب الترند") or from the admin
// console. Scans ONE city per call (Netlify's 30s function ceiling caps us).
// When `all_trip_cities` is true, scans the city whose trending data is
// stalest among the caller's active trip cities — useful as a "scan next"
// loop from the UI.
//
// Auth: must be a signed-in user. (We don't gate by role yet — there's only
// one user in production.)

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { pickCandidates, scanCity, applyMatches, startRun, finishRun, type CategoryFocus } from "@/lib/trending/scan";

// Maps the user-facing focus to the schema category column (or null for "all")
const FOCUS_TO_CATEGORY: Record<CategoryFocus, string | null> = {
  all: null,
  food: "food", brunch: "food", breakfast: "food",
  coffee: "coffee",
  sight: "sight",
  nature: "nature",
  sweet: "sweet",
  event: "event",
  bar: "bar",
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const cityKey = (body?.city_key as string | undefined)?.trim() || undefined;
  const cityLabel = (body?.city_label as string | undefined)?.trim() || undefined;
  const allTripCities = !!body?.all_trip_cities;
  const categoryFocus = (body?.category_focus as CategoryFocus | undefined) ?? "all";

  if (!cityKey && !cityLabel && !allTripCities) {
    return NextResponse.json(
      { error: "must_supply_city_or_all_trip_cities" },
      { status: 400 },
    );
  }

  // RLS on `places` allows any authenticated user to update; no need for the
  // service-role client here. Cron uses service-role separately.
  const admin = userClient;

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

  const allCandidates = await pickCandidates(admin, {
    city: targetKey,
    city_label: targetLabel,
  });

  // Narrow candidates to the focus category. Brunch/breakfast share "food"
  // and let the prompt distinguish further.
  const catFilter = FOCUS_TO_CATEGORY[categoryFocus];
  const candidates = catFilter
    ? allCandidates.filter((c) => c.category === catFilter)
    : allCandidates;

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
    await finishRun(admin, runId, {
      status: "failed",
      candidates_count: candidates.length,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
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
  // For each city, get max(trending_updated_at). Cities with no rows come
  // back as null → those are "infinitely stale" and win the tiebreak.
  const { data } = await admin
    .from("places")
    .select("city,city_label,trending_updated_at")
    .in("city", cityKeys)
    .order("trending_updated_at", { ascending: true, nullsFirst: true })
    .limit(50);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (!row.city || seen.has(row.city)) continue;
    seen.add(row.city);
    return { cityKey: row.city, cityLabel: row.city_label ?? row.city };
  }
  return null;
}
