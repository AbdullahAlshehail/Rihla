// GET /api/activities/discover?lat=&lng=&city=
// Bulk-discover entertainment near a hotel/city in ONE Google call.
// Returns groups keyed by Google primaryType, each with sorted top places.
// Cached 30 days.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverEntertainment, TYPE_LABELS_AR } from "@/lib/google/nearby";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const city = searchParams.get("city") ?? undefined;
  const radius = Number(searchParams.get("radius") || 15000);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "lat and lng are required (decimal degrees)" },
      { status: 400 }
    );
  }

  const result = await discoverEntertainment({
    lat,
    lng,
    radius,
    userId: user.id,
    cityKey: city,
  });

  // Build the response with friendly labels
  const groups = Object.entries(result.groups).map(([type, places]) => ({
    type,
    label_ar: TYPE_LABELS_AR[type]?.ar ?? type,
    emoji: TYPE_LABELS_AR[type]?.emoji ?? "📍",
    count: places.length,
    places: places.slice(0, 12).map((p) => ({
      google_place_id: p.id,
      name: p.displayName?.text,
      address: p.formattedAddress,
      lat: p.location?.latitude,
      lng: p.location?.longitude,
      rating: p.rating,
      review_count: p.userRatingCount,
      price_level: p.priceLevel,
      open_now: p.currentOpeningHours?.openNow,
      google_maps_url: p.googleMapsUri,
      photo_name: p.photos?.[0]?.name,
    })),
  })).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    mock: result.mock,
    cached: result.cached ?? false,
    total: result.count,
    groups,
  });
}
