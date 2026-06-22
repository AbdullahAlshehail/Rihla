// Google Places Nearby Search (LEGACY) — entertainment discovery near a point.
// Makes a small set of parallel calls (one per category) and groups results.
//
// Cost: 5 calls × $0.032 = $0.16 per city, cached 60 days → effectively free.

import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";
import { checkBudget } from "@/lib/google/budgetGuard";

const BASE = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

// Old API only accepts ONE type per call → we run a curated set in parallel.
// Each entry seeds a "chip" in the UI. Adding more = better coverage, more cost.
const QUERY_TYPES = [
  "tourist_attraction",
  "museum",
  "amusement_park",
  "park",
  "art_gallery",
  "shopping_mall",
] as const;

// Map legacy Google `types[]` → friendly Arabic display + emoji.
// The first matching key wins. Items not on this list fall back to generic.
export const TYPE_LABELS_AR: Record<string, { ar: string; emoji: string }> = {
  amusement_park: { ar: "ملاهي", emoji: "🎢" },
  aquarium: { ar: "أكواريوم", emoji: "🐠" },
  art_gallery: { ar: "صالة فنون", emoji: "🖼" },
  bowling_alley: { ar: "بولينج", emoji: "🎳" },
  casino: { ar: "كازينو", emoji: "🎰" },
  movie_theater: { ar: "سينما", emoji: "🎬" },
  museum: { ar: "متحف", emoji: "🏛" },
  park: { ar: "متنزه", emoji: "🌳" },
  shopping_mall: { ar: "مول", emoji: "🛍" },
  spa: { ar: "سبا", emoji: "💆" },
  stadium: { ar: "ملعب", emoji: "🏟" },
  tourist_attraction: { ar: "معلم سياحي", emoji: "📍" },
  zoo: { ar: "حديقة حيوان", emoji: "🦁" },
  night_club: { ar: "ملهى ليلي", emoji: "🪩" },
  performing_arts_theater: { ar: "مسرح", emoji: "🎭" },
  historical_landmark: { ar: "معلم تاريخي", emoji: "🏛" },
  library: { ar: "مكتبة", emoji: "📚" },
  garden: { ar: "حديقة", emoji: "🌷" },
};

export type NearbyPlace = {
  id: string;
  primaryType?: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
  photos?: Array<{ name: string }>;
};

export type DiscoveryResult = {
  ok: boolean;
  mock: boolean;
  cached?: boolean;
  groups: Record<string, NearbyPlace[]>;
  count: number;
};

type LegacyNearbyResult = {
  place_id: string;
  name?: string;
  vicinity?: string;
  geometry?: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  opening_hours?: { open_now?: boolean };
  types?: string[];
  photos?: Array<{ photo_reference: string }>;
};

function priceLabel(n?: number): string | undefined {
  if (n == null) return undefined;
  return n === 0 ? "PRICE_LEVEL_FREE"
    : n === 1 ? "PRICE_LEVEL_INEXPENSIVE"
    : n === 2 ? "PRICE_LEVEL_MODERATE"
    : n === 3 ? "PRICE_LEVEL_EXPENSIVE"
    : "PRICE_LEVEL_VERY_EXPENSIVE";
}

function pickPrimaryType(types?: string[]): string | undefined {
  if (!types) return undefined;
  // Prefer types we have an Arabic label for
  for (const t of types) if (TYPE_LABELS_AR[t]) return t;
  return types[0];
}

function fromLegacyNearby(r: LegacyNearbyResult): NearbyPlace {
  return {
    id: r.place_id,
    primaryType: pickPrimaryType(r.types),
    displayName: r.name ? { text: r.name } : undefined,
    formattedAddress: r.vicinity,
    location: r.geometry?.location
      ? { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng }
      : undefined,
    rating: r.rating,
    userRatingCount: r.user_ratings_total,
    priceLevel: priceLabel(r.price_level),
    currentOpeningHours: r.opening_hours ? { openNow: r.opening_hours.open_now } : undefined,
    googleMapsUri: `https://www.google.com/maps/place/?q=place_id:${r.place_id}`,
    photos: r.photos?.map((p) => ({ name: p.photo_reference })),
  };
}

/** Bulk-discover entertainment near a location via 6 parallel category calls. */
export async function discoverEntertainment(args: {
  lat: number;
  lng: number;
  radius?: number;
  userId?: string | null;
  cityKey?: string;
}): Promise<DiscoveryResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, mock: true, groups: {}, count: 0 };

  const cacheParams = {
    cityKey: args.cityKey,
    lat: Math.round(args.lat * 1000) / 1000,
    lng: Math.round(args.lng * 1000) / 1000,
    radius: args.radius ?? 15000,
  };
  const cached = await getCached<DiscoveryResult>("places_nearby", cacheParams);
  if (cached) {
    await logApiUsage(args.userId ?? null, "places_nearby_discover", true);
    return { ...cached, cached: true };
  }

  const budget = await checkBudget("places_nearby_discover");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    return { ok: false, mock: true, groups: {}, count: 0 };
  }

  // Run all category fetches in parallel
  const results = await Promise.all(
    QUERY_TYPES.map((t) => fetchOne(key, args.lat, args.lng, cacheParams.radius, t))
  );

  // Aggregate + dedupe by place_id
  const byId = new Map<string, NearbyPlace>();
  for (const list of results) {
    for (const r of list) {
      const mapped = fromLegacyNearby(r);
      if (!byId.has(mapped.id)) byId.set(mapped.id, mapped);
    }
  }
  const all = Array.from(byId.values());

  // Group by primaryType
  const groups: Record<string, NearbyPlace[]> = {};
  for (const p of all) {
    const t = p.primaryType ?? "tourist_attraction";
    (groups[t] ??= []).push(p);
  }
  // Sort each group by rating × log(reviewCount)
  for (const g of Object.values(groups)) {
    g.sort((a, b) => {
      const sa = (a.rating ?? 0) * Math.log10((a.userRatingCount ?? 1) + 10);
      const sb = (b.rating ?? 0) * Math.log10((b.userRatingCount ?? 1) + 10);
      return sb - sa;
    });
  }

  const result: DiscoveryResult = {
    ok: true,
    mock: false,
    groups,
    count: all.length,
  };
  await setCached("places_nearby", cacheParams, result);
  await logApiUsage(args.userId ?? null, "places_nearby_discover", false);
  return result;
}

async function fetchOne(
  key: string,
  lat: number,
  lng: number,
  radius: number,
  type: string
): Promise<LegacyNearbyResult[]> {
  const url = new URL(BASE);
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(radius));
  url.searchParams.set("type", type);
  url.searchParams.set("language", "ar");
  url.searchParams.set("key", key);
  try {
    const r = await fetch(url.toString());
    if (!r.ok) return [];
    const data = await r.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.warn("[nearby]", type, "status:", data.status, data.error_message);
      return [];
    }
    return (data.results ?? []) as LegacyNearbyResult[];
  } catch (e) {
    console.warn("[nearby]", type, "failed:", e);
    return [];
  }
}

// Re-export for back-compat with callers that imported ACTIVITY_TYPES
export const ACTIVITY_TYPES = QUERY_TYPES;
