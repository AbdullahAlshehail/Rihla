// POST /api/places/from-url
// Body: { url: string, trip_id?: string, save?: boolean }
//
// Resolves a pasted Google Maps URL to a Place row.
//   1. Follows redirect if it's a short link (maps.app.goo.gl).
//   2. Parses out name + coords + ftid + place_id from the canonical URL.
//   3. Skips Google API entirely if we already have the place (by ftid or
//      within 60 m of the coords) — instant + free.
//   4. Otherwise: Find-Place-from-Text (name biased to coords) → place_id
//      → existing /places/add pipeline (details + enrichment + photos).
//
// Returns:
//   { place: Place, source: "cache" | "ftid_match" | "near_coords" | "google",
//     saved?: boolean }
//
// When `save: true`, the place is also added to the user's saved set
// (user_saved_places — user-scoped, shared across trips) so the map
// carousel reflects it immediately. `trip_id` is accepted for symmetry but
// currently unused beyond logging context.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  parseMapsUrl,
  resolveShortUrl,
  type ParsedMapsUrl,
} from "@/lib/google/parseMapsUrl";
import { getPlaceDetails, findPlaceByText } from "@/lib/google/places";
import { enrichPlaceFromGoogle } from "@/lib/google/enrich";
import { summarizeReviews } from "@/lib/ai/groq";
import type { Place } from "@/lib/supabase/database.types";
import { haversineKm } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

function categoryFromTypes(types?: string[]): Place["category"] {
  if (!types || types.length === 0) return "sight";
  const has = (t: string) => types.includes(t);
  if (has("cafe") || has("coffee_shop")) return "coffee";
  if (has("bakery") || has("ice_cream_shop") || has("dessert_shop") || has("dessert_restaurant")) return "sweet";
  if (has("bar") || has("night_club") || has("liquor_store")) return "bar";
  if (has("restaurant") || has("meal_takeaway") || has("meal_delivery") || has("food")) return "food";
  if (has("park") || has("garden") || has("national_park") || has("hiking_area") || has("beach")) return "nature";
  if (has("amusement_park") || has("amusement_center") || has("event_venue") || has("performing_arts_theater") || has("concert_hall") || has("stadium")) return "event";
  return "sight";
}

function kindFromTypes(types?: string[], category?: Place["category"]): string | null {
  if (!types) return null;
  if (category === "food") {
    if (types.includes("italian_restaurant")) return "italian";
    if (types.includes("seafood_restaurant")) return "seafood";
    if (types.includes("fast_food_restaurant")) return "fast";
    if (types.includes("fine_dining_restaurant")) return "fine_dining";
  }
  if (category === "sight") {
    if (types.includes("museum")) return "museum";
    if (types.includes("historical_landmark")) return "landmark";
    if (types.includes("market")) return "market";
  }
  if (category === "nature") {
    if (types.includes("beach")) return "beach";
    if (types.includes("garden")) return "garden";
  }
  return null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const rawUrl = (body?.url as string | undefined)?.trim();
  void (body?.trip_id); // accepted but currently unused
  const shouldSave = !!body?.save;

  if (!rawUrl) return NextResponse.json({ error: "url_required" }, { status: 400 });
  if (rawUrl.length > 2000) return NextResponse.json({ error: "url_too_long" }, { status: 400 });

  // Light guard: must be a maps-ish URL so we don't fan out to random hosts.
  if (!/^https?:\/\/(maps\.google\.com|www\.google\.com|maps\.app\.goo\.gl|goo\.gl|g\.co)/i.test(rawUrl)) {
    return NextResponse.json({ error: "not_google_maps_url" }, { status: 400 });
  }

  const startedAt = Date.now();

  // 1) Resolve short link → canonical URL (no-op for already-canonical URLs)
  const canonical = await resolveShortUrl(rawUrl);

  // 2) Parse signals
  const parsed: ParsedMapsUrl = parseMapsUrl(canonical);
  if (!parsed.name && !parsed.lat && !parsed.placeId && !parsed.ftid) {
    return NextResponse.json({
      error: "could_not_parse_url",
      canonical: canonical !== rawUrl ? canonical : undefined,
    }, { status: 422 });
  }

  // 3) Try to short-circuit on cache: existing row by ftid or near coords
  if (parsed.ftid) {
    const { data: byFtid } = await supabase
      .from("places")
      .select("*")
      .ilike("google_maps_url", `%${parsed.ftid}%`)
      .limit(1)
      .maybeSingle();
    if (byFtid) {
      const saved = shouldSave ? await saveForUser(supabase, byFtid.id, user.id) : false;
      return NextResponse.json({
        place: byFtid, source: "ftid_match", saved,
        meta: { ms: Date.now() - startedAt, canonical },
      });
    }
  }

  if (parsed.lat != null && parsed.lng != null) {
    // Tight bounding box ≈ 60 m. Cheaper than computing haversine in SQL and
    // good enough — we follow up with a haversine check on the few rows we
    // get back so we never confuse two places on the same block.
    const dLat = 0.0006;
    const dLng = 0.0006 / Math.max(0.1, Math.cos(parsed.lat * Math.PI / 180));
    const { data: nearby } = await supabase
      .from("places")
      .select("*")
      .gte("lat", parsed.lat - dLat)
      .lte("lat", parsed.lat + dLat)
      .gte("lng", parsed.lng - dLng)
      .lte("lng", parsed.lng + dLng)
      .limit(8);
    const hit = (nearby ?? []).find((p) =>
      p.lat != null && p.lng != null
      && haversineKm({ lat: parsed.lat!, lng: parsed.lng! }, { lat: p.lat, lng: p.lng }) < 0.06
    );
    if (hit) {
      const saved = shouldSave ? await saveForUser(supabase, hit.id, user.id) : false;
      return NextResponse.json({
        place: hit, source: "near_coords", saved,
        meta: { ms: Date.now() - startedAt, canonical },
      });
    }
  }

  // 4) Need Google. Get a place_id if we don't have one yet.
  let placeId: string | null = parsed.placeId ?? null;
  if (!placeId) {
    const findInput = parsed.name ?? (parsed.lat != null ? `${parsed.lat},${parsed.lng}` : "");
    if (!findInput) {
      return NextResponse.json({ error: "insufficient_signals" }, { status: 422 });
    }
    const finder = await findPlaceByText({
      input: findInput,
      lat: parsed.lat,
      lng: parsed.lng,
      userId: user.id,
    });
    if (finder.mock) return NextResponse.json({ error: "api_unavailable" }, { status: 503 });
    if (!finder.placeId) return NextResponse.json({ error: "place_not_found" }, { status: 404 });
    placeId = finder.placeId;
  }

  // 5) Already in our catalogue by place_id?
  {
    const { data: existing } = await supabase
      .from("places")
      .select("*")
      .eq("google_place_id", placeId)
      .maybeSingle();
    if (existing) {
      const saved = shouldSave ? await saveForUser(supabase, existing.id, user.id) : false;
      return NextResponse.json({
        place: existing, source: "cache", saved,
        meta: { ms: Date.now() - startedAt, canonical },
      });
    }
  }

  // 6) Fresh from Google — same path as /places/add
  const { place: gp, mock } = await getPlaceDetails(placeId, user.id);
  if (mock) return NextResponse.json({ error: "api_unavailable" }, { status: 503 });
  if (!gp) return NextResponse.json({ error: "place_not_found" }, { status: 404 });

  const inferredTypes = [gp.primaryType].filter((t): t is string => !!t);
  const category = categoryFromTypes(inferredTypes);
  const kind = kindFromTypes(inferredTypes, category);
  const priceLevelNum = gp._legacy?.price_level_num ?? null;

  const insertRow = {
    google_place_id: placeId,
    external_source: "google" as const,
    name: gp.displayName?.text ?? parsed.name ?? "بدون اسم",
    category,
    kind,
    city: "",
    city_label: null,
    lat: gp.location?.latitude ?? parsed.lat ?? null,
    lng: gp.location?.longitude ?? parsed.lng ?? null,
    address: gp.formattedAddress ?? null,
    phone: gp.internationalPhoneNumber ?? null,
    website: gp.websiteUri ?? null,
    rating: gp.rating ?? null,
    review_count: gp.userRatingCount ?? null,
    price_level: priceLevelNum,
    cost_currency: "EUR" as const,
    cost_confidence: "low" as const,
    google_maps_url: gp.googleMapsUri ?? canonical,
    is_editor_pick: false,
  };

  const { data: inserted, error: insErr } = await supabase
    .from("places")
    .insert(insertRow)
    .select()
    .single();
  if (insErr || !inserted) {
    console.warn("[from-url] insert failed:", insErr?.message);
    return NextResponse.json({ error: insErr?.message ?? "insert_failed" }, { status: 500 });
  }

  // 7) Enrichment (photo + Arabic reviews + summary). We do this in-line so
  //    the preview the user sees on the next render already has a photo.
  const enrichResult = await enrichPlaceFromGoogle(
    inserted.id, placeId, insertRow.name, undefined,
  );
  if (enrichResult.ok && enrichResult.patch?.google_reviews?.length) {
    const summary = await summarizeReviews(insertRow.name, enrichResult.patch.google_reviews);
    if (summary) await supabase.from("places").update({ ai_summary: summary }).eq("id", inserted.id);
  }

  const { data: finalRow } = await supabase
    .from("places").select("*").eq("id", inserted.id).single();
  const out = finalRow ?? inserted;

  const saved = shouldSave ? await saveForUser(supabase, out.id, user.id) : false;
  return NextResponse.json({
    place: out, source: "google", saved,
    meta: { ms: Date.now() - startedAt, canonical },
  });
}

// Helper: add the place to the user's saved set (idempotent — upsert).
// `user_saved_places` is user-scoped (shared across trips) per current schema.
async function saveForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  placeId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("user_saved_places")
    .upsert({ user_id: userId, place_id: placeId });
  return !error;
}
