// city → country resolution for the canonical "visited" roll-up
// (shared by the أماكني and جوازي tabs — see lib/places/myPlaces.ts).
//
// Resolution order for a place's country:
//   1. places.country_code (DB column, ISO 3166-1 alpha-2) — preferred.
//   2. CITY_OPTIONS in lib/utils — major cities already carry `country`.
//   3. CITY_COUNTRY below — explicit fallback for catalogue cities that lack
//      a DB country_code and aren't in CITY_OPTIONS (verified against the
//      places table on 2026-07-10).
// NEVER guess: a city that resolves nowhere is simply left out of the
// country count — an honest undercount beats a fabricated country.

import { cityFromKey } from "@/lib/utils";

// Keys are places.city values normalized to lowercase with whitespace
// stripped. Values are ISO alpha-2, uppercase.
export const CITY_COUNTRY: Record<string, string> = {
  // French Riviera catalogue cities (nice/cannes/monaco resolve via
  // country_code or CITY_OPTIONS; these villages need the explicit map)
  verdon: "FR",
  vence: "FR",
  antibes: "FR",
  menton: "FR",
  eze: "FR",
  sainttropez: "FR",
  stpaul: "FR",
  villefranche: "FR",
  capferrat: "FR",
  grasse: "FR",
  capdail: "FR",
  mougins: "FR",
  biot: "FR",
};

/** Canonical lowercase city key: "نيس" → "nice", unknown cities → slug.
 *  Matches the slug the passport cities API computes (spaces → "-"). */
export function normalizeCityKey(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const opt = cityFromKey(trimmed);
  if (opt) return opt.key;
  return trimmed.toLowerCase().replace(/\s+/g, "-");
}

/** ISO alpha-2 (uppercase) for a city, or null when unknown — never guessed. */
export function countryForCity(city?: string | null, label?: string | null): string | null {
  const opt = cityFromKey(city) ?? cityFromKey(label);
  if (opt?.country) return opt.country.toUpperCase();
  const k = (city ?? label ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return CITY_COUNTRY[k] ?? null;
}
