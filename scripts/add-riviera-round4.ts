// Round 4: another batch of high-quality Riviera additions.
// For each entry we hit Google Places Text Search, then emit INSERT SQL.
// Run:  npx tsx scripts/add-riviera-round4.ts > /tmp/riviera4.sql
import { config } from "dotenv"; config({ path: ".env.local" });
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("missing key"); process.exit(1); }

type Cat = "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar";

const PLACES: { name: string; city: string; city_label: string; category: Cat; kind: string; q: string }[] = [
  // ── Cannes — fine dining, beach clubs, hidden gems
  { name: "Da Mamo · دا مامو",                     city: "cannes",  city_label: "Cannes",       category: "food",   kind: "italian",      q: "Da Mamo Cannes restaurant" },
  { name: "Aux Bons Enfants · أوكس بون أنفا",       city: "cannes",  city_label: "Cannes",       category: "food",   kind: "french",       q: "Aux Bons Enfants Cannes" },
  { name: "Le Festival · لو فستيفال",               city: "cannes",  city_label: "Cannes",       category: "food",   kind: "seafood",      q: "Le Festival Cannes Croisette" },
  { name: "Plage des Pêcheurs · شاطئ الصيادين",     city: "cannes",  city_label: "Cannes",       category: "nature", kind: "beach",        q: "Plage des Pecheurs Cannes" },
  { name: "Maison Bocuse · ميزون بوكوز",           city: "cannes",  city_label: "Cannes",       category: "food",   kind: "french",       q: "Maison Bocuse Cannes" },
  { name: "Pâtisserie Jean-Luc Pelé · بيلي",       city: "cannes",  city_label: "Cannes",       category: "sweet",  kind: "patisserie",   q: "Jean-Luc Pele patisserie Cannes" },
  { name: "Croisette Plage · كرواست بلاج",          city: "cannes",  city_label: "Cannes",       category: "nature", kind: "beach_club",   q: "Croisette Plage Cannes beach club" },
  { name: "Mademoiselle Gray · مادموازيل قراي",     city: "cannes",  city_label: "Cannes",       category: "food",   kind: "modern_french",q: "Mademoiselle Gray Hotel Gray d'Albion Cannes" },
  // ── Nice — Niçois classics, viewpoints, modern bistros
  { name: "Acchiardo · أكياردو",                    city: "nice",    city_label: "Nice",         category: "food",   kind: "nicois",       q: "Acchiardo Nice old town" },
  { name: "Sept Cinq · سيت سان",                    city: "nice",    city_label: "Nice",         category: "food",   kind: "modern_french",q: "Sept Cinq Nice restaurant" },
  { name: "Pissalat · پيسالا",                      city: "nice",    city_label: "Nice",         category: "food",   kind: "fine_dining",  q: "Pissalat Nice restaurant Vieux" },
  { name: "La Civette du Cours · لا سيفيت",         city: "nice",    city_label: "Nice",         category: "coffee", kind: "cafe",         q: "Civette du Cours Saleya Nice" },
  { name: "Le Plongeoir · لو پلونچوار",             city: "nice",    city_label: "Nice",         category: "food",   kind: "seafood",      q: "Le Plongeoir Nice restaurant" },
  { name: "Lou Pilha Leva · لو پيلا ليفا",          city: "nice",    city_label: "Nice",         category: "food",   kind: "nicois",       q: "Lou Pilha Leva Nice socca" },
  { name: "Castel Plage · شاطئ كاستل",              city: "nice",    city_label: "Nice",         category: "nature", kind: "beach_club",   q: "Castel Plage Nice" },
  { name: "Brasserie Flo · براسيري فلو",            city: "nice",    city_label: "Nice",         category: "food",   kind: "brasserie",    q: "Brasserie Flo Nice" },
  { name: "Promenade du Paillon · بروميناد بايون",  city: "nice",    city_label: "Nice",         category: "nature", kind: "park",         q: "Promenade du Paillon Nice" },
  { name: "Colline du Château · هضبة القلعة",       city: "nice",    city_label: "Nice",         category: "sight",  kind: "viewpoint",    q: "Colline du Chateau Nice view" },
  // ── Monaco — palace dining, glam beach clubs
  { name: "Le Louis XV · لويس الخامس عشر",          city: "monaco",  city_label: "Monaco",       category: "food",   kind: "michelin_3",   q: "Louis XV Alain Ducasse Monaco" },
  { name: "Yoshi · يوشي",                           city: "monaco",  city_label: "Monaco",       category: "food",   kind: "japanese",     q: "Yoshi Hotel Metropole Monaco" },
  { name: "La Note Bleue · لا نوت بلو",             city: "monaco",  city_label: "Monaco",       category: "food",   kind: "seafood",      q: "La Note Bleue Monaco Larvotto" },
  { name: "Café de Paris Monte-Carlo · باريس",      city: "monaco",  city_label: "Monaco",       category: "food",   kind: "brasserie",    q: "Cafe de Paris Monte Carlo" },
  { name: "COYA Monte-Carlo · كويا",                city: "monaco",  city_label: "Monaco",       category: "food",   kind: "peruvian",     q: "COYA Monte Carlo restaurant" },
  { name: "Twiga Monte-Carlo · تويغا",              city: "monaco",  city_label: "Monaco",       category: "food",   kind: "italian",      q: "Twiga Monte Carlo restaurant" },
  { name: "Casino de Monte-Carlo · كازينو",         city: "monaco",  city_label: "Monaco",       category: "sight",  kind: "landmark",     q: "Casino Monte Carlo Monaco" },
];

type Hit = { place_id: string; rating?: number; user_ratings_total?: number; photos?: { photo_reference: string }[]; geometry?: { location: { lat: number; lng: number } }; formatted_address?: string };
const sqlEscape = (s: string) => s.replace(/'/g, "''");
const photoUrl = (ref: string) => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_KEY}`;

async function searchOne(query: string): Promise<Hit | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("language", "ar");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const data = await r.json();
  if (data.status !== "OK" || !data.results?.length) return null;
  // Prefer the first result that actually has photos
  return (data.results.find((x: Hit) => x.photos?.[0]?.photo_reference) ?? data.results[0]) as Hit;
}

(async () => {
  let ok = 0, missing = 0;
  console.log("-- riviera round 4 — new places\n");
  for (const p of PLACES) {
    const hit = await searchOne(p.q);
    if (!hit) { console.log(`-- MISSING: ${p.name}`); missing++; continue; }
    const photoSql = hit.photos?.[0]?.photo_reference
      ? `'${sqlEscape(photoUrl(hit.photos[0].photo_reference))}'`
      : "NULL";
    const lat = hit.geometry?.location?.lat ?? "NULL";
    const lng = hit.geometry?.location?.lng ?? "NULL";
    const rating = hit.rating ?? "NULL";
    const reviewCount = hit.user_ratings_total ?? "NULL";
    const address = hit.formatted_address ? `'${sqlEscape(hit.formatted_address)}'` : "NULL";
    console.log(
      `INSERT INTO places (name, city, city_label, category, kind, address, lat, lng, rating, review_count, photo_url, google_place_id, external_source, cost_currency, cost_confidence, data_freshness, is_editor_pick) ` +
      `VALUES ('${sqlEscape(p.name)}', '${p.city}', '${sqlEscape(p.city_label)}', '${p.category}', '${p.kind}', ${address}, ${lat}, ${lng}, ${rating}, ${reviewCount}, ${photoSql}, '${sqlEscape(hit.place_id)}', 'curated_riviera_r4', 'EUR', 'medium', 'fresh', false) ` +
      `ON CONFLICT (google_place_id) DO NOTHING;`
    );
    ok++;
    await new Promise((r) => setTimeout(r, 60));
  }
  console.error(`\n✓ ${ok} ok / ${missing} missing`);
})();
