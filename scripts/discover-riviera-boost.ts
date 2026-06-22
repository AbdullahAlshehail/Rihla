// Targeted catalogue boost for Monaco/Cannes/Nice — more restaurants + cafes,
// lower bar (3.5★, 20 reviews) so we capture well-known + emerging spots, not
// just the perfect-rating tail. Famous-name queries surface celebrity-chef and
// landmark restaurants explicitly.
import { config } from "dotenv"; config({ path: ".env.local" });
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("missing key"); process.exit(1); }

type Cat = "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar";

const cuisines = [
  // Mediterranean basket
  "best Italian restaurant", "trattoria", "osteria", "pasta", "pizzeria",
  "best French restaurant", "brasserie", "bistro", "bistrot", "gastronomique",
  "best Japanese restaurant", "sushi omakase", "ramen", "izakaya",
  "Mediterranean restaurant", "Greek restaurant", "tapas",
  // Asian wider
  "Korean BBQ", "Thai restaurant", "Vietnamese restaurant", "dim sum", "Chinese restaurant",
  "Indian restaurant", "Lebanese restaurant",
  // Mexican / Latin
  "Mexican restaurant", "Peruvian restaurant", "Argentinian steakhouse",
  // Format / vibe
  "steakhouse", "seafood restaurant", "oyster bar", "vegan restaurant",
  "rooftop restaurant", "Michelin restaurant", "famous restaurant",
  "celebrity chef", "best brunch", "best burger", "trendy restaurant",
];

const coffeeQs = [
  "best coffee shop", "specialty coffee", "third wave coffee",
  "espresso bar", "famous café", "trendy café",
  "instagrammable café", "boulangerie café",
];

const sweetQs = [
  "best patisserie", "famous patisserie", "best gelato",
  "best ice cream", "famous chocolatier", "macarons",
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

const KIND_FROM_QUERY: Record<string, string> = {
  italian: "italian", trattoria: "italian", osteria: "italian", pasta: "italian", pizzeria: "pizzeria",
  french: "french", brasserie: "brasserie", bistro: "bistro", bistrot: "bistro", gastronomique: "fine_dining",
  japanese: "japanese", sushi: "japanese", omakase: "japanese", ramen: "japanese", izakaya: "japanese",
  mediterranean: "mediterranean", greek: "greek", tapas: "tapas",
  korean: "korean", thai: "thai", vietnamese: "thai", dim: "chinese", chinese: "chinese",
  indian: "indian", lebanese: "lebanese",
  mexican: "mexican", peruvian: "peruvian", argentinian: "steakhouse",
  steakhouse: "steakhouse", seafood: "seafood", oyster: "seafood", vegan: "vegan",
  rooftop: "rooftop", michelin: "fine_dining", famous: "general",
  celebrity: "fine_dining", brunch: "brunch", burger: "burger", trendy: "general",
};
function kindFor(q: string): string {
  const lower = q.toLowerCase();
  for (const k of Object.keys(KIND_FROM_QUERY)) if (lower.includes(k)) return KIND_FROM_QUERY[k];
  return "general";
}

type CityCfg = {
  key: string;
  label: string;
  bbox: { latMin: number; latMax: number; lngMin: number; lngMax: number };
};
const CITIES: CityCfg[] = [
  { key: "cannes", label: "كان",    bbox: { latMin: 43.50, latMax: 43.61, lngMin: 6.92, lngMax: 7.12 } },
  { key: "nice",   label: "نيس",     bbox: { latMin: 43.60, latMax: 43.80, lngMin: 7.14, lngMax: 7.45 } },
  { key: "monaco", label: "موناكو",  bbox: { latMin: 43.71, latMax: 43.77, lngMin: 7.39, lngMax: 7.47 } },
];

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
  console.log("-- riviera boost");
  const seen = new Set<string>();
  const summary: Record<string, number> = {};
  for (const city of CITIES) {
    let kept = 0, qCount = 0;
    const queries: { q: string; category: Cat; kind: string }[] = [
      ...cuisines.map((q) => ({ q: `${q} ${city.label === "موناكو" ? "Monaco" : city.label === "كان" ? "Cannes" : "Nice"}`, category: "food" as Cat, kind: kindFor(q) })),
      ...coffeeQs.map((q) => ({ q: `${q} ${city.label === "موناكو" ? "Monaco" : city.label === "كان" ? "Cannes" : "Nice"}`, category: "coffee" as Cat, kind: q.includes("specialty") || q.includes("third") ? "specialty" : "cafe" })),
      ...sweetQs.map((q) => ({ q: `${q} ${city.label === "موناكو" ? "Monaco" : city.label === "كان" ? "Cannes" : "Nice"}`, category: "sweet" as Cat, kind: q.includes("patisserie") ? "patisserie" : q.includes("gelato") || q.includes("ice cream") ? "icecream" : q.includes("chocolat") ? "chocolate" : "dessert" })),
    ];
    for (const { q, category, kind } of queries) {
      qCount++;
      const hits = await search(q);
      for (const h of hits) {
        if (seen.has(h.place_id)) continue;
        const lat = h.geometry?.location?.lat;
        const lng = h.geometry?.location?.lng;
        if (lat == null || lng == null) continue;
        if (!inBbox(lat, lng, city.bbox)) continue;
        if (!h.name) continue;
        if (!h.photos?.[0]?.photo_reference) continue;
        // Lower threshold — 3.5★ + 20 reviews to include well-known spots
        // with mediocre ratings (touristy classics, famous brunches, etc.).
        if (h.rating != null && h.rating < 3.5) continue;
        if (h.user_ratings_total != null && h.user_ratings_total < 20) continue;

        seen.add(h.place_id);
        const photo = photoUrl(h.photos[0].photo_reference);
        const address = h.formatted_address ? `'${sqlEscape(h.formatted_address)}'` : "NULL";
        const r = h.rating ?? null, n = h.user_ratings_total ?? null, p = h.price_level ?? null;
        console.log(
          `INSERT INTO places (name, city, city_label, category, kind, address, lat, lng, rating, review_count, price_level, photo_url, google_place_id, external_source, cost_currency, cost_confidence, data_freshness, is_editor_pick) VALUES ('${sqlEscape(h.name)}', '${city.key}', '${sqlEscape(city.label)}', '${category}', '${kind}', ${address}, ${lat}, ${lng}, ${r ?? "NULL"}, ${n ?? "NULL"}, ${p ?? "NULL"}, '${photo}', '${sqlEscape(h.place_id)}', 'riviera_boost_v1', 'EUR', 'medium', NOW(), false) ON CONFLICT (google_place_id) DO NOTHING;`
        );
        kept++;
      }
      await new Promise((r) => setTimeout(r, 70));
    }
    summary[city.key] = kept;
    console.error(`[${city.key}] ${qCount} queries → ${kept} candidates`);
  }
  console.error("\n=== summary ===");
  for (const [k, v] of Object.entries(summary)) console.error(`  ${k}: ${v}`);
})();
