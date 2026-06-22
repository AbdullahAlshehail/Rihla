// ──────────────────────────────────────────────────────────────────────
// Fetch Overpass POIs for 4 cities and dump as JSON (no DB writes).
// Lets us run the heavy network part without the Supabase service key —
// the dedup+insert pass runs separately via Supabase MCP.
//
// Run:  npx tsx scripts/overpass-dump.ts > /tmp/overpass.json
// Data © OpenStreetMap contributors (ODbL)
// ──────────────────────────────────────────────────────────────────────

type Category = "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar";
type Currency = "EUR" | "SAR";

type CityCfg = {
  key: string;
  label: string;
  bbox: [number, number, number, number]; // S, W, N, E
  currency: Currency;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon?: number; lng?: number };
  tags?: Record<string, string>;
};

type OverpassResponse = { elements?: OverpassElement[] };

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
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string[] | null;
  osm_image?: string | null;       // image tag value (URL) if present
  osm_wikidata?: string | null;    // Q-id if present
  osm_commons?: string | null;     // Commons category if present
};

const CITIES: CityCfg[] = [
  { key: "nice",   label: "Nice",   bbox: [43.65, 7.20, 43.76, 7.32], currency: "EUR" },
  { key: "monaco", label: "Monaco", bbox: [43.72, 7.40, 43.76, 7.45], currency: "EUR" },
  { key: "cannes", label: "Cannes", bbox: [43.52, 6.95, 43.59, 7.10], currency: "EUR" },
  { key: "riyadh", label: "Riyadh", bbox: [24.55, 46.50, 24.90, 46.95], currency: "SAR" },
];

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const RATE_LIMIT_PAUSE_MS = 65_000;
const REQUEST_TIMEOUT_MS = 180_000;

const CUISINE_MAP: Record<string, string> = {
  italian: "italian", pizza: "pizzeria",
  french: "french", japanese: "japanese", sushi: "japanese",
  chinese: "chinese", korean: "korean", thai: "thai",
  indian: "indian", lebanese: "lebanese",
  saudi: "saudi", najdi: "najdi", yemeni: "yemeni",
  turkish: "turkish", greek: "greek",
  mexican: "mexican", peruvian: "peruvian",
  british: "british", mediterranean: "mediterranean",
  seafood: "seafood", steak: "steakhouse", steak_house: "steakhouse",
  burger: "burger", vegan: "vegan", vegetarian: "vegan",
  brunch: "brunch", bistro: "bistro", brasserie: "brasserie",
  fine_dining: "fine_dining", tapas: "tapas", gastropub: "gastropub",
};

function buildQuery(bbox: [number, number, number, number]): string {
  const bb = bbox.join(",");
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

async function fetchCity(city: CityCfg): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(buildQuery(city.bbox))}`;
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
      console.error(`  ✗ Overpass HTTP ${r.status} for ${city.key}`);
      return [];
    }
    const json = (await r.json()) as OverpassResponse;
    return json.elements ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function pickCuisineKind(tag: string | undefined): string | null {
  if (!tag) return null;
  for (const p of tag.toLowerCase().split(/[;,]/).map((s) => s.trim())) {
    if (CUISINE_MAP[p]) return CUISINE_MAP[p];
  }
  return null;
}

function classify(t: Record<string, string>): { category: Category; kind: string | null } | null {
  const a = t.amenity, to = t.tourism, l = t.leisure, s = t.shop;
  if (a === "cafe") return { category: "coffee", kind: "cafe" };
  if (s === "coffee") return { category: "coffee", kind: "specialty" };
  if (a === "ice_cream") return { category: "sweet", kind: "icecream" };
  if (s === "bakery") return { category: "sweet", kind: "bakery" };
  if (s === "pastry") return { category: "sweet", kind: "patisserie" };
  if (s === "chocolate") return { category: "sweet", kind: "chocolate" };
  if (s === "confectionery") return { category: "sweet", kind: "confectionery" };
  if (a === "bar") return { category: "bar", kind: "cocktail" };
  if (a === "pub") return { category: "bar", kind: "pub" };
  if (a === "nightclub") return { category: "bar", kind: "nightclub" };
  if (a === "restaurant" || a === "fast_food") {
    const c = pickCuisineKind(t.cuisine);
    return { category: "food", kind: c ?? (a === "fast_food" ? "fast_food" : "general") };
  }
  if (to === "museum") return { category: "sight", kind: "museum" };
  if (to === "gallery") return { category: "sight", kind: "gallery" };
  if (to === "viewpoint") return { category: "sight", kind: "viewpoint" };
  if (to === "attraction") return { category: "sight", kind: "landmark" };
  if (to === "artwork") return { category: "sight", kind: "artwork" };
  if (l === "park") return { category: "nature", kind: "park" };
  if (l === "garden") return { category: "nature", kind: "garden" };
  if (l === "beach_resort") return { category: "nature", kind: "beach" };
  if (l === "nature_reserve") return { category: "nature", kind: "reserve" };
  return null;
}

function coords(el: OverpassElement): { lat: number; lng: number } | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") return { lat: el.lat, lng: el.lon };
  const c = el.center;
  if (c && typeof c.lat === "number") {
    const lng = typeof c.lng === "number" ? c.lng : typeof c.lon === "number" ? c.lon : null;
    if (lng != null) return { lat: c.lat, lng };
  }
  return null;
}

function buildTags(t: Record<string, string>): string[] {
  const out: string[] = [];
  if (t.cuisine) out.push(...t.cuisine.toLowerCase().split(/[;,]/).map((s) => s.trim()).filter(Boolean));
  if (t.amenity) out.push(t.amenity);
  if (t.tourism) out.push(t.tourism);
  if (t.leisure) out.push(t.leisure);
  if (t.shop) out.push(t.shop);
  if (t["diet:vegan"] === "yes") out.push("vegan");
  if (t["diet:vegetarian"] === "yes") out.push("vegetarian");
  if (t["diet:halal"] === "yes") out.push("halal");
  if (t.outdoor_seating === "yes") out.push("outdoor");
  if (t.takeaway === "yes") out.push("takeaway");
  return Array.from(new Set(out.filter(Boolean)));
}

function buildAddress(t: Record<string, string>): string | null {
  const parts = [
    [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ").trim(),
    t["addr:city"], t["addr:postcode"],
  ].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

function dedupSelf(rows: ClassifiedPlace[]): ClassifiedPlace[] {
  const seen = new Map<string, ClassifiedPlace>();
  for (const r of rows) {
    const k = `${r.name.toLowerCase().trim().replace(/\s+/g, " ")}|${r.lat.toFixed(4)}|${r.lng.toFixed(4)}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return Array.from(seen.values());
}

async function processCity(city: CityCfg): Promise<ClassifiedPlace[]> {
  console.error(`→ ${city.label} — querying Overpass…`);
  const els = await fetchCity(city);
  console.error(`  Overpass returned ${els.length} elements`);

  const classified: ClassifiedPlace[] = [];
  let skippedUnnamed = 0, skippedUnclassified = 0, skippedNoCoords = 0;
  for (const el of els) {
    const tags = el.tags ?? {};
    const name = tags.name?.trim();
    if (!name) { skippedUnnamed++; continue; }
    const c = classify(tags);
    if (!c) { skippedUnclassified++; continue; }
    const xy = coords(el);
    if (!xy) { skippedNoCoords++; continue; }
    classified.push({
      name,
      category: c.category,
      kind: c.kind,
      lat: xy.lat,
      lng: xy.lng,
      city: city.key,
      city_label: city.label,
      cost_currency: city.currency,
      tags: buildTags(tags),
      address: buildAddress(tags),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      website: tags.website ?? tags["contact:website"] ?? null,
      opening_hours: tags.opening_hours ? [tags.opening_hours] : null,
      osm_image: tags.image ?? null,
      osm_wikidata: tags.wikidata ?? null,
      osm_commons: tags.wikimedia_commons ?? null,
    });
  }
  const deduped = dedupSelf(classified);
  console.error(`  Classified ${classified.length} (skipped: ${skippedUnnamed} unnamed, ${skippedUnclassified} unclassified, ${skippedNoCoords} no-coords); ${classified.length - deduped.length} self-dupes`);
  return deduped;
}

async function main() {
  const all: Record<string, ClassifiedPlace[]> = {};
  for (let i = 0; i < CITIES.length; i++) {
    const city = CITIES[i];
    all[city.key] = await processCity(city);
    if (i < CITIES.length - 1) {
      console.error(`  …sleeping 65s before next city (Overpass fair-use)`);
      await new Promise((res) => setTimeout(res, RATE_LIMIT_PAUSE_MS));
    }
  }
  console.error(`\n✓ Done. Cities:`);
  for (const [k, v] of Object.entries(all)) console.error(`  ${k}: ${v.length}`);
  // Single JSON to stdout
  console.log(JSON.stringify(all, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
