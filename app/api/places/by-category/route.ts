// GET /api/places/by-category?cat=food&lat=&lng=&radius=&country=
//
// Returns top 20 places in a city for a given category via Google Nearby
// Search. One Nearby call per category type (some categories combine 2-3
// types via parallel calls). Cached 30 days per (city, category).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkBudget } from "@/lib/google/budgetGuard";
import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";

// Each category fires one or more Nearby Search calls. type filters too
// broadly (returns hotels under "restaurant" etc.) so we ALSO pass a
// keyword to disambiguate. Multiple entries = parallel calls (deduped).
type CategoryQuery = { type: string; keyword?: string };

// One call per category — keyword broadens the type to catch the wider set.
// e.g. sight needs both tourist_attraction + museum → use one call with
// type=tourist_attraction and rely on keyword to capture museums too.
const CATEGORY_TO_QUERIES: Record<string, CategoryQuery[]> = {
  food: [{ type: "restaurant", keyword: "restaurant" }],
  coffee: [{ type: "cafe", keyword: "coffee" }],
  sight: [{ type: "tourist_attraction", keyword: "museum landmark" }],
  nature: [{ type: "park", keyword: "park garden" }],
  sweet: [{ type: "bakery", keyword: "bakery dessert ice cream" }],
  bar: [{ type: "bar", keyword: "bar nightclub" }],
  event: [{ type: "amusement_park", keyword: "entertainment attraction" }],
  shopping: [{ type: "shopping_mall", keyword: "mall shopping" }],
};

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
  icon?: string;
  icon_bg?: string;
  lat?: number;
  lng?: number;
};

type NearbyResult = {
  place_id: string;
  name?: string;
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

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cat = (searchParams.get("cat") ?? "").trim();
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radiusKm = Number(searchParams.get("radius") || 25);

  const queries = CATEGORY_TO_QUERIES[cat];
  if (!queries) return NextResponse.json({ error: "unknown_category" }, { status: 400 });
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat_lng_required" }, { status: 400 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ predictions: [], mock: true });

  const cacheParams = {
    cat,
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100,
    radiusKm,
  };
  const cached = await getCached<{ predictions: Prediction[] }>("places_nearby", cacheParams);
  if (cached) {
    await logApiUsage(user.id, "places_nearby_discover", true);
    return NextResponse.json({ predictions: cached.predictions, cached: true });
  }

  const budget = await checkBudget("places_nearby_discover");
  if (!budget.allowed) {
    return NextResponse.json({ predictions: [], reason: budget.reason });
  }

  const radiusM = Math.round(radiusKm * 1000);

  // Parallel: one Nearby call per (type, optional keyword) combo
  const results: NearbyResult[][] = await Promise.all(
    queries.map(async (qcfg) => {
      const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
      url.searchParams.set("location", `${lat},${lng}`);
      url.searchParams.set("radius", String(radiusM));
      url.searchParams.set("type", qcfg.type);
      if (qcfg.keyword) url.searchParams.set("keyword", qcfg.keyword);
      url.searchParams.set("language", "ar");
      url.searchParams.set("key", key);
      try {
        const r = await fetch(url.toString());
        if (!r.ok) return [];
        const data = await r.json();
        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
          console.warn("[by-category]", qcfg.type, "status:", data.status, data.error_message);
          return [];
        }
        return (data.results ?? []) as NearbyResult[];
      } catch (e) {
        console.warn("[by-category]", qcfg.type, "failed:", e);
        return [];
      }
    })
  );

  // Dedupe + sort by rating × log(reviews)
  const byId = new Map<string, NearbyResult>();
  for (const list of results) {
    for (const r of list) {
      if (!byId.has(r.place_id)) byId.set(r.place_id, r);
    }
  }
  const sorted = Array.from(byId.values()).sort((a, b) => {
    const sa = (a.rating ?? 0) * Math.log10((a.user_ratings_total ?? 1) + 10);
    const sb = (b.rating ?? 0) * Math.log10((b.user_ratings_total ?? 1) + 10);
    return sb - sa;
  });

  const predictions: Prediction[] = sorted.slice(0, 20).map((r) => ({
    place_id: r.place_id,
    main_text: r.name ?? "",
    secondary_text: r.vicinity ?? "",
    types: r.types ?? [],
    rating: r.rating,
    review_count: r.user_ratings_total,
    open_now: r.opening_hours?.open_now,
    price_level: r.price_level,
    photo_reference: r.photos?.[0]?.photo_reference,
    icon: r.icon,
    icon_bg: r.icon_background_color,
    lat: r.geometry?.location.lat,
    lng: r.geometry?.location.lng,
  }));

  await setCached("places_nearby", cacheParams, { predictions });
  await logApiUsage(user.id, "places_nearby_discover", false);
  return NextResponse.json({ predictions });
}
