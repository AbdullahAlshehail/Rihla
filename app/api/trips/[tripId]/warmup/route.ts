// POST /api/trips/[tripId]/warmup
// Bulk-enrich places in this trip's destination city in one shot.
// Caps per call to respect budget — re-run if more places remain.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enrichPlaceFromGoogle, needsEnrichment } from "@/lib/google/enrich";
import { summarizeReviews } from "@/lib/ai/groq";
import { regionFilterClauseFor } from "@/lib/utils";

// Small parallel batch → first results visible in ~3-4s instead of 15s.
// Still cheap: 6 × ~5 Google calls = 30 calls per batch.
const BATCH_MAX = 6;

export async function POST(_req: Request, ctx: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: trip } = await supabase
    .from("trips")
    .select("destination_city")
    .eq("id", tripId)
    .single();
  if (!trip) return NextResponse.json({ error: "trip not found" }, { status: 404 });

  // Fetch unenriched places for this trip's city
  let query = supabase
    .from("places")
    .select("id, name, google_place_id, photo_url, enriched_at, city, city_label")
    .not("google_place_id", "is", null)
    .limit(BATCH_MAX * 4);

  const regionClause = regionFilterClauseFor(trip.destination_city);
  if (regionClause) {
    query = query.or(regionClause);
  } else if (trip.destination_city) {
    query = query.or(
      `city.ilike.%${trip.destination_city.toLowerCase()}%,city_label.ilike.%${trip.destination_city}%`
    );
  }

  const { data: candidates } = await query;
  if (!candidates) return NextResponse.json({ enriched: 0 });

  const targets = candidates
    .filter((p) => needsEnrichment(p as { google_place_id: string | null; photo_url: string | null; enriched_at: string | null }))
    .slice(0, BATCH_MAX);

  const errors: string[] = [];

  // Parallel enrichment within the batch — each place is independent (own Google
  // calls + own DB writes). 6x speedup vs sequential, same total cost.
  const outcomes = await Promise.all(
    targets.map(async (p) => {
      if (!p.google_place_id) return { ok: false as const, name: p.name, reason: "no_id" };
      const pp = p as typeof p & { city_label?: string | null; city?: string | null };
      const result = await enrichPlaceFromGoogle(
        p.id,
        p.google_place_id,
        p.name,
        pp.city_label ?? pp.city ?? undefined,
      );
      if (!result.ok) return { ok: false as const, name: p.name, reason: result.reason };

      // Groq summary in parallel with the next place's enrichment
      let aiSummary = false;
      if (result.patch?.google_reviews && result.patch.google_reviews.length > 0) {
        const summary = await summarizeReviews(p.name, result.patch.google_reviews);
        if (summary) {
          await supabase.from("places").update({ ai_summary: summary }).eq("id", p.id);
          aiSummary = true;
        }
      }
      return { ok: true as const, name: p.name, aiSummary };
    })
  );

  let enrichedCount = 0;
  let aiSummaryCount = 0;
  for (const o of outcomes) {
    if (!o.ok) {
      errors.push(`${o.name}: ${o.reason}`);
    } else {
      enrichedCount++;
      if (o.aiSummary) aiSummaryCount++;
    }
  }

  return NextResponse.json({
    enriched: enrichedCount,
    ai_summaries: aiSummaryCount,
    total_candidates: targets.length,
    remaining: candidates.filter((p) => needsEnrichment(p as { google_place_id: string | null; photo_url: string | null; enriched_at: string | null })).length - enrichedCount,
    errors: errors.slice(0, 5),
  });
}
