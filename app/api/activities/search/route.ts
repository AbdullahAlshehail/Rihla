// GET /api/activities/search?type=bowling&city=riyadh&lat=...&lng=...
// Discovers fun activities via Google Places text search.
// Cached 7 days → ~1 call per activity-type per week.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchPlaces } from "@/lib/google/places";

// Activity type → Arabic + English search keywords + result category guess.
const ACTIVITY_TYPES: Record<string, { ar: string; emoji: string; query: string }> = {
  bowling: { ar: "بولينج", emoji: "🎳", query: "bowling" },
  trampoline: { ar: "ترامبولين", emoji: "🤸", query: "trampoline park" },
  escape_room: { ar: "غرف الهروب", emoji: "🔐", query: "escape room" },
  vr: { ar: "واقع افتراضي", emoji: "🥽", query: "VR arcade" },
  karting: { ar: "كارتينج", emoji: "🏎", query: "go karting" },
  zipline: { ar: "زيب لاين", emoji: "🪂", query: "zipline adventure" },
  cooking: { ar: "ورشة طبخ", emoji: "🍳", query: "cooking class" },
  art: { ar: "ورشة فن", emoji: "🎨", query: "art workshop pottery" },
  arcade: { ar: "ألعاب", emoji: "🎮", query: "arcade games entertainment" },
  hike: { ar: "مسارات", emoji: "🥾", query: "hiking trail" },
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "";
  const city = searchParams.get("city") ?? "";
  const lat = Number(searchParams.get("lat")) || undefined;
  const lng = Number(searchParams.get("lng")) || undefined;

  const cfg = ACTIVITY_TYPES[type];
  if (!cfg) {
    return NextResponse.json({ types: ACTIVITY_TYPES, error: "missing or unknown type" }, { status: 400 });
  }

  const query = `${cfg.query} ${city}`.trim();
  const { places, mock } = await searchPlaces({
    query,
    lat,
    lng,
    radius: 25000,
    userId: user.id,
  });

  return NextResponse.json({
    type,
    type_ar: cfg.ar,
    emoji: cfg.emoji,
    query,
    mock,
    results: places.map((p) => ({
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
    })),
  });
}

