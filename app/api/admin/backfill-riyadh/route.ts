// POST /api/admin/backfill-riyadh
// One-shot: for every Riyadh place with no google_place_id, do a Text Search
// to discover the canonical Google ID, store it back. Cost: 24 × $0.032 = $0.77.
// After this, the warmup flow can enrich photos/reviews like other cities.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchPlaces } from "@/lib/google/places";
import { isAdminEmail } from "@/lib/admin";

const MAX_PER_CALL = 8; // budget-friendly batches; re-run for the rest

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: places, error: readErr } = await supabase
    .from("places")
    .select("id, name, city_label, lat, lng")
    .is("google_place_id", null)
    .limit(MAX_PER_CALL);

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!places || places.length === 0) {
    return NextResponse.json({ done: true, message: "All places have google_place_id ✓" });
  }

  const results: Array<{ name: string; matched: boolean; place_id?: string; reason?: string }> = [];

  for (const p of places) {
    const query = `${p.name} ${p.city_label}`.trim();
    try {
      const { places: found, mock } = await searchPlaces({
        query,
        lat: p.lat ?? undefined,
        lng: p.lng ?? undefined,
        radius: 3000,
        userId: user.id,
      });
      if (mock || found.length === 0) {
        results.push({ name: p.name, matched: false, reason: mock ? "api_blocked" : "no_match" });
        continue;
      }
      const best = found[0];
      const { error: upErr } = await supabase
        .from("places")
        .update({ google_place_id: best.id })
        .eq("id", p.id);
      if (upErr) {
        results.push({ name: p.name, matched: false, reason: upErr.message });
      } else {
        results.push({ name: p.name, matched: true, place_id: best.id });
      }
    } catch (e) {
      results.push({ name: p.name, matched: false, reason: String(e).slice(0, 100) });
    }
  }

  const { count: remainingCount } = await supabase
    .from("places")
    .select("id", { count: "exact", head: true })
    .is("google_place_id", null);

  return NextResponse.json({
    processed: results.length,
    matched: results.filter((r) => r.matched).length,
    remaining: remainingCount ?? 0,
    results,
  });
}
