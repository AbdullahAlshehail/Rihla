// Bulk catalogue builder: hits Google Places Text Search across many category
// queries per city, dedups by google_place_id, filters to the city's bbox,
// and emits INSERT SQL. Targets 200+ places per city across all categories.
//
// Run:  npx tsx scripts/discover-mass-cities.ts > /tmp/mass.sql 2> /tmp/mass.log
import { config } from "dotenv"; config({ path: ".env.local" });
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("missing key"); process.exit(1); }

type Cat = "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar";

type CityCfg = {
  key: string;
  label: string;
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  queries: { q: string; category: Cat; kind: string }[];
};

const FOOD_KINDS: Record<string, string> = {
  italian: "italian", french: "french", japanese: "japanese", sushi: "japanese",
  mediterranean: "mediterranean", lebanese: "lebanese", seafood: "seafood",
  steak: "steakhouse", pizza: "pizzeria", vegan: "vegan", indian: "indian",
  chinese: "chinese", burger: "burger", brunch: "brunch", bistro: "bistro",
  nicois: "nicois", brasserie: "brasserie", peruvian: "peruvian",
  fine: "fine_dining", saudi: "saudi", yemeni: "yemeni", thai: "thai",
  mexican: "mexican", greek: "greek", korean: "korean", turkish: "turkish",
  british: "british", gastropub: "gastropub", tapas: "tapas",
};

function buildQueries(city: string, isRiyadh = false, isLondon = false): { q: string; category: Cat; kind: string }[] {
  const out: { q: string; category: Cat; kind: string }[] = [];
  // FOOD
  const foodQs = [
    "best restaurants",
    "Italian restaurant",
    "French restaurant",
    "Japanese restaurant",
    "sushi",
    "Mediterranean restaurant",
    "Lebanese restaurant",
    "seafood",
    "steakhouse",
    "pizzeria",
    "vegan restaurant",
    "Indian restaurant",
    "Chinese restaurant",
    "burger",
    "brunch",
    "bistro",
    "fine dining",
    "Thai restaurant",
    "Korean restaurant",
    "tapas",
  ];
  if (isRiyadh) foodQs.push("Saudi restaurant", "Najdi restaurant", "Yemeni restaurant", "Turkish restaurant", "Lebanese restaurant");
  if (isLondon) foodQs.push("British pub", "fish and chips", "Mexican restaurant", "Greek restaurant", "gastropub");
  for (const q of foodQs) {
    const kindKey = Object.keys(FOOD_KINDS).find((k) => q.toLowerCase().includes(k)) ?? "general";
    out.push({ q: `${q} ${city}`, category: "food", kind: FOOD_KINDS[kindKey] ?? "general" });
  }
  // COFFEE
  for (const q of ["specialty coffee", "coffee shop", "espresso bar", "third wave coffee", "café"]) {
    out.push({ q: `${q} ${city}`, category: "coffee", kind: q.includes("specialty") || q.includes("third") ? "specialty" : "cafe" });
  }
  // SWEET
  for (const [q, kind] of [
    ["patisserie", "patisserie"], ["bakery", "bakery"], ["ice cream", "icecream"],
    ["chocolate shop", "chocolate"], ["gelato", "icecream"], ["dessert", "dessert"],
  ] as const) {
    out.push({ q: `${q} ${city}`, category: "sweet", kind });
  }
  // SIGHT
  const sightQs: [string, string][] = [
    ["museum", "museum"], ["landmark", "landmark"], ["church", "church"],
    ["cathedral", "cathedral"], ["viewpoint", "viewpoint"], ["monument", "monument"],
    ["historical site", "historical"],
  ];
  if (isRiyadh) sightQs.push(["mosque", "mosque"]);
  if (isLondon) sightQs.push(["palace", "palace"], ["gallery", "gallery"], ["abbey", "abbey"], ["tower", "tower"]);
  for (const [q, kind] of sightQs) out.push({ q: `${q} ${city}`, category: "sight", kind });
  // NATURE
  const natureQs: [string, string][] = [
    ["park", "park"], ["garden", "garden"], ["promenade", "promenade"],
  ];
  if (!isRiyadh) natureQs.push(["beach", "beach"]);
  if (isRiyadh) natureQs.push(["wadi", "wadi"]);
  if (isLondon) natureQs.push(["green space", "park"]);
  for (const [q, kind] of natureQs) out.push({ q: `${q} ${city}`, category: "nature", kind });
  // EVENT
  for (const [q, kind] of [
    ["things to do", "activity"], ["tour", "tour"], ["theatre", "theatre"], ["show", "show"],
  ] as const) {
    out.push({ q: `${q} ${city}`, category: "event", kind });
  }
  // BAR (skip Riyadh — alcohol restriction; lounge/shisha instead)
  if (!isRiyadh) {
    for (const [q, kind] of [
      ["rooftop bar", "rooftop"], ["wine bar", "wine_bar"], ["cocktail bar", "cocktail"], ["speakeasy", "speakeasy"],
    ] as const) {
      out.push({ q: `${q} ${city}`, category: "bar", kind });
    }
  } else {
    out.push({ q: `shisha lounge ${city}`, category: "bar", kind: "shisha" });
  }
  return out;
}

const CITIES: CityCfg[] = [
  { key: "cannes",  label: "Cannes",  bbox: { latMin: 43.51, latMax: 43.59, lngMin: 6.93, lngMax: 7.10 }, queries: buildQueries("Cannes") },
  { key: "nice",    label: "Nice",    bbox: { latMin: 43.62, latMax: 43.78, lngMin: 7.15, lngMax: 7.42 }, queries: buildQueries("Nice France") },
  { key: "monaco",  label: "Monaco",  bbox: { latMin: 43.72, latMax: 43.76, lngMin: 7.40, lngMax: 7.46 }, queries: buildQueries("Monaco") },
  { key: "riyadh",  label: "Riyadh",  bbox: { latMin: 24.40, latMax: 25.10, lngMin: 46.40, lngMax: 47.00 }, queries: buildQueries("Riyadh", true) },
  { key: "london",  label: "London",  bbox: { latMin: 51.28, latMax: 51.70, lngMin: -0.55, lngMax: 0.30 }, queries: buildQueries("London", false, true) },
];

type Hit = {
  place_id: string;
  name?: string;
  rating?: number;
  user_ratings_total?: number;
  photos?: { photo_reference: string }[];
  geometry?: { location: { lat: number; lng: number } };
  formatted_address?: string;
  price_level?: number;
};

const sqlEscape = (s: string) => s.replace(/'/g, "''");
const photoUrl = (ref: string) => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_KEY}`;

async function search(query: string): Promise<Hit[]> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("language", "ar");
  const r = await fetch(url.toString());
  if (!r.ok) return [];
  const data = await r.json();
  if (data.status !== "OK" || !Array.isArray(data.results)) return [];
  return data.results as Hit[];
}

function inBbox(lat: number, lng: number, b: CityCfg["bbox"]): boolean {
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

(async () => {
  console.log("-- mass discovery");
  const totalByCity: Record<string, number> = {};
  const seenGlobal = new Set<string>();
  for (const city of CITIES) {
    let kept = 0;
    let queriesRun = 0;
    for (const { q, category, kind } of city.queries) {
      queriesRun++;
      const hits = await search(q);
      for (const h of hits) {
        if (seenGlobal.has(h.place_id)) continue;
        const lat = h.geometry?.location?.lat;
        const lng = h.geometry?.location?.lng;
        if (lat == null || lng == null) continue;
        if (!inBbox(lat, lng, city.bbox)) continue;
        if (!h.name) continue;
        if (!h.photos?.[0]?.photo_reference) continue;
        // Skip very low-rated places (likely not interesting)
        if (h.rating != null && h.rating < 3.6) continue;
        if (h.user_ratings_total != null && h.user_ratings_total < 30) continue;

        seenGlobal.add(h.place_id);
        const name = `${h.name}`;
        const address = h.formatted_address ?? null;
        const photo = photoUrl(h.photos[0].photo_reference);
        const rating = h.rating ?? null;
        const reviews = h.user_ratings_total ?? null;
        const price = h.price_level ?? null;
        const currency = (city.key === "riyadh") ? "SAR" : (city.key === "london") ? "GBP" : "EUR";

        console.log(
          `INSERT INTO places (name, city, city_label, category, kind, address, lat, lng, rating, review_count, price_level, photo_url, google_place_id, external_source, cost_currency, cost_confidence, data_freshness, is_editor_pick) ` +
          `VALUES ('${sqlEscape(name)}', '${city.key}', '${sqlEscape(city.label)}', '${category}', '${kind}', ${address ? `'${sqlEscape(address)}'` : "NULL"}, ${lat}, ${lng}, ${rating ?? "NULL"}, ${reviews ?? "NULL"}, ${price ?? "NULL"}, '${photo}', '${sqlEscape(h.place_id)}', 'mass_discovery_v1', '${currency}', 'medium', NOW(), false) ` +
          `ON CONFLICT (google_place_id) DO NOTHING;`
        );
        kept++;
      }
      // Tiny breathing room — Google rate limits at ~50 QPS per project.
      await new Promise((r) => setTimeout(r, 80));
    }
    totalByCity[city.key] = kept;
    console.error(`[${city.key}] ${queriesRun} queries → ${kept} new candidates`);
  }
  console.error("\n=== summary ===");
  for (const [k, v] of Object.entries(totalByCity)) console.error(`  ${k}: ${v}`);
})();
