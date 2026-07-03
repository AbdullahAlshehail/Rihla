// GET /api/admin/diagnose
// Hits each Google API with the cheapest possible request to detect which are
// enabled vs blocked. Used by the UI banner to tell the user exactly what to
// enable in Google Cloud Console.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";

type ApiStatus = { name: string; enabled: boolean; reason?: string; api_id: string };
type DiagnoseResult = { ok: boolean; hasKey: boolean; apis: ApiStatus[]; summary: string };

// Cache key is constant — the diagnosis reflects project-wide API enablement,
// not per-request state.
const CACHE_PARAMS = { v: 1 };

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json({
      ok: false,
      hasKey: false,
      apis: [],
      summary: "لا يوجد GOOGLE_MAPS_API_KEY في .env.local",
    });
  }

  // Serve a cached diagnosis if we have one. Each real diagnosis fires a Text
  // Search ($0.032) + a Geocode ($0.005) call, and AutoWarmup hits this route on
  // EVERY Explore mount — previously re-billing ~$0.037 per page load, unlogged.
  const cached = await getCached<DiagnoseResult>("diagnose", CACHE_PARAMS);
  if (cached) return NextResponse.json(cached);

  // Only check the two SKUs the app actually uses. Routes/Places-New are
  // intentionally disabled in Google Cloud for security (see project memory
  // `project_rihla_gcloud.md`) — testing them would falsely show the banner.
  const apis: ApiStatus[] = await Promise.all([
    testLegacy("Places API", "places-backend.googleapis.com", () =>
      fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=test&key=${key}`)
    ),
    testLegacy("Geocoding API", "geocoding-backend.googleapis.com", () =>
      fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=London&key=${key}`)
    ),
  ]);

  const allEnabled = apis.every((a) => a.enabled);
  const result: DiagnoseResult = {
    ok: allEnabled,
    hasKey: true,
    apis,
    summary: allEnabled
      ? "كل الـ APIs مفعّلة ✓"
      : `${apis.filter((a) => !a.enabled).map((a) => a.name).join(" + ")} مُعطّل في Google Cloud`,
  };

  // The two tests above hit real, billable Google endpoints — log them so the
  // budget guard + usage dashboard stop being blind to this route.
  void logApiUsage(user.id, "places_search", false); // textsearch probe
  void logApiUsage(user.id, "geocode", false);        // geocode probe

  // Cache so AutoWarmup's per-mount call doesn't re-bill. Once every API is
  // enabled (the steady state that was bleeding) the answer is stable → cache
  // 6h. While something is still blocked the user is actively enabling APIs and
  // refreshing, so cache only 60s to keep that loop responsive.
  await setCached("diagnose", CACHE_PARAMS, result, allEnabled ? 6 * 60 * 60 : 60);
  return NextResponse.json(result);
}

/** Legacy maps.googleapis.com APIs return 200 with `status` field; check both. */
async function testLegacy(
  name: string,
  api_id: string,
  call: () => Promise<Response>
): Promise<ApiStatus> {
  try {
    const r = await call();
    if (!r.ok) {
      return { name, enabled: false, reason: `HTTP ${r.status}`, api_id };
    }
    const data = await r.json().catch(() => ({}));
    const status = data?.status;
    // OK, ZERO_RESULTS, NOT_FOUND all mean the API is enabled
    if (status === "OK" || status === "ZERO_RESULTS" || status === "NOT_FOUND") {
      return { name, enabled: true, api_id };
    }
    if (status === "REQUEST_DENIED") {
      return { name, enabled: false, reason: data.error_message ?? "REQUEST_DENIED", api_id };
    }
    return { name, enabled: false, reason: status ?? "unknown", api_id };
  } catch (e) {
    return { name, enabled: false, reason: String(e), api_id };
  }
}
