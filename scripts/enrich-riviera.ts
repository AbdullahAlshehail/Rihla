// One-shot enrichment for the Côte d'Azur catalogue.
// Run: `npx tsx scripts/enrich-riviera.ts`
//
// Pulls Place Details (Arabic) + up to 3 photo URLs for every Riviera
// place lacking enrichment. Writes back via Supabase using the anon key +
// authenticated user (RLS policy `places_update_authed`). For admin
// scripts we instead authenticate with the SERVICE_ROLE_KEY when present.

import "dotenv/config";
import { createClient as createSb } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;

if (!GOOGLE_KEY) {
  console.error("GOOGLE_MAPS_API_KEY required in .env.local");
  process.exit(1);
}

// Service role bypasses RLS — use it when the placeholder is replaced.
const hasRealServiceKey =
  SERVICE_KEY && !SERVICE_KEY.startsWith("PASTE_") && SERVICE_KEY.length > 100;
if (!hasRealServiceKey) {
  console.error(
    "ERROR: SUPABASE_SERVICE_ROLE_KEY is missing or still the placeholder.\n" +
    "       This script needs service-role to bypass RLS for bulk admin updates.\n" +
    "       Paste the service key into .env.local then re-run."
  );
  void ANON_KEY; // keep the import referenced
  process.exit(1);
}

const sb = createSb(SUPABASE_URL, SERVICE_KEY!, { auth: { persistSession: false } });

const RIVIERA_CITIES = [
  "nice", "cannes", "monaco", "antibes", "eze",
  "villefranche", "menton", "capferrat", "capdail", "stpaul",
];

const DETAILS_FIELDS = [
  "place_id", "name", "formatted_address", "geometry", "rating",
  "user_ratings_total", "price_level", "opening_hours", "current_opening_hours",
  "international_phone_number", "website", "url", "photos", "types", "reviews",
  "editorial_summary",
].join(",");

type LegacyPlace = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  international_phone_number?: string;
  website?: string;
  url?: string;
  types?: string[];
  photos?: Array<{ photo_reference: string; height?: number; width?: number }>;
  opening_hours?: {
    periods?: Array<{ open?: { day: number; time: string }; close?: { day: number; time: string } }>;
  };
  reviews?: Array<{
    author_name?: string;
    language?: string;
    rating?: number;
    relative_time_description?: string;
    text?: string;
  }>;
};

async function fetchDetails(googlePlaceId: string): Promise<LegacyPlace | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", googlePlaceId);
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("language", "ar");
  url.searchParams.set("fields", DETAILS_FIELDS);
  const r = await fetch(url.toString());
  if (!r.ok) {
    console.warn(`  ⚠ HTTP ${r.status}`);
    return null;
  }
  const data = await r.json();
  if (data.status !== "OK") {
    console.warn(`  ⚠ ${data.status}${data.error_message ? `: ${data.error_message}` : ""}`);
    return null;
  }
  return data.result as LegacyPlace;
}

async function resolvePhotoUrl(photoRef: string, maxHeight = 720): Promise<string | null> {
  const url = `https://maps.googleapis.com/maps/api/place/photo?photoreference=${photoRef}&maxheight=${maxHeight}&key=${GOOGLE_KEY}`;
  try {
    const resp = await fetch(url, { redirect: "manual" });
    if (resp.status >= 300 && resp.status < 400) {
      return resp.headers.get("location");
    }
    if (resp.ok && resp.url && resp.url !== url) return resp.url;
    return null;
  } catch {
    return null;
  }
}

function legacyTimeToAmPm(t: string): string {
  const hh = parseInt(t.slice(0, 2), 10);
  const mm = t.slice(2, 4);
  const ap = hh < 12 || hh === 24 ? "AM" : "PM";
  const h12 = hh % 12 || 12;
  return `${h12}:${mm} ${ap}`;
}

function periodsToWeek(
  periods: NonNullable<NonNullable<LegacyPlace["opening_hours"]>["periods"]>,
): string[] | null {
  const out: string[] = ["", "", "", "", "", "", ""];
  for (const p of periods) {
    if (!p.open) continue;
    const day = p.open.day;
    const openT = legacyTimeToAmPm(p.open.time);
    const closeT = p.close ? legacyTimeToAmPm(p.close.time) : "11:59 PM";
    const slot = `${openT} - ${closeT}`;
    out[day] = out[day] ? `${out[day]}, ${slot}` : slot;
  }
  if (out.every((s) => s === "")) return null;
  return out;
}

async function main() {
  console.log("🔎 Looking up Riviera places needing enrichment...");
  const { data: places, error } = await sb
    .from("places")
    .select("id, name, city, google_place_id, photo_url, enriched_at")
    .in("city", RIVIERA_CITIES)
    .order("city");
  if (error) {
    console.error(error);
    process.exit(1);
  }

  const candidates = (places ?? []).filter(
    (p) => p.google_place_id && (!p.photo_url || !p.enriched_at),
  );
  console.log(`Found ${candidates.length} candidates of ${places?.length ?? 0} total Riviera places.\n`);

  let done = 0, failed = 0, photos = 0;
  const startedAt = Date.now();

  // Run in concurrent batches of 4 to be gentle on rate limits.
  const BATCH = 4;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (p) => {
        process.stdout.write(`[${i + 1 + batch.indexOf(p)}/${candidates.length}] ${p.city} · ${p.name}: `);
        const details = await fetchDetails(p.google_place_id!);
        if (!details) {
          failed++;
          process.stdout.write("FAILED\n");
          return;
        }

        // Resolve up to 3 photo URLs in parallel
        const refs = (details.photos ?? []).slice(0, 3).map((ph) => ph.photo_reference).filter(Boolean);
        const photoUrls = (await Promise.all(refs.map((r) => resolvePhotoUrl(r)))).filter(
          (u): u is string => !!u,
        );
        photos += photoUrls.length;

        // Arabic reviews first, then others
        const allReviews = details.reviews ?? [];
        const seen = new Set<string>();
        const mapped = allReviews.map((r) => ({
          author_name: r.author_name,
          rating: r.rating,
          text: r.text ?? "",
          relative_time: r.relative_time_description,
          language: r.language,
        }));
        const arFirst = mapped.filter((r) => r.language === "ar" && r.text.length > 10 && !seen.has(r.text) && (seen.add(r.text), true));
        const rest = mapped.filter((r) => r.language !== "ar" && r.text.length > 10 && !seen.has(r.text) && (seen.add(r.text), true));
        const reviews = [...arFirst, ...rest].slice(0, 6);

        const opening_hours = details.opening_hours?.periods
          ? periodsToWeek(details.opening_hours.periods)
          : null;

        const patch: Record<string, unknown> = {
          enriched_at: new Date().toISOString(),
          rating: typeof details.rating === "number" ? details.rating : null,
          review_count: typeof details.user_ratings_total === "number" ? details.user_ratings_total : null,
          price_level: typeof details.price_level === "number" ? details.price_level : null,
          phone: details.international_phone_number ?? null,
          website: details.website ?? null,
          google_maps_url: details.url ?? null,
          address: details.formatted_address ?? null,
        };
        if (photoUrls.length > 0) {
          patch.photo_url = photoUrls[0];
          patch.photo_urls = photoUrls;
        }
        if (reviews.length > 0) patch.google_reviews = reviews;
        if (opening_hours) patch.opening_hours = opening_hours;

        // Strip nulls (don't overwrite curated fields if Google returns nothing)
        for (const k of Object.keys(patch)) {
          const v = patch[k];
          if (v === null || (Array.isArray(v) && v.length === 0)) delete patch[k];
        }

        const { error: updErr } = await sb.from("places").update(patch).eq("id", p.id);
        if (updErr) {
          failed++;
          process.stdout.write(`DB FAIL: ${updErr.message}\n`);
          return;
        }
        done++;
        process.stdout.write(`✓ ${photoUrls.length} photos · ★${details.rating ?? "?"}\n`);
      }),
    );
    // brief pause between batches
    await new Promise((r) => setTimeout(r, 250));
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${seconds}s · ${done} enriched · ${failed} failed · ${photos} photo URLs resolved`);
  console.log(`Est. cost: $${((done * 0.017) + (photos * 0.007)).toFixed(2)} (well within monthly free tier)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
