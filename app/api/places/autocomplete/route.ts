// GET /api/places/autocomplete?q=&lat=&lng=&radius=&country=&strict=
//
// Despite the name, this now uses Place Text Search — same UX (type → see
// suggestions) but each suggestion carries rating, review count, open_now,
// and a photo thumbnail in a single API call. Costs slightly more per call
// ($0.032 vs $0.003 for session-token autocomplete) but eliminates the need
// for a follow-up Details call per pick.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkBudget } from "@/lib/google/budgetGuard";
import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";

type Prediction = {
  place_id: string;
  main_text: string;
  secondary_text: string;
  types: string[];
  rating?: number;
  review_count?: number;
  open_now?: boolean;
  price_level?: number;
  photo_reference?: string;
  icon?: string; // free static icon URL from Google (no API call)
  icon_bg?: string;
};

type LegacyTextSearchResult = {
  place_id: string;
  name?: string;
  formatted_address?: string;
  vicinity?: string;
  geometry?: { location: { lat: number; lng: number } };
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  opening_hours?: { open_now?: boolean };
  photos?: Array<{ photo_reference: string }>;
  icon?: string;
  icon_background_color?: string;
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const country = (searchParams.get("country") ?? "").toLowerCase().slice(0, 2);
  const radiusKm = Number(searchParams.get("radius"));
  const strict = searchParams.get("strict") === "1";

  if (q.length < 2) return NextResponse.json({ predictions: [] });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ predictions: [], mock: true });

  // Cache key includes location scope — same query in different city = different results
  const cacheParams = { q, lat: Number.isFinite(lat) ? Math.round(lat * 100) / 100 : null,
    lng: Number.isFinite(lng) ? Math.round(lng * 100) / 100 : null,
    country, radiusKm: Number.isFinite(radiusKm) ? radiusKm : null, strict };
  const cached = await getCached<{ predictions: Prediction[] }>("places_search", cacheParams);
  if (cached) {
    await logApiUsage(user.id, "places_search", true);
    return NextResponse.json({ predictions: cached.predictions, cached: true });
  }

  const budget = await checkBudget("places_search");
  if (!budget.allowed) {
    return NextResponse.json({ predictions: [], reason: budget.reason });
  }

  // Build query — combine city name into query when strict bounded, for accuracy
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", q);
  url.searchParams.set("language", "ar");
  url.searchParams.set("key", key);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    url.searchParams.set("location", `${lat},${lng}`);
    const radiusM = Number.isFinite(radiusKm) && radiusKm > 0
      ? Math.round(radiusKm * 1000)
      : 50_000;
    url.searchParams.set("radius", String(radiusM));
  }
  if (country && /^[a-z]{2}$/.test(country)) {
    // Text Search doesn't support `components=country:` but the `region` param
    // biases results to that country's TLD
    url.searchParams.set("region", country);
  }

  try {
    const r = await fetch(url.toString());
    if (!r.ok) {
      return NextResponse.json({ predictions: [], reason: `http_${r.status}` });
    }
    const data = await r.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn("[search] status:", data.status, data.error_message);
      return NextResponse.json({ predictions: [], reason: data.status });
    }

    let results = (data.results ?? []) as LegacyTextSearchResult[];

    // STRICT city scoping — Text Search's location+radius is only a bias; for
    // true "stay within the city" behaviour we compute the distance ourselves.
    if (strict && Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radiusKm)) {
      const center = { lat, lng };
      const maxKm = radiusKm * 1.15; // small grace for suburbs
      results = results.filter((r) => {
        const loc = r.geometry?.location;
        if (!loc) return false;
        return haversineKm(center, { lat: loc.lat, lng: loc.lng }) <= maxKm;
      });
    }

    const predictions: Prediction[] = results.slice(0, 6).map((r) => ({
      place_id: r.place_id,
      main_text: r.name ?? "",
      secondary_text: r.formatted_address ?? r.vicinity ?? "",
      types: r.types ?? [],
      rating: r.rating,
      review_count: r.user_ratings_total,
      open_now: r.opening_hours?.open_now,
      price_level: r.price_level,
      photo_reference: r.photos?.[0]?.photo_reference,
      icon: r.icon,
      icon_bg: r.icon_background_color,
    }));

    await setCached("places_search", cacheParams, { predictions });
    await logApiUsage(user.id, "places_search", false);
    return NextResponse.json({ predictions });
  } catch (e) {
    console.warn("[search] fetch failed:", e);
    return NextResponse.json({ predictions: [], reason: "fetch_failed" });
  }
}
