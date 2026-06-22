// Viator adapter — STUB for Phase 2.
// Will surface bookable activities (tours, day trips, tickets) tied to a place or city.

export type BookableActivity = {
  source: "viator";
  external_id: string;
  title: string;
  price_usd?: number;
  rating?: number;
  url: string;
  thumbnail?: string;
};

export async function findActivities(_args: {
  city: string;
  lat?: number;
  lng?: number;
}): Promise<BookableActivity[]> {
  // TODO: implement when API access is granted.
  return [];
}
