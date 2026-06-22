// Targeted discovery — wave 2:
//  (a) more Riyadh cafes outside north Riyadh
//  (b) Riviera (Cannes/Monaco/Nice): restaurants, cafes, patisseries, sweets
//  (c) Real entertainment venues (theaters, operas, casinos, concert halls)
//
// Run:  npx tsx scripts/discover-riviera-plus.ts > /tmp/wave2.sql 2> /tmp/wave2.log
import { config } from "dotenv"; config({ path: ".env.local" });

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("missing GOOGLE_MAPS_API_KEY"); process.exit(1); }

type Cat = "food" | "coffee" | "sweet" | "event";

type CityCfg = {
  cityKey: string;
  cityLabel: string;
  center: { lat: number; lng: number };
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
  queries: { q: string; category: Cat; kind: string }[];
};

const CITIES: CityCfg[] = [
  {
    cityKey: "riyadh",
    cityLabel: "الرياض",
    center: { lat: 24.7136, lng: 46.6753 },
    bbox: { latMin: 24.55, latMax: 24.92, lngMin: 46.45, lngMax: 46.95 }, // broader Riyadh
    queries: [
      // More cafes — covers wider Riyadh
      { q: "specialty coffee Olaya Riyadh",        category: "coffee", kind: "specialty" },
      { q: "specialty coffee Diplomatic Quarter",  category: "coffee", kind: "specialty" },
      { q: "best new cafe Boulevard Riyadh",       category: "coffee", kind: "specialty" },
      { q: "coffee shop Riyadh Front",             category: "coffee", kind: "specialty" },
      { q: "cafe with view Riyadh",                category: "coffee", kind: "rooftop" },
      { q: "matcha cafe Riyadh",                   category: "coffee", kind: "specialty" },
      { q: "garden cafe Riyadh",                   category: "coffee", kind: "specialty" },
      { q: "rooftop cafe Riyadh",                  category: "coffee", kind: "rooftop" },
      { q: "قهوة سعودية الرياض",                    category: "coffee", kind: "specialty" },
      { q: "كافيه مخفي الرياض",                    category: "coffee", kind: "specialty" },
    ],
  },
  {
    cityKey: "cannes",
    cityLabel: "كان",
    center: { lat: 43.5528, lng: 7.0174 },
    bbox: { latMin: 43.52, latMax: 43.58, lngMin: 6.97, lngMax: 7.07 },
    queries: [
      // Restaurants
      { q: "best restaurants Cannes",              category: "food",   kind: "general" },
      { q: "Michelin restaurant Cannes",           category: "food",   kind: "michelin" },
      { q: "Italian restaurant Cannes",            category: "food",   kind: "italian" },
      { q: "seafood restaurant Cannes",            category: "food",   kind: "seafood" },
      { q: "bistro Cannes",                        category: "food",   kind: "bistro" },
      { q: "brunch Cannes",                        category: "food",   kind: "brunch" },
      // Cafes
      { q: "specialty coffee Cannes",              category: "coffee", kind: "specialty" },
      { q: "coffee shop Cannes",                   category: "coffee", kind: "cafe" },
      { q: "rooftop cafe Cannes",                  category: "coffee", kind: "rooftop" },
      // Sweets / Patisseries
      { q: "best patisserie Cannes",               category: "sweet",  kind: "patisserie" },
      { q: "boulangerie Cannes",                   category: "sweet",  kind: "bakery" },
      { q: "ice cream Cannes",                     category: "sweet",  kind: "icecream" },
      { q: "chocolate shop Cannes",                category: "sweet",  kind: "chocolate" },
      // Real entertainment
      { q: "Théâtre Croisette Cannes",             category: "event",  kind: "theatre" },
      { q: "Palais des Festivals Cannes events",   category: "event",  kind: "show" },
      { q: "Cinéma Les Arcades Cannes",            category: "event",  kind: "show" },
    ],
  },
  {
    cityKey: "nice",
    cityLabel: "نيس",
    center: { lat: 43.7102, lng: 7.262 },
    bbox: { latMin: 43.66, latMax: 43.76, lngMin: 7.20, lngMax: 7.34 },
    queries: [
      // Restaurants
      { q: "best restaurants Nice France",         category: "food",   kind: "general" },
      { q: "fine dining Nice",                     category: "food",   kind: "fine_dining" },
      { q: "Michelin restaurant Nice",             category: "food",   kind: "michelin" },
      { q: "Italian restaurant Nice",              category: "food",   kind: "italian" },
      { q: "seafood restaurant Nice",              category: "food",   kind: "seafood" },
      { q: "Niçois restaurant Nice",               category: "food",   kind: "nicois" },
      { q: "tapas Nice",                           category: "food",   kind: "tapas" },
      { q: "vegan restaurant Nice",                category: "food",   kind: "vegan" },
      // Cafes
      { q: "specialty coffee Nice France",         category: "coffee", kind: "specialty" },
      { q: "best coffee shop Vieux Nice",          category: "coffee", kind: "cafe" },
      { q: "third wave coffee Nice",               category: "coffee", kind: "specialty" },
      // Sweets
      { q: "best patisserie Nice France",          category: "sweet",  kind: "patisserie" },
      { q: "gelato Nice",                          category: "sweet",  kind: "icecream" },
      { q: "boulangerie artisanale Nice",          category: "sweet",  kind: "bakery" },
      { q: "chocolatier Nice",                     category: "sweet",  kind: "chocolate" },
      // Real entertainment
      { q: "Opéra de Nice",                        category: "event",  kind: "theatre" },
      { q: "Théâtre National de Nice",             category: "event",  kind: "theatre" },
      { q: "Acropolis Nice events",                category: "event",  kind: "show" },
    ],
  },
  {
    cityKey: "monaco",
    cityLabel: "موناكو",
    center: { lat: 43.7384, lng: 7.4246 },
    bbox: { latMin: 43.72, latMax: 43.76, lngMin: 7.40, lngMax: 7.45 },
    queries: [
      // Restaurants
      { q: "best restaurants Monaco",              category: "food",   kind: "general" },
      { q: "Michelin restaurant Monaco",           category: "food",   kind: "michelin" },
      { q: "fine dining Monte Carlo",              category: "food",   kind: "fine_dining" },
      { q: "Italian restaurant Monaco",            category: "food",   kind: "italian" },
      { q: "seafood restaurant Monaco",            category: "food",   kind: "seafood" },
      { q: "brunch Monaco",                        category: "food",   kind: "brunch" },
      // Cafes
      { q: "best cafe Monaco",                     category: "coffee", kind: "cafe" },
      { q: "specialty coffee Monaco",              category: "coffee", kind: "specialty" },
      // Sweets
      { q: "patisserie Monaco",                    category: "sweet",  kind: "patisserie" },
      { q: "chocolate shop Monte Carlo",           category: "sweet",  kind: "chocolate" },
      { q: "gelato Monaco",                        category: "sweet",  kind: "icecream" },
      // Real entertainment — MUST capture Monte-Carlo iconic venues
      { q: "Casino de Monte-Carlo",                category: "event",  kind: "casino" },
      { q: "Opéra de Monte-Carlo",                 category: "event",  kind: "theatre" },
      { q: "Salle Garnier Monaco",                 category: "event",  kind: "theatre" },
      { q: "Théâtre Princesse Grace Monaco",       category: "event",  kind: "theatre" },
      { q: "Grimaldi Forum events",                category: "event",  kind: "show" },
    ],
  },
];

// Quality thresholds — relaxed for entertainment (some have fewer reviews
// despite being iconic), tight for food / coffee / sweet.
const THRESHOLDS = {
  food:   { minRating: 4.4, minReviews: 100, maxReviews: 8000 },
  coffee: { minRating: 4.4, minReviews: 50,  maxReviews: 5000 },
  sweet:  { minRating: 4.4, minReviews: 50,  maxReviews: 5000 },
  event:  { minRating: 4.2, minReviews: 30,  maxReviews: 50000 },
};

type TextSearchResult = {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  business_status?: string;
};

async function textSearch(query: string, center: { lat: number; lng: number }, lang = "en"): Promise<TextSearchResult[]> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  u.searchParams.set("query", query);
  u.searchParams.set("location", `${center.lat},${center.lng}`);
  u.searchParams.set("radius", "20000");
  u.searchParams.set("language", lang);
  u.searchParams.set("key", KEY!);
  const r = await fetch(u.toString());
  const data = await r.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.error(`[${query}] ${data.status}: ${data.error_message ?? ""}`);
    return [];
  }
  return (data.results ?? []) as TextSearchResult[];
}

function inBbox(lat: number, lng: number, b: CityCfg["bbox"]): boolean {
  return lat >= b.latMin && lat <= b.latMax && lng >= b.lngMin && lng <= b.lngMax;
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

(async () => {
  const stats = {
    queries: 0,
    rawResults: 0,
    accepted: 0,
    dupes: 0,
    outOfBbox: 0,
    belowThreshold: 0,
    nonOperational: 0,
  };
  type Candidate = {
    google_place_id: string;
    name: string;
    city: string;
    cityLabel: string;
    category: Cat;
    kind: string;
    address: string;
    lat: number;
    lng: number;
    rating: number;
    review_count: number;
    price_level: number | null;
  };
  const all = new Map<string, Candidate>();

  for (const city of CITIES) {
    console.error(`\n=== ${city.cityKey.toUpperCase()} (${city.queries.length} queries) ===`);
    const lang = city.cityKey === "riyadh" ? "ar" : "en";
    for (const { q, category, kind } of city.queries) {
      stats.queries++;
      const results = await textSearch(q, city.center, lang);
      stats.rawResults += results.length;
      for (const r of results) {
        if (!r.place_id || !r.geometry?.location) continue;
        if (all.has(r.place_id)) { stats.dupes++; continue; }
        const { lat, lng } = r.geometry.location;
        if (!inBbox(lat, lng, city.bbox)) { stats.outOfBbox++; continue; }
        const rating = r.rating ?? 0;
        const reviews = r.user_ratings_total ?? 0;
        const th = THRESHOLDS[category];
        if (rating < th.minRating || reviews < th.minReviews || reviews > th.maxReviews) {
          stats.belowThreshold++; continue;
        }
        if (r.business_status && r.business_status !== "OPERATIONAL") {
          stats.nonOperational++; continue;
        }
        all.set(r.place_id, {
          google_place_id: r.place_id,
          name: r.name,
          city: city.cityKey,
          cityLabel: city.cityLabel,
          category,
          kind,
          address: r.formatted_address ?? "",
          lat, lng,
          rating, review_count: reviews,
          price_level: r.price_level ?? null,
        });
        stats.accepted++;
      }
    }
  }

  console.error(`\nFINAL STATS:\n${JSON.stringify(stats, null, 2)}\nUnique candidates: ${all.size}`);

  // Emit compact SQL (no photo_url — populates via enrichment on first card open)
  console.log(`-- Generated ${all.size} candidates across ${CITIES.length} cities`);
  for (const c of all.values()) {
    const currency = c.city === "riyadh" ? "SAR" : "EUR";
    const cols = [
      `'${escSql(c.name)}'`,
      `'${c.city}'`,
      `'${c.cityLabel}'`,
      `'${c.category}'`,
      `'${c.kind}'`,
      c.address ? `'${escSql(c.address)}'` : "NULL",
      c.lat,
      c.lng,
      c.rating,
      c.review_count,
      c.price_level ?? "NULL",
      "NULL", // photo_url — enriches on open
      `'${c.google_place_id}'`,
      "'google_text_search'",
      `'${currency}'`,
      "'medium'",
      "NOW()",
      "false",
    ];
    console.log(`INSERT INTO places (name, city, city_label, category, kind, address, lat, lng, rating, review_count, price_level, photo_url, google_place_id, external_source, cost_currency, cost_confidence, data_freshness, is_editor_pick) VALUES (${cols.join(", ")}) ON CONFLICT (google_place_id) DO NOTHING;`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
