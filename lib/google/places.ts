// Google Places API (LEGACY) adapter — SERVER-SIDE ONLY.
// Uses the classic `maps.googleapis.com/maps/api/place/*` endpoints which
// don't require enabling the separate "Places API (New)" SKU. This is the
// version that ships enabled by default on most existing API keys.
//
// All callers see the same GPlace shape — internally we convert from the
// legacy response format.

import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";
import { checkBudget } from "@/lib/google/budgetGuard";

const BASE = "https://maps.googleapis.com/maps/api/place";

// Field list for Place Details — kept minimal (everything we actually render).
const DETAILS_FIELDS = [
  "place_id",
  "name",
  "formatted_address",
  "geometry",
  "rating",
  "user_ratings_total",
  "price_level",
  "opening_hours",
  "current_opening_hours",
  "international_phone_number",
  "website",
  "url",
  "photos",
  "types",
  "reviews",
  "editorial_summary",
].join(",");

// New-API-shaped result the rest of the app expects. Internal converters fill it.
export type GPlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  photos?: Array<{ name: string }>; // we store legacy photo_reference here
  primaryType?: string;
  currentOpeningHours?: { openNow?: boolean };
  // legacy-only extras we tunnel through for enrichment
  _legacy?: {
    reviews?: LegacyReview[];
    opening_periods?: LegacyOpeningPeriod[];
    price_level_num?: number; // 0-4 in old API
  };
};

export type LegacyReview = {
  author_name?: string;
  language?: string;
  rating?: number;
  relative_time_description?: string;
  text?: string;
};

type LegacyOpeningPeriod = {
  open?: { day: number; time: string }; // time is "HHMM"
  close?: { day: number; time: string };
};

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
  opening_hours?: { open_now?: boolean; periods?: LegacyOpeningPeriod[]; weekday_text?: string[] };
  current_opening_hours?: { open_now?: boolean };
  reviews?: LegacyReview[];
  editorial_summary?: { overview?: string };
};

function getKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

function fromLegacy(p: LegacyPlace): GPlace {
  const priceLabel =
    p.price_level == null
      ? undefined
      : p.price_level === 0
      ? "PRICE_LEVEL_FREE"
      : p.price_level === 1
      ? "PRICE_LEVEL_INEXPENSIVE"
      : p.price_level === 2
      ? "PRICE_LEVEL_MODERATE"
      : p.price_level === 3
      ? "PRICE_LEVEL_EXPENSIVE"
      : "PRICE_LEVEL_VERY_EXPENSIVE";

  return {
    id: p.place_id ?? "",
    displayName: p.name ? { text: p.name } : undefined,
    formattedAddress: p.formatted_address,
    location: p.geometry?.location
      ? { latitude: p.geometry.location.lat, longitude: p.geometry.location.lng }
      : undefined,
    rating: p.rating,
    userRatingCount: p.user_ratings_total,
    priceLevel: priceLabel,
    internationalPhoneNumber: p.international_phone_number,
    websiteUri: p.website,
    googleMapsUri: p.url,
    photos: p.photos?.map((ph) => ({ name: ph.photo_reference })),
    primaryType: p.types?.[0],
    currentOpeningHours: p.current_opening_hours
      ? { openNow: p.current_opening_hours.open_now }
      : p.opening_hours
      ? { openNow: p.opening_hours.open_now }
      : undefined,
    _legacy: {
      reviews: p.reviews,
      opening_periods: p.opening_hours?.periods,
      price_level_num: p.price_level,
    },
  };
}

/** Text search — returns up to N places matching a query in a region. */
export async function searchPlaces(args: {
  query: string;
  lat?: number;
  lng?: number;
  radius?: number;
  userId?: string | null;
}): Promise<{ places: GPlace[]; mock: boolean; cached: boolean }> {
  const key = getKey();
  if (!key) return { places: [], mock: true, cached: false };

  const cached = await getCached<{ places: GPlace[] }>("places_search", args);
  if (cached) {
    await logApiUsage(args.userId ?? null, "places_search", true);
    return { places: cached.places, mock: false, cached: true };
  }

  const budget = await checkBudget("places_search");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    return { places: [], mock: true, cached: false };
  }

  const url = new URL(`${BASE}/textsearch/json`);
  url.searchParams.set("query", args.query);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "ar"); // Arabic results where available
  if (args.lat != null && args.lng != null) {
    url.searchParams.set("location", `${args.lat},${args.lng}`);
    url.searchParams.set("radius", String(args.radius ?? 5000));
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.warn("[places] search failed:", resp.status);
    return { places: [], mock: false, cached: false };
  }
  const data = await resp.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.warn("[places] search status:", data.status, data.error_message);
    return { places: [], mock: false, cached: false };
  }
  const places = ((data.results ?? []) as LegacyPlace[]).map(fromLegacy);
  await setCached("places_search", args, { places });
  await logApiUsage(args.userId ?? null, "places_search", false);
  return { places, mock: false, cached: false };
}

/** Place details by google_place_id, in Arabic (with English fallback). */
export async function getPlaceDetails(
  placeId: string,
  userId?: string | null
): Promise<{ place: GPlace | null; mock: boolean; cached: boolean }> {
  const key = getKey();
  if (!key) return { place: null, mock: true, cached: false };

  const cached = await getCached<{ place: GPlace }>("place_details", { placeId });
  if (cached) {
    await logApiUsage(userId ?? null, "place_details", true);
    return { place: cached.place, mock: false, cached: true };
  }

  const budget = await checkBudget("place_details");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    return { place: null, mock: true, cached: false };
  }

  const url = new URL(`${BASE}/details/json`);
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "ar");
  url.searchParams.set("fields", DETAILS_FIELDS);

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.warn("[places] details failed:", resp.status);
    return { place: null, mock: false, cached: false };
  }
  const data = await resp.json();
  if (data.status !== "OK") {
    console.warn("[places] details status:", data.status, data.error_message);
    return { place: null, mock: false, cached: false };
  }
  const place = fromLegacy(data.result as LegacyPlace);
  await setCached("place_details", { placeId }, { place });
  await logApiUsage(userId ?? null, "place_details", false);
  return { place, mock: false, cached: false };
}

/** Find a single place by free-text + optional location bias.
 *  Used by /api/places/from-url to convert a name+coords pair (parsed from a
 *  Google Maps share URL) into a billable place_id we can then enrich. One
 *  API call, ~$0.017. Cached on (input, lat/lng) so re-pasting is free. */
export async function findPlaceByText(args: {
  input: string;
  lat?: number;
  lng?: number;
  userId?: string | null;
}): Promise<{ placeId: string | null; mock: boolean; cached: boolean }> {
  const key = getKey();
  if (!key) return { placeId: null, mock: true, cached: false };

  const cacheKey = { input: args.input, lat: args.lat, lng: args.lng };
  const cached = await getCached<{ placeId: string }>("find_place", cacheKey);
  if (cached) {
    await logApiUsage(args.userId ?? null, "find_place", true);
    return { placeId: cached.placeId, mock: false, cached: true };
  }

  const budget = await checkBudget("find_place");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    return { placeId: null, mock: true, cached: false };
  }

  const url = new URL(`${BASE}/findplacefromtext/json`);
  url.searchParams.set("input", args.input);
  url.searchParams.set("inputtype", "textquery");
  url.searchParams.set("fields", "place_id");
  url.searchParams.set("language", "ar");
  url.searchParams.set("key", key);
  if (args.lat != null && args.lng != null) {
    // Bias within 200m of the coords parsed from the URL — sharp enough
    // to dodge name collisions, loose enough to forgive 50–100m URL drift.
    url.searchParams.set("locationbias", `circle:200@${args.lat},${args.lng}`);
  }

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.warn("[places] find failed:", resp.status);
    return { placeId: null, mock: false, cached: false };
  }
  const data = await resp.json() as {
    status?: string;
    candidates?: Array<{ place_id?: string }>;
    error_message?: string;
  };
  if (data.status !== "OK" || !data.candidates?.length) {
    if (data.status && data.status !== "ZERO_RESULTS") {
      console.warn("[places] find status:", data.status, data.error_message);
    }
    return { placeId: null, mock: false, cached: false };
  }
  const placeId = data.candidates[0].place_id ?? null;
  if (placeId) await setCached("find_place", cacheKey, { placeId });
  await logApiUsage(args.userId ?? null, "find_place", false);
  return { placeId, mock: false, cached: false };
}

/** Resolve a photo_reference to a stable Google CDN URL by following the
 *  Place Photo redirect. Counts as ONE Place Photo billing — then displayed
 *  free forever via Google CDN. */
export async function getPhotoUrl(
  photoReference: string,
  maxHeightPx = 720
): Promise<string | null> {
  const key = getKey();
  if (!key) return null;
  const budget = await checkBudget("place_photo");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    return null;
  }
  // The /photo endpoint redirects to lh*.googleusercontent.com. We follow once
  // and persist the final URL so subsequent views cost nothing.
  const url = `${BASE}/photo?photoreference=${photoReference}&maxheight=${maxHeightPx}&key=${key}`;
  try {
    const resp = await fetch(url, { redirect: "manual" });
    // 302 → redirect to CDN URL in `location` header
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (loc) return loc;
    }
    // Some clients/runtimes auto-follow; if so, resp.url is the final URL
    if (resp.ok && resp.url && resp.url !== url) return resp.url;
    return null;
  } catch (e) {
    console.warn("[places] photo fetch failed:", e);
    return null;
  }
}
