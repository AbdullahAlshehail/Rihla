// Postgres-backed API response cache.
// Use this BEFORE calling expensive external APIs (Google Places/Routes).
// Cache hits are logged to api_usage_log so we can monitor savings.

import crypto from "node:crypto";
import { createWriteClient } from "@/lib/supabase/server";

export type CacheOperation =
  | "places_search"
  | "place_details"
  | "places_nearby"
  | "routes_matrix"
  | "geocode"
  | "find_place";

// TTLs chosen for cost vs freshness tradeoff. Restaurants/landmarks rarely
// change rating/photos in months; we re-pull on user-triggered refresh anyway.
const DEFAULT_TTL_SECONDS: Record<CacheOperation, number> = {
  places_search: 60 * 60 * 24 * 30,  // 30 days (was 7) — same query gives same results
  place_details: 60 * 60 * 24 * 90,  // 90 days (was 30) — biggest cost saver
  places_nearby: 60 * 60 * 24 * 60,  // 60 days (was 30) — venues don't open/close fast
  routes_matrix: 60 * 60 * 24 * 30,  // 30 days (was 14) — driving times stable
  geocode: 60 * 60 * 24 * 180,       // 180 days (was 90) — addresses don't move
  find_place: 60 * 60 * 24 * 90,     // 90 days — same URL = same place_id
};

function hashKey(operation: CacheOperation, params: unknown): string {
  const json = JSON.stringify(params, Object.keys(params as object).sort());
  const h = crypto.createHash("sha256").update(operation + "::" + json).digest("hex");
  return `${operation}_${h.slice(0, 32)}`;
}

export async function getCached<T>(
  operation: CacheOperation,
  params: unknown
): Promise<T | null> {
  try {
    const sb = await createWriteClient();
    const key = hashKey(operation, params);
    const { data, error } = await sb
      .from("api_cache")
      .select("response, expires_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) return null;
    return data.response as T;
  } catch {
    return null;
  }
}

export async function setCached(
  operation: CacheOperation,
  params: unknown,
  response: unknown,
  ttlSeconds?: number
): Promise<void> {
  try {
    const sb = await createWriteClient();
    const key = hashKey(operation, params);
    const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS[operation];
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    await sb.from("api_cache").upsert({
      cache_key: key,
      operation,
      response,
      expires_at: expiresAt,
    });
  } catch (e) {
    console.warn("[apiCache] set failed:", e);
  }
}

export async function logApiUsage(
  userId: string | null,
  operation: string,
  cacheHit: boolean
): Promise<void> {
  try {
    const sb = await createWriteClient();
    await sb.from("api_usage_log").insert({
      user_id: userId,
      operation,
      cache_hit: cacheHit,
    });
  } catch {
    // log failures are non-fatal
  }
}
