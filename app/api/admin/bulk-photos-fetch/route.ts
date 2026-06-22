// GET  /api/admin/bulk-photos-fetch  → preview: how many photos would we fetch
//                                       + how much it costs.
// POST /api/admin/bulk-photos-fetch  → execute: fetch up to `max` photos
//                                       matching filters, upload them to the
//                                       public `place-photos` Supabase bucket
//                                       and replace places.photo_url with the
//                                       permanent storage URL. Re-runs skip
//                                       any place that already has a non-proxy
//                                       photo_url, so it's idempotent.
//
// Cost: $0.007 per photo (Place Photo SKU). Hard-capped by the existing
// budgetGuard at 30/day and $1/month.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { checkBudget } from "@/lib/google/budgetGuard";
import { logApiUsage } from "@/lib/cache/apiCache";

const FilterSchema = z.object({
  // Tight regex prevents PostgREST `.or(...)` filter-bypass via commas/parens
  // (audit 2026-06-15). Allows arabic-safe city slugs too, e.g. "الرياض".
  city: z.string().regex(/^[\p{L}][\p{L}0-9_-]{0,39}$/u, "invalid city slug"),
  category: z.enum(["food", "coffee", "sweet", "bar", "sight", "nature", "event"]).nullable().optional(),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  min_reviews: z.coerce.number().int().min(0).optional(),
  // Cap at 20 per request to stay under Netlify's 26 s function timeout
  // (~1 s/photo: Google fetch + storage upload + DB update). Larger jobs
  // chunk client-side, like BulkPlacesPanel already does.
  max: z.coerce.number().int().min(1).max(20).default(10),
});

const PHOTO_PRICE_USD = 0.007;

/** Extract a Google photo_reference from our proxied URL pattern. */
function extractProxyRef(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return null; // already permanent → skip
  const m = /^\/api\/photo\?ref=([^&]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}

async function loadCandidates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  f: z.infer<typeof FilterSchema>,
): Promise<Array<{ id: string; google_place_id: string | null; photo_url: string | null; name: string }>> {
  // Pull a generous superset; we filter "has proxy ref" in JS so we never
  // re-fetch a place that already has a permanent storage URL.
  let q = supabase
    .from("places")
    .select("id, google_place_id, photo_url, name")
    .or(`city.eq.${f.city.toLowerCase()},city_label.eq.${f.city}`)
    .limit(800);
  if (f.category) q = q.eq("category", f.category);
  if (f.min_rating != null) q = q.gte("rating", f.min_rating);
  if (f.min_reviews != null) q = q.gte("review_count", f.min_reviews);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  // Only keep places that actually need work: have a proxy reference, no
  // permanent storage URL yet.
  return (data ?? []).filter((p) => extractProxyRef(p.photo_url) != null);
}

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const parsed = FilterSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const f = parsed.data;

  const candidates = await loadCandidates(supabase, f);
  const planned = Math.min(candidates.length, f.max);
  return NextResponse.json({
    filters: f,
    eligible_count: candidates.length,
    planned_count: planned,
    estimated_cost_usd: Math.round(planned * PHOTO_PRICE_USD * 10000) / 10000,
    estimated_cost_label: `~ $${(planned * PHOTO_PRICE_USD).toFixed(2)} لـ ${planned} صورة`,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = FilterSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const f = parsed.data;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 500 });

  const candidates = await loadCandidates(supabase, f);
  const targets = candidates.slice(0, f.max);

  let fetched = 0, uploaded = 0, skipped = 0, errors = 0;
  const errorSamples: string[] = [];

  for (const place of targets) {
    // One last budget check between rows so we honor the 30/day cap mid-batch
    const budget = await checkBudget("place_photo");
    if (!budget.allowed) {
      errorSamples.push(`budget_blocked: ${budget.reason ?? "limit reached"}`);
      break;
    }

    const ref = extractProxyRef(place.photo_url);
    if (!ref) { skipped++; continue; }

    try {
      const googleUrl = new URL("https://maps.googleapis.com/maps/api/place/photo");
      googleUrl.searchParams.set("maxwidth", "1024");
      googleUrl.searchParams.set("photo_reference", ref);
      googleUrl.searchParams.set("key", key);
      const r = await fetch(googleUrl.toString(), { redirect: "follow" });
      await logApiUsage(user.id, "place_photo", false);
      if (!r.ok) {
        errors++;
        if (errorSamples.length < 3) errorSamples.push(`google_${r.status}_${place.name}`);
        continue;
      }
      fetched++;

      const bytes = await r.arrayBuffer();
      if (bytes.byteLength < 200) { errors++; continue; }
      const mime = r.headers.get("content-type") ?? "image/jpeg";
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const path = `${place.id}.${ext}`;

      const { error: upErr } = await supabase.storage.from("place-photos").upload(
        path,
        new Uint8Array(bytes),
        { contentType: mime, upsert: true, cacheControl: "31536000" },
      );
      if (upErr) {
        errors++;
        if (errorSamples.length < 3) errorSamples.push(`upload_${place.name}: ${upErr.message}`);
        continue;
      }

      const { data: pub } = supabase.storage.from("place-photos").getPublicUrl(path);
      const newUrl = pub.publicUrl;
      if (!newUrl) { errors++; continue; }

      const { error: dbErr } = await supabase
        .from("places")
        .update({ photo_url: newUrl })
        .eq("id", place.id);
      if (dbErr) {
        errors++;
        if (errorSamples.length < 3) errorSamples.push(`db_${place.name}: ${dbErr.message}`);
        continue;
      }
      uploaded++;
    } catch (e: unknown) {
      errors++;
      if (errorSamples.length < 3) {
        errorSamples.push(`exception_${place.name}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }

  const actualCostUsd = Math.round(fetched * PHOTO_PRICE_USD * 10000) / 10000;
  return NextResponse.json({
    filters: f,
    targeted: targets.length,
    fetched,
    uploaded,
    skipped,
    errors,
    actual_cost_usd: actualCostUsd,
    error_samples: errorSamples,
  });
}
