// Google Geocoding API adapter — SERVER-SIDE ONLY.
// Used when user enters a hotel name/address to convert it to lat/lng.

import { getCached, setCached, logApiUsage } from "@/lib/cache/apiCache";
import { checkBudget } from "@/lib/google/budgetGuard";

const BASE = "https://maps.googleapis.com/maps/api/geocode/json";

export type GeocodeResult = {
  lat: number;
  lng: number;
  formatted_address: string;
  place_id: string;
} | null;

export async function geocode(
  address: string,
  userId?: string | null
): Promise<{ result: GeocodeResult; mock: boolean }> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { result: null, mock: true };

  const cached = await getCached<{ result: GeocodeResult }>("geocode", { address });
  if (cached) {
    await logApiUsage(userId ?? null, "geocode", true);
    return { result: cached.result, mock: false };
  }

  const budget = await checkBudget("geocode");
  if (!budget.allowed) {
    console.warn("[budgetGuard]", budget.reason);
    return { result: null, mock: true };
  }

  const url = `${BASE}?address=${encodeURIComponent(address)}&key=${key}`;
  const resp = await fetch(url);
  if (!resp.ok) return { result: null, mock: false };
  const data = await resp.json();
  if (data.status !== "OK" || !data.results?.[0]) {
    return { result: null, mock: false };
  }
  const first = data.results[0];
  const result: GeocodeResult = {
    lat: first.geometry.location.lat,
    lng: first.geometry.location.lng,
    formatted_address: first.formatted_address,
    place_id: first.place_id,
  };
  await setCached("geocode", { address }, { result });
  await logApiUsage(userId ?? null, "geocode", false);
  return { result, mock: false };
}
