// TripAdvisor adapter — STUB for Phase 2.
// Implement getPlaceEnrichment to merge reviews/photos/etc into a Place.
// Until we have access, this returns null and the app uses Google data only.

import type { Place } from "@/lib/supabase/database.types";

export type ExternalEnrichment = {
  source: "tripadvisor";
  rating?: number;
  review_count?: number;
  url?: string;
  photos?: string[];
};

export async function getPlaceEnrichment(
  _place: Place
): Promise<ExternalEnrichment | null> {
  // TODO: wire up when API key is granted. Cache via lib/cache/apiCache.
  return null;
}
