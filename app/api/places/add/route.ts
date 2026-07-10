// POST /api/places/add
// Body: { google_place_id, city, city_label, sessiontoken? }
//
// Idempotent: if the place_id already exists in `places`, returns it.
// Otherwise: fetches Place Details (closing the autocomplete session for
// cheaper billing) → infers category from types → inserts row → fires
// enrichment (photos + Arabic reviews + AI summary).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createWriteClient } from "@/lib/supabase/server";
import { getPlaceDetails } from "@/lib/google/places";
import { enrichPlaceFromGoogle } from "@/lib/google/enrich";
import { summarizeReviews } from "@/lib/ai/groq";
// Shared with the trending discovery pipeline (lib/trending/discover.ts).
import { categoryFromTypes, kindFromTypes } from "@/lib/google/placeCategory";

const Body = z.object({
  google_place_id: z.string().min(1).max(200),
  city: z.string().max(80).optional(),
  city_label: z.string().max(80).optional(),
  sessiontoken: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const googlePlaceId = parsed.data.google_place_id;
  const cityKey = parsed.data.city ?? "";
  const cityLabel = parsed.data.city_label;

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

  // Use service-role for the catalog write — repo RLS grants only SELECT on
  // `places` to authed users. Any relaxed policy in prod is schema-drift; the
  // writer client is correct either way.
  const writer = await createWriteClient();
  const { data: inserted, error: insErr } = await writer
    .from("places")
    .insert(insertRow)
    .select()
    .single();
  if (insErr?.code === "23505") {
    // google_place_id unique — a concurrent double-tap raced our existence
    // check. Return the winning row instead of a 500.
    const { data: dup } = await writer.from("places").select("*")
      .eq("google_place_id", googlePlaceId).single();
    if (dup) return NextResponse.json({ place: dup, created: false });
  }
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
      await writer.from("places").update({ ai_summary: summary }).eq("id", inserted.id);
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
