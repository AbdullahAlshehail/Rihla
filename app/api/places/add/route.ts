// POST /api/places/add
// Body: { google_place_id, city, city_label, sessiontoken? }
//
// Idempotent: if the place_id already exists in `places`, returns it.
// Otherwise: fetches Place Details (closing the autocomplete session for
// cheaper billing) → infers category from types → inserts row → fires
// enrichment (photos + Arabic reviews + AI summary).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlaceDetails } from "@/lib/google/places";
import { enrichPlaceFromGoogle } from "@/lib/google/enrich";
import { summarizeReviews } from "@/lib/ai/groq";
import type { Place } from "@/lib/supabase/database.types";

// Google types → our category enum
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

// Pick a "kind" sub-classification when obvious
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
  const googlePlaceId = body?.google_place_id as string | undefined;
  const cityKey = (body?.city as string | undefined) ?? "";
  const cityLabel = body?.city_label as string | undefined;

  if (!googlePlaceId) {
    return NextResponse.json({ error: "google_place_id required" }, { status: 400 });
  }

  // 1) Already in our catalog?
  const { data: existing } = await supabase
    .from("places")
    .select("*")
    .eq("google_place_id", googlePlaceId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ place: existing, created: false });
  }

  // 2) Fetch details from Google (Arabic + photos + reviews)
  const { place: gp, mock } = await getPlaceDetails(googlePlaceId, user.id);
  if (mock) return NextResponse.json({ error: "api_unavailable" }, { status: 503 });
  if (!gp) return NextResponse.json({ error: "place_not_found" }, { status: 404 });

  const types = gp._legacy?.reviews ? undefined : undefined; // not in details response
  // primaryType holds the first Google type from our converter
  const inferredTypes = [gp.primaryType].filter((t): t is string => !!t);
  const category = categoryFromTypes(inferredTypes);
  const kind = kindFromTypes(inferredTypes, category);

  const priceLevelNum = gp._legacy?.price_level_num ?? null;

  // 3) Insert minimal row first — enrichment will fill photos/reviews
  const insertRow = {
    google_place_id: googlePlaceId,
    external_source: "google",
    name: gp.displayName?.text ?? "بدون اسم",
    category,
    kind,
    city: cityKey.toLowerCase(),
    city_label: cityLabel ?? cityKey,
    lat: gp.location?.latitude ?? null,
    lng: gp.location?.longitude ?? null,
    address: gp.formattedAddress ?? null,
    phone: gp.internationalPhoneNumber ?? null,
    website: gp.websiteUri ?? null,
    rating: gp.rating ?? null,
    review_count: gp.userRatingCount ?? null,
    price_level: priceLevelNum,
    cost_currency: "EUR" as const,
    cost_confidence: "low" as const,
    google_maps_url: gp.googleMapsUri ?? null,
    is_editor_pick: false,
    // data_freshness defaults to now() in the DB — don't override
  };

  const { data: inserted, error: insErr } = await supabase
    .from("places")
    .insert(insertRow)
    .select()
    .single();
  if (insErr || !inserted) {
    console.warn("[places/add] insert failed:", insErr?.message);
    return NextResponse.json({ error: insErr?.message ?? "insert_failed" }, { status: 500 });
  }

  // 4) Run full enrichment (photos + Arabic reviews + opening hours)
  //    Don't block too long — fire it and return; user gets card immediately.
  const result = await enrichPlaceFromGoogle(
    inserted.id,
    googlePlaceId,
    insertRow.name,
    cityLabel,
  );

  // 5) AI summary if reviews came back
  if (result.ok && result.patch?.google_reviews && result.patch.google_reviews.length > 0) {
    const summary = await summarizeReviews(insertRow.name, result.patch.google_reviews);
    if (summary) {
      await supabase.from("places").update({ ai_summary: summary }).eq("id", inserted.id);
    }
  }

  // 6) Re-read so the returned row includes photos
  const { data: final } = await supabase
    .from("places")
    .select("*")
    .eq("id", inserted.id)
    .single();

  return NextResponse.json({ place: final ?? inserted, created: true });
}
