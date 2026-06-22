// ─────────────────────────────────────────────────────────────────────────────
// Expand catalogue with free OpenStreetMap places via Overpass API.
//
// Data © OpenStreetMap contributors, licensed under the Open Database License
// (ODbL). https://www.openstreetmap.org/copyright
//
// What this does:
//  - For each target city (Nice, Monaco, Cannes, Riyadh) sends ONE Overpass
//    query that pulls amenity/tourism/leisure/shop POIs inside the city's bbox.
//  - Classifies each node into our Category + kind taxonomy (mirrors the
//    cuisine_* predicates in lib/discover/filters.ts so the new rows light up
//    the existing filter chips automatically).
//  - Dedups against the existing `places` table for that city — case-folded
//    name match within 30 m of an existing row is treated as a duplicate.
//  - Bulk-inserts the survivors in 100-row batches with external_source="osm",
//    google_place_id=null, cost_confidence="low".
//
// Zero cost: Overpass is free but rate-limited; we sleep 65 s between cities
// so we never trigger the public endpoint's 1 query/min ceiling.
//
// Run:  npx tsx scripts/expand-places-overpass.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Types ────────────────────────────────────────────────────────────────────

type Category = "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar";
type Currency = "SAR" | "EUR" | "USD" | "GBP" | "AED";
type Confidence = "high" | "medium" | "low";

type CityCfg = {
  key: string;          // matches `places.city`
  label: string;        // matches `places.city_label`
  bbox: [number, number, number, number]; // [south, west, north, east]
  currency: Currency;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lng: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  version?: number;
  elements?: OverpassElement[];
};

type ExistingPlace = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
};

type ClassifiedPlace = {
  name: string;
  category: Category;
  kind: string | null;
  lat: number;
  lng: number;
  city: string;
  city_label: string;
  cost_currency: Currency;
  tags: string[];
  highlights: string[];
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string[] | null;
};

// ── City configuration ──────────────────────────────────────────────────────

const CITIES: CityCfg[] = [
  { key: "nice",   label: "Nice",   bbox: [43.65, 7.20, 43.76, 7.32], currency: "EUR" },
  { key: "monaco", label: "Monaco", bbox: [43.72, 7.40, 43.76, 7.45], currency: "EUR" },
  { key: "cannes", label: "Cannes", bbox: [43.52, 6.95, 43.59, 7.10], currency: "EUR" },
  { key: "riyadh", label: "Riyadh", bbox: [24.55, 46.50, 24.90, 46.95], currency: "SAR" },
];

// ── Overpass query ───────────────────────────────────────────────────────────

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const RATE_LIMIT_PAUSE_MS = 65_000; // Overpass public ceiling ≈ 1 query/min
const REQUEST_TIMEOUT_MS = 180_000;

function buildOverpassQuery(bbox: [number, number, number, number]): string {
  const bb = bbox.join(",");
  // [out:json][timeout:120][bbox]; followed by the union of all tag filters.
  // We pull node+way+relation so we get e.g. museums, parks, large gardens
  // that are mapped as ways; `out center` collapses them to a single point.
  return `
[out:json][timeout:120];
(
  node["amenity"~"^(restaurant|cafe|bar|fast_food|ice_cream|pub|nightclub)$"](${bb});
  way["amenity"~"^(restaurant|cafe|bar|fast_food|ice_cream|pub|nightclub)$"](${bb});
  node["tourism"~"^(attraction|museum|viewpoint|gallery|artwork)$"](${bb});
  way["tourism"~"^(attraction|museum|viewpoint|gallery|artwork)$"](${bb});
  relation["tourism"~"^(attraction|museum|gallery)$"](${bb});
  node["leisure"~"^(park|garden|beach_resort|nature_reserve)$"](${bb});
  way["leisure"~"^(park|garden|beach_resort|nature_reserve)$"](${bb});
  relation["leisure"~"^(park|garden|nature_reserve)$"](${bb});
  node["shop"~"^(bakery|confectionery|coffee|pastry|chocolate)$"](${bb});
  way["shop"~"^(bakery|confectionery|coffee|pastry|chocolate)$"](${bb});
);
out center tags;
`.trim();
}

async function fetchOverpass(city: CityCfg): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(buildOverpassQuery(city.bbox))}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "rihla-app/1.0 (Saudi travel guide; OSM data is ODbL)",
        "Accept": "application/json",
      },
      body,
      signal: ctrl.signal,
    });
    if (!r.ok) {
      console.error(`  ✗ Overpass HTTP ${r.status} for ${city.key}: ${await r.text().catch(() => "")}`);
      return [];
    }
    const json = (await r.json()) as OverpassResponse;
    return json.elements ?? [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Classification (category + kind) ────────────────────────────────────────

// Mirrors the kinds expected by lib/discover/filters.ts cuisine_* predicates
// so OSM-sourced rows light up the same filter chips without extra plumbing.
const CUISINE_MAP: Record<string, string> = {
  italian: "italian",
  pizza: "pizzeria",
  french: "french",
  japanese: "japanese",
  sushi: "japanese",
  chinese: "chinese",
  korean: "korean",
  thai: "thai",
  indian: "indian",
  lebanese: "lebanese",
  saudi: "saudi",
  najdi: "najdi",
  yemeni: "yemeni",
  turkish: "turkish",
  greek: "greek",
  mexican: "mexican",
  peruvian: "peruvian",
  british: "british",
  mediterranean: "mediterranean",
  seafood: "seafood",
  steak: "steakhouse",
  steak_house: "steakhouse",
  burger: "burger",
  vegan: "vegan",
  vegetarian: "vegan",
  brunch: "brunch",
  bistro: "bistro",
  brasserie: "brasserie",
  fine_dining: "fine_dining",
  tapas: "tapas",
  gastropub: "gastropub",
};

function pickCuisineKind(cuisineTag: string | undefined): string | null {
  if (!cuisineTag) return null;
  // OSM cuisine is often semicolon-delimited, e.g. "italian;pizza"
  const parts = cuisineTag.toLowerCase().split(/[;,]/).map((s) => s.trim());
  for (const p of parts) {
    if (CUISINE_MAP[p]) return CUISINE_MAP[p];
  }
  return null;
}

function classify(tags: Record<string, string>): { category: Category; kind: string | null } | null {
  const amenity = tags.amenity;
  const tourism = tags.tourism;
  const leisure = tags.leisure;
  const shop = tags.shop;

  // Coffee — explicit cafe / coffee shop
  if (amenity === "cafe") return { category: "coffee", kind: "cafe" };
  if (shop === "coffee") return { category: "coffee", kind: "specialty" };

  // Sweet — bakeries / pastry / chocolate / ice cream / confectionery
  if (amenity === "ice_cream") return { category: "sweet", kind: "icecream" };
  if (shop === "bakery") return { category: "sweet", kind: "bakery" };
  if (shop === "pastry") return { category: "sweet", kind: "patisserie" };
  if (shop === "chocolate") return { category: "sweet", kind: "chocolate" };
  if (shop === "confectionery") return { category: "sweet", kind: "confectionery" };

  // Bar / nightlife
  if (amenity === "bar")        return { category: "bar", kind: "cocktail" };
  if (amenity === "pub")        return { category: "bar", kind: "pub" };
  if (amenity === "nightclub")  return { category: "bar", kind: "nightclub" };

  // Food
  if (amenity === "restaurant" || amenity === "fast_food") {
    const cuisineKind = pickCuisineKind(tags.cuisine);
    const kind = cuisineKind ?? (amenity === "fast_food" ? "fast_food" : "general");
    return { category: "food", kind };
  }

  // Sights — museums / galleries / attractions / viewpoints
  if (tourism === "museum")       return { category: "sight", kind: "museum" };
  if (tourism === "gallery")      return { category: "sight", kind: "gallery" };
  if (tourism === "viewpoint")    return { category: "sight", kind: "viewpoint" };
  if (tourism === "attraction")   return { category: "sight", kind: "landmark" };
  if (tourism === "artwork")      return { category: "sight", kind: "artwork" };

  // Nature
  if (leisure === "park")            return { category: "nature", kind: "park" };
  if (leisure === "garden")          return { category: "nature", kind: "garden" };
  if (leisure === "beach_resort")    return { category: "nature", kind: "beach" };
  if (leisure === "nature_reserve")  return { category: "nature", kind: "reserve" };

  return null;
}

// ── Geo helpers ─────────────────────────────────────────────────────────────

const EARTH_R_M = 6_371_000;
function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const s = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_R_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

const DEDUP_RADIUS_M = 30;

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Tag → place row helpers ─────────────────────────────────────────────────

function coords(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  // ways/relations come back with a `center` (because we used `out center`)
  // — Overpass nests lng under either `lng` or `lon` depending on schema, so
  // we accept either.
  const c = (el as unknown as { center?: { lat: number; lng?: number; lon?: number } }).center;
  if (c && typeof c.lat === "number") {
    const lng = typeof c.lng === "number" ? c.lng : typeof c.lon === "number" ? c.lon : null;
    if (lng != null) return { lat: c.lat, lng };
  }
  return null;
}

function parseOpeningHours(raw: string | undefined): string[] | null {
  if (!raw) return null;
  // Keep the OSM opening_hours expression as-is; downstream isOpenNow is more
  // strict so we store it under a single-entry array tagged with a marker
  // (consumers can parse later). Saved as `[raw]` keeps the column shape valid.
  return [raw];
}

function buildTagsArray(t: Record<string, string>): string[] {
  // Carry over the most useful OSM tags as Arabic/English keywords so the
  // existing cuisine_* / vibe_* predicates trigger. We DO NOT dump every tag
  // — only the few that downstream filters look at.
  const out: string[] = [];
  const cuisine = (t.cuisine ?? "").toLowerCase();
  if (cuisine) out.push(...cuisine.split(/[;,]/).map((s) => s.trim()).filter(Boolean));
  if (t.amenity)  out.push(t.amenity);
  if (t.tourism)  out.push(t.tourism);
  if (t.leisure)  out.push(t.leisure);
  if (t.shop)     out.push(t.shop);
  if (t["diet:vegan"] === "yes") out.push("vegan");
  if (t["diet:vegetarian"] === "yes") out.push("vegetarian");
  if (t["diet:halal"] === "yes") out.push("halal");
  if (t.outdoor_seating === "yes") out.push("outdoor");
  if (t.takeaway === "yes") out.push("takeaway");
  if (t.delivery === "yes") out.push("delivery");
  return Array.from(new Set(out.filter(Boolean)));
}

function buildAddress(t: Record<string, string>): string | null {
  const parts = [
    [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ").trim(),
    t["addr:city"],
    t["addr:postcode"],
  ].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

async function fetchExistingForCity(cityKey: string): Promise<ExistingPlace[]> {
  const all: ExistingPlace[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("places")
      .select("id,name,lat,lng")
      .eq("city", cityKey)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetchExisting ${cityKey}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as ExistingPlace[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

function isDuplicate(candidate: ClassifiedPlace, existing: ExistingPlace[]): boolean {
  const target = normName(candidate.name);
  for (const e of existing) {
    if (!e.name || e.lat == null || e.lng == null) continue;
    if (normName(e.name) !== target) continue;
    if (haversineMeters(candidate.lat, candidate.lng, e.lat, e.lng) <= DEDUP_RADIUS_M) {
      return true;
    }
  }
  return false;
}

// Also dedup the OSM batch against itself before insert (some POIs sit on
// multiple OSM objects — e.g. a node and a way for the same museum).
function dedupBatch(rows: ClassifiedPlace[]): ClassifiedPlace[] {
  const out: ClassifiedPlace[] = [];
  for (const r of rows) {
    if (!isDuplicate(r, out as unknown as ExistingPlace[])) {
      out.push(r);
    }
  }
  return out;
}

async function insertBatches(rows: ClassifiedPlace[]): Promise<{ ok: number; fail: number }> {
  let ok = 0;
  let fail = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH).map((p) => ({
      google_place_id: null,
      external_source: "osm",
      name: p.name,
      category: p.category,
      kind: p.kind,
      city: p.city,
      city_label: p.city_label,
      lat: p.lat,
      lng: p.lng,
      address: p.address,
      phone: p.phone,
      website: p.website,
      cost_currency: p.cost_currency,
      cost_confidence: "low" as Confidence,
      opening_hours: p.opening_hours,
      tags: p.tags,
      highlights: p.highlights,
      is_editor_pick: false,
      data_freshness: new Date().toISOString(),
    }));
    const { error, data } = await supabase
      .from("places")
      .insert(slice)
      .select("id");
    if (error) {
      fail += slice.length;
      console.error(`  ✗ insert batch failed: ${error.message}`);
    } else {
      ok += data?.length ?? slice.length;
    }
  }
  return { ok, fail };
}

async function processCity(city: CityCfg): Promise<void> {
  console.log(`\n→ ${city.label} — querying Overpass…`);
  const elements = await fetchOverpass(city);
  console.log(`  Overpass returned ${elements.length} elements`);

  const candidates: ClassifiedPlace[] = [];
  let skippedNoName = 0;
  let skippedNoClass = 0;
  let skippedNoCoords = 0;

  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = (tags.name ?? tags["name:en"] ?? tags["name:fr"] ?? tags["name:ar"] ?? "").trim();
    if (!name) { skippedNoName++; continue; }
    const cls = classify(tags);
    if (!cls) { skippedNoClass++; continue; }
    const xy = coords(el);
    if (!xy) { skippedNoCoords++; continue; }

    candidates.push({
      name,
      category: cls.category,
      kind: cls.kind,
      lat: xy.lat,
      lng: xy.lng,
      city: city.key,
      city_label: city.label,
      cost_currency: city.currency,
      tags: buildTagsArray(tags),
      highlights: [],
      address: buildAddress(tags),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      website: tags.website ?? tags["contact:website"] ?? null,
      opening_hours: parseOpeningHours(tags.opening_hours),
    });
  }

  const selfDeduped = dedupBatch(candidates);
  const droppedSelf = candidates.length - selfDeduped.length;

  console.log(`  Classified ${candidates.length} (skipped: ${skippedNoName} unnamed, ${skippedNoClass} unclassified, ${skippedNoCoords} no-coords); ${droppedSelf} OSM-internal duplicates`);

  console.log(`  Fetching existing rows for ${city.key}…`);
  const existing = await fetchExistingForCity(city.key);
  console.log(`  ${existing.length} existing places in ${city.label}`);

  const fresh: ClassifiedPlace[] = [];
  let dupes = 0;
  for (const c of selfDeduped) {
    if (isDuplicate(c, existing)) {
      dupes++;
    } else {
      fresh.push(c);
    }
  }

  console.log(`  Inserting ${fresh.length} new rows in batches of 100…`);
  const { ok, fail } = await insertBatches(fresh);
  console.log(`[${city.label}] +${ok} جديد · -${dupes} مكرر · ${fail} خطأ`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

(async () => {
  console.log("Overpass expansion starting — Data © OpenStreetMap contributors (ODbL)");
  for (let i = 0; i < CITIES.length; i++) {
    const city = CITIES[i];
    try {
      await processCity(city);
    } catch (err) {
      console.error(`✗ ${city.label} failed:`, err instanceof Error ? err.message : err);
    }
    if (i < CITIES.length - 1) {
      console.log(`  …sleeping ${Math.round(RATE_LIMIT_PAUSE_MS / 1000)}s before next city (Overpass fair-use)`);
      await sleep(RATE_LIMIT_PAUSE_MS);
    }
  }
  console.log("\nDone.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
