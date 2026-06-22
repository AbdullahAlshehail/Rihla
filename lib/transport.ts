// Recommended transport mode given a route.
// Combines distance, time-of-day, and basic comfort heuristics.

import type { RouteResult } from "@/lib/google/routes";

export type TransportRecommendation = {
  mode: "walk" | "drive";
  reasonAr: string;
};

export function recommendTransport(route: RouteResult, now = new Date()): TransportRecommendation {
  const hour = now.getHours();
  const isLate = hour >= 22 || hour < 6;
  const km = route.distanceKm;

  if (km <= 0.4) return { mode: "walk", reasonAr: "مسافة قصيرة جداً — مشي" };
  if (km <= 1.5 && !isLate) return { mode: "walk", reasonAr: `~${route.walkMin}د مشي مريح` };
  if (km <= 2.5 && route.walkMin <= 25 && !isLate)
    return { mode: "walk", reasonAr: `${route.walkMin}د مشي · ${route.driveMin}د سيارة` };
  return { mode: "drive", reasonAr: `${route.driveMin}د سيارة · مسافة ${km.toFixed(1)}كم` };
}
