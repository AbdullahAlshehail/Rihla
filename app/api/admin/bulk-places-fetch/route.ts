// POST /api/admin/bulk-places-fetch
//
// Run ONE Google Places textsearch call for a city + query (+ optional
// pagetoken), classify the results into our schema, dedupe against existing
// rows, and bulk-insert the new ones. The UI loops over (city × query × page)
// to gather +500 per city without blowing the 26 s Netlify timeout.
//
// Auth: admin-only.
// Cost: 1 places_search call per request ($0.032 / 1000 → free within tier).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";
import { checkBudget } from "@/lib/google/budgetGuard";
import { logApiUsage } from "@/lib/cache/apiCache";

const BodySchema = z.object({
  city: z.enum(["nice", "cannes", "monaco"]),
  query: z.string().min(2).max(120),
  pageToken: z.string().nullable().optional(),
});

type CityCfg = {
  key: "nice" | "cannes" | "monaco";
  label: string;
  lat: number;
  lng: number;
  radius: number; // meters
  bbox: [number, number, number, number]; // s,w,n,e
  currency: "EUR";
};
const CITIES: Record<CityCfg["key"], CityCfg> = {
  nice:   { key: "nice",   label: "Nice",   lat: 43.7102, lng: 7.2620,  radius: 12000, bbox: [43.65, 7.20, 43.76, 7.32], currency: "EUR" },
  cannes: { key: "cannes", label: "Cannes", lat: 43.5528, lng: 7.0174,  radius: 6000,  bbox: [43.52, 6.95, 43.59, 7.10], currency: "EUR" },
  monaco: { key: "monaco", label: "Monaco", lat: 43.7384, lng: 7.4246,  radius: 3000,  bbox: [43.72, 7.40, 43.76, 7.45], currency: "EUR" },
};

type LegacyPhoto = { photo_reference: string };
type LegacyResult = {
  place_id: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  types?: string[];
  photos?: LegacyPhoto[];
};
type LegacyResponse = {
  status: string;
  next_page_token?: string;
  results?: LegacyResult[];
  error_message?: string;
};

// Map Google's `types[]` → our (category, kind). First-hit wins.
function classify(types?: string[]): { category: "food" | "coffee" | "sweet" | "bar" | "sight" | "nature" | "event"; kind: string | null } | null {
  if (!types || types.length === 0) return null;
  const t = new Set(types);

  // Cuisine-specific food first (so we capture "italian" instead of generic "restaurant")
  const cuisineMap: Record<string, string> = {
    italian_restaurant: "italian", japanese_restaurant: "japanese",
    chinese_restaurant: "chinese", korean_restaurant: "korean",
    thai_restaurant: "thai", indian_restaurant: "indian",
    lebanese_restaurant: "lebanese", greek_restaurant: "greek",
    mexican_restaurant: "mexican", french_restaurant: "french",
    spanish_restaurant: "tapas", turkish_restaurant: "turkish",
    mediterranean_restaurant: "mediterranean", seafood_restaurant: "seafood",
    steak_house: "steakhouse", pizza_restaurant: "pizzeria",
    burger_restaurant: "burger", vegan_restaurant: "vegan",
    vegetarian_restaurant: "vegan",
    fast_food_restaurant: "fast_food", sushi_restaurant: "japanese",
    brunch_restaurant: "brunch", bistro: "bistro",
    fine_dining_restaurant: "fine_dining",
  };
  for (const [k, v] of Object.entries(cuisineMap)) {
    if (t.has(k)) return { category: "food", kind: v };
  }
  if (t.has("restaurant"))       return { category: "food", kind: "general" };
  if (t.has("meal_takeaway"))    return { category: "food", kind: "fast_food" };

  // Coffee / sweet
  if (t.has("cafe") || t.has("coffee_shop")) return { category: "coffee", kind: "cafe" };
  if (t.has("bakery"))                       return { category: "sweet", kind: "bakery" };
  if (t.has("ice_cream_shop"))               return { category: "sweet", kind: "icecream" };
  if (t.has("chocolate_shop") || t.has("chocolatier")) return { category: "sweet", kind: "chocolate" };
  if (t.has("dessert_restaurant") || t.has("dessert_shop")) return { category: "sweet", kind: "patisserie" };

  // Bar / nightlife
  if (t.has("night_club"))                   return { category: "bar", kind: "nightclub" };
  if (t.has("bar") || t.has("pub"))          return { category: "bar", kind: t.has("pub") ? "pub" : "cocktail" };

  // Sight / culture
  if (t.has("museum"))                       return { category: "sight", kind: "museum" };
  if (t.has("art_gallery"))                  return { category: "sight", kind: "gallery" };
  if (t.has("aquarium"))                     return { category: "sight", kind: "aquarium" };
  if (t.has("zoo"))                          return { category: "sight", kind: "zoo" };
  if (t.has("church") || t.has("place_of_worship") || t.has("mosque") || t.has("synagogue"))
                                              return { category: "sight", kind: "religious" };
  if (t.has("spa"))                          return { category: "sight", kind: "spa" };
  if (t.has("tourist_attraction") || t.has("historical_landmark") || t.has("monument"))
                                              return { category: "sight", kind: "landmark" };

  // Nature
  if (t.has("park") || t.has("national_park")) return { category: "nature", kind: "park" };
  if (t.has("garden"))                          return { category: "nature", kind: "garden" };
  if (t.has("beach"))                           return { category: "nature", kind: "beach" };

  // Event / amusement
  if (t.has("amusement_park"))                  return { category: "event", kind: "amusement" };
  if (t.has("movie_theater"))                   return { category: "event", kind: "cinema" };
  if (t.has("performing_arts_theater"))         return { category: "event", kind: "theater" };
  if (t.has("stadium"))                         return { category: "event", kind: "stadium" };

  return null;
}

function withinBbox(lat: number, lng: number, b: [number, number, number, number]): boolean {
  return lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];
}

function buildTags(types: string[] | undefined): string[] {
  if (!types) return [];
  // Surface up to 5 useful types so the existing filter chips light up
  return types.slice(0, 8);
}

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isAdminEmail(user.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { city, query, pageToken } = parsed.data;
  const cfg = CITIES[city];

  // Budget gate on places_search SKU
  const budget = await checkBudget("places_search");
  if (!budget.allowed) {
    return NextResponse.json({ error: "budget_blocked", reason: budget.reason }, { status: 429 });
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return NextResponse.json({ error: "no_api_key" }, { status: 500 });

  // Call Google textsearch
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  if (pageToken) {
    // Subsequent pages — only `pagetoken` + `key` are honored
    url.searchParams.set("pagetoken", pageToken);
    url.searchParams.set("key", key);
  } else {
    url.searchParams.set("query", `${query} in ${cfg.label}`);
    url.searchParams.set("location", `${cfg.lat},${cfg.lng}`);
    url.searchParams.set("radius", String(cfg.radius));
    url.searchParams.set("language", "ar");
    url.searchParams.set("key", key);
  }

  const resp = await fetch(url.toString());
  await logApiUsage(user.id, "places_search", false);

  if (!resp.ok) {
    return NextResponse.json({ error: "google_http_error", status: resp.status }, { status: 502 });
  }
  const data = (await resp.json()) as LegacyResponse;
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    return NextResponse.json({ error: "google_status", status: data.status, message: data.error_message }, { status: 502 });
  }

  const candidates = (data.results ?? []).filter((r) => {
    if (!r.place_id || !r.geometry?.location) return false;
    return withinBbox(r.geometry.location.lat, r.geometry.location.lng, cfg.bbox);
  });

  // Dedupe against existing rows (by google_place_id)
  const ids = candidates.map((r) => r.place_id);
  let existing: Set<string> = new Set();
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from("places")
      .select("google_place_id")
      .in("google_place_id", ids);
    existing = new Set((rows ?? []).map((r) => r.google_place_id).filter(Boolean) as string[]);
  }
  const fresh = candidates.filter((r) => !existing.has(r.place_id));

  // Classify + build rows
  const insertRows: Record<string, unknown>[] = [];
  let unclassified = 0;
  for (const r of fresh) {
    const c = classify(r.types);
    if (!c) { unclassified++; continue; }
    const photoUrl = (r.photos ?? [])[0]?.photo_reference
      ? `/api/photo?ref=${encodeURIComponent((r.photos ?? [])[0].photo_reference)}`
      : null;
    insertRows.push({
      google_place_id: r.place_id,
      external_source: "google_bulk",
      name: r.name ?? "(بدون اسم)",
      category: c.category,
      kind: c.kind,
      city: cfg.key,
      city_label: cfg.label,
      lat: r.geometry!.location.lat,
      lng: r.geometry!.location.lng,
      address: r.formatted_address ?? null,
      rating: r.rating ?? null,
      review_count: r.user_ratings_total ?? null,
      price_level: r.price_level ?? null,
      cost_currency: cfg.currency,
      cost_confidence: "low" as const,
      tags: buildTags(r.types),
      highlights: [],
      tip: null,
      is_editor_pick: false,
      // data_freshness is a timestamptz with default now() — let the DB fill it
      photo_url: photoUrl,
      // photos array left null — populated when user opens the place
    });
  }

  let inserted = 0;
  let dbErrors = 0;
  if (insertRows.length > 0) {
    // Plain INSERT with row return — we already deduped above, so any conflict
    // here is a concurrent race; let it fail loud so we see it (audit fix
    // 2026-06-15: upsert+ignoreDuplicates+count returns null, not the row count).
    const { data: insertedRows, error } = await supabase
      .from("places")
      .insert(insertRows)
      .select("id");
    if (error) {
      dbErrors++;
      return NextResponse.json({ error: "db_insert_error", message: error.message }, { status: 500 });
    }
    inserted = insertedRows?.length ?? 0;
  }

  return NextResponse.json({
    city,
    query,
    page: pageToken ? "next" : "first",
    candidates: candidates.length,
    duplicates: candidates.length - fresh.length,
    unclassified,
    inserted,
    db_errors: dbErrors,
    next_page_token: data.next_page_token ?? null,
  });
}
