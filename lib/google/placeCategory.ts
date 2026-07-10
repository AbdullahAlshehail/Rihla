// Google `types[]` → Rihla category/kind mapping.
// Shared by /api/places/add (user adds one place) and the trending discovery
// pipeline (lib/trending/discover.ts inserts newly-viral venues).

import type { Place } from "@/lib/supabase/database.types";

/** Google types → our category enum. Order matters: most specific first. */
export function categoryFromTypes(types?: string[]): Place["category"] {
  if (!types || types.length === 0) return "sight";
  const has = (t: string) => types.includes(t);
  if (has("cafe") || has("coffee_shop")) return "coffee";
  if (has("bakery") || has("ice_cream_shop") || has("dessert_shop") || has("dessert_restaurant")) return "sweet";
  if (has("bar") || has("night_club") || has("liquor_store")) return "bar";
  if (has("restaurant") || has("meal_takeaway") || has("meal_delivery") || has("food")) return "food";
  if (has("park") || has("garden") || has("national_park") || has("hiking_area") || has("beach")) return "nature";
  if (has("amusement_park") || has("amusement_center") || has("event_venue") || has("performing_arts_theater") || has("concert_hall") || has("stadium")) return "event";
  return "sight";
}

/** Pick a "kind" sub-classification when obvious. */
export function kindFromTypes(types?: string[], category?: Place["category"]): string | null {
  if (!types) return null;
  if (category === "food") {
    if (types.includes("italian_restaurant")) return "italian";
    if (types.includes("seafood_restaurant")) return "seafood";
    if (types.includes("fast_food_restaurant")) return "fast";
    if (types.includes("fine_dining_restaurant")) return "fine_dining";
  }
  if (category === "sight") {
    if (types.includes("museum")) return "museum";
    if (types.includes("historical_landmark")) return "landmark";
    if (types.includes("market")) return "market";
  }
  if (category === "nature") {
    if (types.includes("beach")) return "beach";
    if (types.includes("garden")) return "garden";
  }
  return null;
}
