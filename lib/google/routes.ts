// Google Routes API adapter — SERVER-SIDE ONLY.
// Returns real driving/walking duration. Falls back to local estimate when no API key.

import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";
import { checkBudget } from "@/lib/google/budgetGuard";
import { estimateTravelTimes, haversineKm } from "@/lib/utils";

const BASE = "https://routes.googleapis.com/distanceMatrix/v2";

export type RouteResult = {
  walkMin: number;
  driveMin: number;
  distanceKm: number;
  source: "google" | "estimate";
};

type Coord = { lat: number; lng: number };

export async function computeRoute(
  origin: Coord,
  destination: Coord,
  userId?: string | null
): Promise<RouteResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const distanceKm = haversineKm(origin, destination);

  if (!key) {
    const est = estimateTravelTimes(distanceKm);
    return { ...est, distanceKm, source: "estimate" };
  }

  const params = { origin, destination };
  const cached = await getCached<RouteResult>("routes_matrix", params);
  if (cached) {
    await logApiUsage(userId ?? null, "routes_matrix", true);
    return cached;
  }

  const budget = await checkBudget("routes_matrix");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    const est = estimateTravelTimes(distanceKm);
    return { ...est, distanceKm, source: "estimate" };
  }

  try {
    // Run two parallel requests (one per travel mode) for accurate timings.
    const [drive, walk] = await Promise.all([
      fetchOne(key, origin, destination, "DRIVE"),
      fetchOne(key, origin, destination, "WALK"),
    ]);
    const result: RouteResult = {
      walkMin: Math.max(1, Math.round((walk?.durationSec ?? estimateTravelTimes(distanceKm).walkMin * 60) / 60)),
      driveMin: Math.max(1, Math.round((drive?.durationSec ?? estimateTravelTimes(distanceKm).driveMin * 60) / 60)),
      distanceKm: (drive?.distanceMeters ?? distanceKm * 1000) / 1000,
      source: "google",
    };
    await setCached("routes_matrix", params, result);
    await logApiUsage(userId ?? null, "routes_matrix", false);
    return result;
  } catch (e) {
    console.warn("[routes] Falling back to estimate:", e);
    const est = estimateTravelTimes(distanceKm);
    return { ...est, distanceKm, source: "estimate" };
  }
}

async function fetchOne(
  key: string,
  origin: Coord,
  destination: Coord,
  mode: "DRIVE" | "WALK"
): Promise<{ durationSec: number; distanceMeters: number } | null> {
  const body = {
    origins: [{ waypoint: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } } }],
    destinations: [{ waypoint: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } } }],
    travelMode: mode,
  };
  const resp = await fetch(`${BASE}:computeRouteMatrix`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,status",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  // computeRouteMatrix returns an array of route element objects.
  const first = Array.isArray(data) ? data[0] : data?.[0];
  if (!first || !first.duration) return null;
  const sec = parseInt(String(first.duration).replace(/[^\d]/g, ""), 10);
  return { durationSec: sec, distanceMeters: first.distanceMeters ?? 0 };
}
