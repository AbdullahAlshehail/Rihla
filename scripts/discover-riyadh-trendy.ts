// Targeted discovery: trendy NEW coffee + patisserie + dessert in NORTH Riyadh.
// Uses Google Places Text Search (Legacy). Dedupes against existing
// google_place_ids in the DB so we never re-insert. Bbox filter so we don't
// pollute Riyadh's catalogue with results far from the user's target area.
//
// Run:  npx tsx scripts/discover-riyadh-trendy.ts > /tmp/trendy.sql 2> /tmp/trendy.log
import { config } from "dotenv"; config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) { console.error("missing GOOGLE_MAPS_API_KEY"); process.exit(1); }

// North Riyadh — covers Hittin, Mohammadiyah, Sahafa, Yasmin, Narjis, Malqa,
// Aqiq, Olaya north, KAFD area, etc.
const BBOX = { latMin: 24.74, latMax: 24.90, lngMin: 46.50, lngMax: 46.80 };

type Cat = "coffee" | "sweet";
const QUERIES: { q: string; category: Cat; kind: string }[] = [
  // Specialty coffee — English + Arabic mix
  { q: "specialty coffee north Riyadh",                category: "coffee", kind: "specialty" },
  { q: "third wave coffee Riyadh",                     category: "coffee", kind: "specialty" },
  { q: "coffee roaster Riyadh",                        category: "coffee", kind: "roastery" },
  { q: "trendy cafe Hittin Riyadh",                    category: "coffee", kind: "specialty" },
  { q: "best new coffee shop Sahafa Riyadh",           category: "coffee", kind: "specialty" },
  { q: "specialty cafe Al Malqa Riyadh",               category: "coffee", kind: "specialty" },
  { q: "modern coffee shop Yasmin Riyadh",             category: "coffee", kind: "specialty" },
  { q: "قهوة مختصة شمال الرياض",                       category: "coffee", kind: "specialty" },
  { q: "كافيه جديد الرياض",                            category: "coffee", kind: "cafe" },
  { q: "كافيه ترند الرياض",                            category: "coffee", kind: "specialty" },
  // Patisserie + sweet
  { q: "best patisserie Riyadh",                       category: "sweet",  kind: "patisserie" },
  { q: "trendy bakery Riyadh",                         category: "sweet",  kind: "bakery" },
  { q: "croissant Riyadh",                             category: "sweet",  kind: "patisserie" },
  { q: "luxury dessert Riyadh",                        category: "sweet",  kind: "dessert" },
  { q: "بيستري الرياض",                                 category: "sweet",  kind: "patisserie" },
  { q: "حلا فاخر الرياض",                              category: "sweet",  kind: "dessert" },
  { q: "كروسون الرياض",                                category: "sweet",  kind: "patisserie" },
];

const RIYADH_CENTER = { lat: 24.7136, lng: 46.6753 };

// Min trust thresholds — relaxed enough for newer places, tight enough to
// filter junk.
const MIN_RATING = 4.4;
const MIN_REVIEWS = 50;
const MAX_REVIEWS = 5000;  // anything >5k is a chain / tourist trap, not "trendy new"

type TextSearchResult = {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  price_level?: number;
  types?: string[];
  photos?: { photo_reference: string }[];
  business_status?: string;
};

async function textSearch(query: string): Promise<TextSearchResult[]> {
  const u = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  u.searchParams.set("query", query);
  u.searchParams.set("location", `${RIYADH_CENTER.lat},${RIYADH_CENTER.lng}`);
  u.searchParams.set("radius", "30000"); // 30km
  u.searchParams.set("language", "ar");
  u.searchParams.set("key", KEY!);
  const r = await fetch(u.toString());
  const data = await r.json();
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    console.error(`[${query}] ${data.status}: ${data.error_message ?? ""}`);
    return [];
  }
  return (data.results ?? []) as TextSearchResult[];
}

function inBbox(lat: number, lng: number): boolean {
  return lat >= BBOX.latMin && lat <= BBOX.latMax && lng >= BBOX.lngMin && lng <= BBOX.lngMax;
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

function buildPhotoUrl(ref: string): string {
  return `/api/photo?ref=${ref}&w=800`;
}

(async () => {
  const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createClient(URL_, SVC, { auth: { persistSession: false } });

  // Pull every existing google_place_id so we never re-insert
  const { data: existing } = await sb.from("places").select("google_place_id");
  const known = new Set((existing ?? []).map((r) => r.google_place_id).filter(Boolean) as string[]);
  console.error(`Known place_ids: ${known.size}`);

  type Candidate = {
    google_place_id: string;
    name: string;
    category: Cat;
    kind: string;
    address: string;
    lat: number;
    lng: number;
    rating: number;
    review_count: number;
    price_level: number | null;
    photo_url: string | null;
  };
  const candidates = new Map<string, Candidate>();
  const stats = { queries: 0, results: 0, accepted: 0, dupes: 0, outOfBbox: 0, lowRated: 0 };

  for (const { q, category, kind } of QUERIES) {
    stats.queries++;
    const results = await textSearch(q);
    stats.results += results.length;
    for (const r of results) {
      if (!r.place_id || !r.geometry?.location) continue;
      if (known.has(r.place_id) || candidates.has(r.place_id)) { stats.dupes++; continue; }
      const { lat, lng } = r.geometry.location;
      if (!inBbox(lat, lng)) { stats.outOfBbox++; continue; }
      const rating = r.rating ?? 0;
      const reviews = r.user_ratings_total ?? 0;
      if (rating < MIN_RATING || reviews < MIN_REVIEWS || reviews > MAX_REVIEWS) {
        stats.lowRated++;
        continue;
      }
      if (r.business_status && r.business_status !== "OPERATIONAL") continue;
      const photoRef = r.photos?.[0]?.photo_reference;
      candidates.set(r.place_id, {
        google_place_id: r.place_id,
        name: r.name,
        category,
        kind,
        address: r.formatted_address ?? "",
        lat, lng,
        rating, review_count: reviews,
        price_level: r.price_level ?? null,
        photo_url: photoRef ? buildPhotoUrl(photoRef) : null,
      });
      stats.accepted++;
    }
  }

  console.error(`\nStats: ${JSON.stringify(stats, null, 2)}`);
  console.error(`Final new candidates: ${candidates.size}`);

  // Emit INSERT SQL — matches the schema used by apply-mass-sql.ts
  console.log(`-- Generated ${candidates.size} candidates from ${stats.queries} queries`);
  console.log(`-- Run via: npx tsx scripts/apply-mass-sql.ts (after copying to /tmp/mass.sql)`);
  for (const c of candidates.values()) {
    const cols = [
      escSql(c.name),
      "riyadh",
      "الرياض",
      c.category,
      c.kind,
      c.address ? `'${escSql(c.address)}'` : "NULL",
      c.lat,
      c.lng,
      c.rating,
      c.review_count,
      c.price_level ?? "NULL",
      c.photo_url ? `'${escSql(c.photo_url)}'` : "NULL",
      c.google_place_id,
      "google_text_search",
      "SAR",
      "medium",
      "NOW()",
      "false",
    ];
    const line = `INSERT INTO places (name, city, city_label, category, kind, address, lat, lng, rating, review_count, price_level, photo_url, google_place_id, external_source, cost_currency, cost_confidence, data_freshness, is_editor_pick) VALUES ('${cols[0]}', '${cols[1]}', '${cols[2]}', '${cols[3]}', '${cols[4]}', ${cols[5]}, ${cols[6]}, ${cols[7]}, ${cols[8]}, ${cols[9]}, ${cols[10]}, ${cols[11]}, '${cols[12]}', '${cols[13]}', '${cols[14]}', '${cols[15]}', ${cols[16]}, ${cols[17]}) ON CONFLICT (google_place_id) DO NOTHING;`;
    console.log(line);
  }
})().catch((e) => { console.error(e); process.exit(1); });
