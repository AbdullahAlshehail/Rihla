// أماكني — aggregation helpers for the "My Places" coverage screen.
//
// Everything here is computed from REAL user activity only:
//   • checkins            (geofenced presence — the strongest signal)
//   • user_saved_places   (bookmarks)
//   • user_place_ratings  (personal stars)
//   • user_places_status  (passport countries — for the دول stat/badge)
//
// "Covered" in a city = distinct places the user checked in at, saved, or
// rated. Catalogue totals come from cheap HEAD count queries per city (the
// user is active in a handful of cities at most — no N+1 over places).

import { cityFromKey } from "@/lib/utils";
import { countryForCity, normalizeCityKey } from "@/lib/geo/cityCountry";

// ── Raw row shapes (joined selects from the /passport server page) ──────
export type PlaceJoin = {
  id: string;
  name: string;
  city: string | null;
  city_label: string | null;
  category: string | null;
  country_code: string | null;
} | null;

export type CheckinRow = { place_id: string | null; is_first_visit: boolean; created_at: string; place: PlaceJoin };
export type SavedRow = { place_id: string; saved_at: string; place: PlaceJoin };
export type RatingRow = { place_id: string; stars: number | null; updated_at: string; place: PlaceJoin };

// ── Aggregated shapes (passed server → client) ──────────────────────────
export type EngagedPlace = {
  id: string;
  name: string;
  category: string;
  checkins: number;      // how many times the user checked in here
  firstVisit: boolean;   // any check-in flagged as first visit
  stars: number | null;  // the user's own rating
  saved: boolean;
  lastAt: string;        // most recent engagement (ISO)
};

export type CityAgg = {
  key: string;    // canonical lowercase city key (places.city)
  label: string;  // Arabic display label
  flag: string;
  places: EngagedPlace[]; // sorted by lastAt desc (any engagement)
  visited: number; // distinct places CHECKED-IN at in this city ("زرت X")
  total: number;  // catalogue size for the city (filled by the server page)
};

export type TeaserCity = { key: string; label: string; flag: string; total: number };

// All three fields come from the ONE canonical VisitedRollup — the same
// numbers جوازي renders. Never derive them from a different source.
export type MyPlacesStats = {
  places: number;      // distinct places CHECKED-IN at
  cities: number;      // distinct VISITED cities (check-in or «زرتها» marker)
  countries: number;   // distinct VISITED countries (rolled up + markers)
  checkins: number;    // total check-ins
  firstVisits: number; // check-ins that were first visits
};

export type TasteEntry = { cat: string; count: number };

export type MyPlacesData = {
  cities: CityAgg[];      // sorted by engagement desc — [0] is the hero city
  teasers: TeaserCity[];  // catalogue cities with zero activity
  stats: MyPlacesStats;
  taste: TasteEntry[];    // events per category, desc, zero-count cats omitted
};

// ── Canonical "visited" roll-up ─────────────────────────────────────────
// ONE definition consumed identically by BOTH tabs (أماكني + جوازي):
//   • a PLACE is visited when the user has a check-in there;
//   • a CITY is visited when it contains a visited place OR carries a
//     «زرتها» city marker in user_places_status;
//   • a COUNTRY is visited when it contains a visited city/place OR is
//     marked «زرتها» in user_places_status.
// A check-in ALWAYS counts — جوازي can never show fewer countries than the
// user physically checked in at. Country resolution: places.country_code →
// city→country map (lib/geo/cityCountry) → excluded (never guessed).

export type PassportMarker = {
  entity_type: "country" | "city";
  entity_key: string;              // country: "FR" — city: "FR:nice"
  status: "visited" | "wishlist";
  city_label: string | null;
};

export type DerivedCity = { country: string; key: string; label: string };

export type VisitedRollup = {
  placeIds: string[];         // distinct places with a check-in
  cityIdents: string[];       // distinct visited cities as "CC:citykey"
  countryCodes: string[];     // distinct visited countries (ISO alpha-2)
  // Derived from check-ins ALONE — feeds جوازي so the passport map/stats
  // reflect real presence even when the user never toggled the country.
  derivedCountries: string[];
  derivedCities: DerivedCity[];
};

export function computeVisitedRollup(
  checkins: CheckinRow[],
  markers: PassportMarker[],
): VisitedRollup {
  const placeIds = new Set<string>();
  const cityIdents = new Set<string>();
  const countryCodes = new Set<string>();
  const derivedCountries = new Set<string>();
  const derivedCities = new Map<string, DerivedCity>();

  for (const r of checkins) {
    if (r.place_id) placeIds.add(r.place_id);
    const p = r.place;
    if (!p) continue; // deleted place: still a visited place, but no city/country to roll up
    const cityKey = normalizeCityKey(p.city ?? p.city_label);
    const cc = p.country_code?.trim().toUpperCase() || countryForCity(p.city, p.city_label);
    if (cc) {
      countryCodes.add(cc);
      derivedCountries.add(cc);
    }
    if (cityKey) {
      const ident = `${cc ?? "??"}:${cityKey}`;
      cityIdents.add(ident);
      if (cc && !derivedCities.has(ident)) {
        derivedCities.set(ident, {
          country: cc,
          key: cityKey,
          label: p.city_label ?? cityFromKey(cityKey)?.ar ?? cityKey,
        });
      }
    }
  }

  for (const m of markers) {
    if (m.status !== "visited") continue;
    if (m.entity_type === "country") {
      countryCodes.add(m.entity_key.trim().toUpperCase());
    } else {
      const [cc, ...rest] = m.entity_key.split(":");
      const slug = rest.join(":");
      const cityKey = normalizeCityKey(m.city_label) ?? normalizeCityKey(slug) ?? slug;
      const country = (cc ?? "").trim().toUpperCase();
      cityIdents.add(`${country || "??"}:${cityKey}`);
      if (country) countryCodes.add(country); // a visited city rolls up to its country
    }
  }

  return {
    placeIds: [...placeIds],
    cityIdents: [...cityIdents],
    countryCodes: [...countryCodes],
    derivedCountries: [...derivedCountries],
    derivedCities: [...derivedCities.values()],
  };
}

// ── Aggregation ─────────────────────────────────────────────────────────
type Mutable = EngagedPlace & { cityKey: string; cityLabel: string };

function flagFor(key: string, label: string): string {
  return cityFromKey(key)?.flag ?? cityFromKey(label)?.flag ?? "📍";
}

/** Merge the three activity sources into per-city groups + taste + stats.
 *  `total` on each CityAgg is left 0 — the server page fills it from count
 *  queries. Rows whose joined place is missing (deleted place) still count
 *  toward check-in totals but can't be grouped into a city.
 *  `visited` is the canonical roll-up (computeVisitedRollup) — the SAME
 *  aggregate جوازي consumes, so both tabs always agree. */
export function aggregateEngagement(
  checkins: CheckinRow[],
  saved: SavedRow[],
  ratings: RatingRow[],
  visited: VisitedRollup,
): MyPlacesData {
  const byPlace = new Map<string, Mutable>();
  const taste = new Map<string, number>();

  const upsert = (p: PlaceJoin, at: string): Mutable | null => {
    if (!p) return null;
    let m = byPlace.get(p.id);
    if (!m) {
      m = {
        id: p.id,
        name: p.name,
        category: p.category ?? "sight",
        checkins: 0,
        firstVisit: false,
        stars: null,
        saved: false,
        lastAt: at,
        cityKey: (p.city ?? p.city_label ?? "؟").trim().toLowerCase(),
        cityLabel: p.city_label ?? cityFromKey(p.city)?.ar ?? p.city ?? "؟",
      };
      byPlace.set(p.id, m);
    }
    if (at > m.lastAt) m.lastAt = at;
    taste.set(m.category, (taste.get(m.category) ?? 0) + 1);
    return m;
  };

  let checkinTotal = 0;
  let firstVisits = 0;
  for (const r of checkins) {
    checkinTotal += 1;
    if (r.is_first_visit) firstVisits += 1;
    const m = upsert(r.place, r.created_at);
    if (m) {
      m.checkins += 1;
      if (r.is_first_visit) m.firstVisit = true;
    }
  }
  for (const r of saved) {
    const m = upsert(r.place, r.saved_at);
    if (m) m.saved = true;
  }
  for (const r of ratings) {
    const m = upsert(r.place, r.updated_at);
    if (m && r.stars != null) m.stars = r.stars;
  }

  // Group into cities
  const cityMap = new Map<string, CityAgg>();
  for (const m of byPlace.values()) {
    let c = cityMap.get(m.cityKey);
    if (!c) {
      c = { key: m.cityKey, label: m.cityLabel, flag: flagFor(m.cityKey, m.cityLabel), places: [], visited: 0, total: 0 };
      cityMap.set(m.cityKey, c);
    }
    const { cityKey: _k, cityLabel: _l, ...place } = m;
    c.places.push(place);
    if (place.checkins > 0) c.visited += 1;
  }
  const cities = Array.from(cityMap.values());
  for (const c of cities) c.places.sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  cities.sort((a, b) => b.places.length - a.places.length);

  return {
    cities,
    teasers: [], // server page fills from catalogue counts
    stats: {
      // The three headline numbers come from the canonical roll-up — the
      // exact aggregate جوازي renders, so both tabs always agree.
      places: visited.placeIds.length,
      cities: visited.cityIdents.length,
      countries: visited.countryCodes.length,
      checkins: checkinTotal,
      firstVisits,
    },
    taste: Array.from(taste.entries())
      .map(([cat, count]) => ({ cat, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// Catalogue cities offered as "لم تستكشفها بعد" teasers when the user has no
// activity there. Only rendered when the catalogue actually has places
// (server verifies with a count) — never fake numbers.
export const TEASER_CANDIDATES: { key: string; label: string }[] = [
  { key: "riyadh", label: "الرياض" },
  { key: "jeddah", label: "جدة" },
  { key: "nice", label: "نيس" },
  { key: "london", label: "لندن" },
  { key: "istanbul", label: "إسطنبول" },
  { key: "dubai", label: "دبي" },
];

// ── Badges — tiered milestones computed from REAL activity ──────────────
export type BadgeDef = {
  key: string;
  name: string;
  icon: string;      // emoji
  unit: string;      // e.g. "دولة"
  desc: string;
  tiers: [number, number, number]; // برونزي / فضّي / ذهبي thresholds
};

export const TIER_LABELS = ["برونزي", "فضّي", "ذهبي"] as const;
export const TIER_EMOJI = ["🥉", "🥈", "🥇"] as const;

export const BADGE_DEFS: BadgeDef[] = [
  { key: "countries", name: "جوّاب دول", icon: "🌍", unit: "دولة", desc: "دول وصلتها فعلاً — بتسجيل حضور أو علامة «زرتها»", tiers: [3, 10, 25] },
  { key: "cities", name: "مستكشف مدن", icon: "🏙", unit: "مدينة", desc: "مدن زرتها فعلاً — بتسجيل حضور أو علامة «زرتها»", tiers: [2, 6, 15] },
  { key: "checkins", name: "حاضر دايم", icon: "📍", unit: "تسجيل", desc: "تسجيلات حضور مؤكّدة بالموقع", tiers: [5, 25, 100] },
  { key: "firstVisits", name: "أول انطباع", icon: "✨", unit: "زيارة أولى", desc: "أماكن سجّلت حضورك فيها لأول مرة", tiers: [1, 10, 30] },
];

export type BadgeState = {
  def: BadgeDef;
  value: number;
  earnedTier: number;        // 0 = locked, 1..3 = برونزي..ذهبي
  next: number | null;       // next threshold, null when gold reached
};

export function computeBadges(stats: MyPlacesStats): BadgeState[] {
  const valueOf: Record<string, number> = {
    countries: stats.countries,
    cities: stats.cities,
    checkins: stats.checkins,
    firstVisits: stats.firstVisits,
  };
  return BADGE_DEFS.map((def) => {
    const value = valueOf[def.key] ?? 0;
    const earnedTier = def.tiers.filter((t) => value >= t).length;
    return { def, value, earnedTier, next: earnedTier < 3 ? def.tiers[earnedTier] : null };
  });
}
