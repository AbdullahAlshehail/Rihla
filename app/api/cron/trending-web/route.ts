// GET /api/cron/trending-web
//
// Netlify-scheduled (weekly, declared in netlify.toml). Refreshes London's
// "🔥 ترند الآن" from credible curated web lists — the recall-reliable path for
// Western cities where the social-velocity Brave scan yields ~0 (Fable audit
// 2026-09-07). Method: fetch fixed list pages → Groq extracts venue names →
// Google Text Search confirms identity + photo + London box → APPEND-ONLY
// upsert of trending_* with the source article as evidence + fresh timestamp.
// The 14-day display window self-cleans old rows; we NEVER wipe on failure.
//
// Auth: Authorization: Bearer $CRON_SECRET (fail-closed). $0 within free tiers.

import { NextResponse } from "next/server";
import { adminSupabase, startRun, finishRun } from "@/lib/trending/scan";
import { curatedWebScan, TREND_SCORE } from "@/lib/trending/web/curatedScan";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CITY = { key: "london", label: "لندن" };

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: true, skipped: "service_role_not_configured" });
  }

  const admin = adminSupabase();
  const runId = await startRun(admin, CITY, "cron");
  const t0 = Date.now();

  let scan;
  try {
    scan = await curatedWebScan();
  } catch (e) {
    await finishRun(admin, runId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    throw e;
  }

  // ABORT-safe: thin/failed harvest → write NOTHING (append-only; 14-day window self-cleans).
  if (scan.venues.length === 0) {
    await finishRun(admin, runId, {
      status: "partial", candidates_count: scan.extracted, matches_count: 0,
      error: scan.warnings.join("; ") || "no_venues",
      duration_ms: Date.now() - t0,
    });
    return NextResponse.json({ ok: true, city: CITY.label, extracted: scan.extracted, written: 0, warnings: scan.warnings });
  }

  const nowIso = new Date().toISOString();
  const evidence = (url: string) => [{ url, source: "web", published_at: nowIso.slice(0, 10) }];
  let inserted = 0, updated = 0;

  for (const v of scan.venues) {
    const { data: ex } = await admin
      .from("places").select("id").eq("google_place_id", v.google_place_id).maybeSingle();
    if (ex) {
      // APPEND-ONLY refresh: touch ONLY trend fields, never name/category/photo.
      await admin.from("places").update({
        trending_score: TREND_SCORE, trending_source: "web",
        trending_evidence: evidence(v.evidence_url), trending_url: v.evidence_url,
        trending_updated_at: nowIso,
      }).eq("id", ex.id);
      updated++;
    } else {
      await admin.from("places").insert({
        google_place_id: v.google_place_id, external_source: "trend_discovery",
        name: v.name, category: "food", kind: "general", city: CITY.key, city_label: CITY.label,
        lat: v.lat, lng: v.lng, rating: v.rating, review_count: v.review_count,
        cost_currency: "GBP", cost_confidence: "low", photo_url: v.photo_url,
        trending_score: TREND_SCORE, trending_source: "web",
        trending_evidence: evidence(v.evidence_url), trending_url: v.evidence_url,
        trending_updated_at: nowIso, trending_first_seen_at: nowIso,
        is_editor_pick: false, seasonal: false, tags: ["src_google", "trend_web"],
      });
      inserted++;
    }
  }

  await finishRun(admin, runId, {
    status: scan.warnings.length ? "partial" : "ok",
    candidates_count: scan.extracted, matches_count: scan.venues.length,
    new_count: inserted, duration_ms: Date.now() - t0,
    error: scan.warnings.join("; ") || undefined,
  });

  return NextResponse.json({
    ok: true, city: CITY.label, extracted: scan.extracted,
    verified: scan.venues.length, inserted, updated, googleCalls: scan.googleCalls,
    warnings: scan.warnings,
  });
}
