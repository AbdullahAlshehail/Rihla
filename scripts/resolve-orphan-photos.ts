// Fallback resolver — fill photo_url for every remaining place.
// Run: npx tsx scripts/resolve-orphan-photos.ts > /tmp/orphan.sql
import { config } from "dotenv"; config({ path: ".env.local" });
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("missing key"); process.exit(1); }

const PLACES: { db: string; q: string }[] = [
  { db: "Fenocchio Cannes · فينوكيو", q: "Fenocchio glacier Cannes" },
  { db: "UVA Restaurant", q: "UVA Restaurant Cannes" },
  { db: "شاطئ Plage de la Mala", q: "Plage Mala Cap d'Ail" },
  { db: "Menton (البلدة القديمة)", q: "Menton old town" },
  { db: "Mitchell's · ميتشلز", q: "Mitchell's Monte Carlo" },
  { db: "The Pearls of Monte-Carlo", q: "The Pearls of Monte Carlo restaurant" },
  { db: "zēphyr Monaco", q: "zephyr Monaco rooftop" },
  { db: "Bistrot d'Antoine", q: "Bistrot d'Antoine Nice" },
  { db: "Café Carette · كافيه كاريت", q: "Carette Nice patisserie" },
  { db: "Free Walking Tours Nice", q: "Free Walking Tour Nice France" },
  { db: "French Riviera Sightseeing", q: "French Riviera sightseeing tour Nice" },
  { db: "L'Alchimie Restaurant", q: "L'Alchimie Restaurant Nice" },
  { db: "Le Bistrot du Fromager", q: "Bistrot du Fromager Nice" },
  { db: "Le Bouchon", q: "Le Bouchon Nice restaurant" },
  { db: "Le Vingt4", q: "Le Vingt4 Nice restaurant" },
  { db: "Les Sens", q: "Les Sens Nice restaurant" },
  { db: "Nissa Croisières · جولات بحرية", q: "Nissa Croisieres Nice boat" },
  { db: "Roly's Coffee and Slice", q: "Roly's Coffee Slice Nice" },
  { db: "Tonic Hub · تونيك", q: "Tonic Hub Nice cafe" },
  { db: "Vinivore · فينيفور", q: "Vinivore Nice wine" },
  { db: "% Arabica · Boulevard", q: "% Arabica Boulevard Riyadh" },
  { db: "Boulevard World", q: "Boulevard World Riyadh" },
  { db: "Brew92", q: "Brew92 coffee Riyadh" },
  { db: "Bujairi Terrace · بوجاري تيراس", q: "Bujairi Terrace Diriyah Riyadh" },
  { db: "Camel Step Coffee Roasters", q: "Camel Step Coffee Roasters Riyadh" },
  { db: "Elixir Bunn", q: "Elixir Bunn coffee Riyadh" },
  { db: "Half Million", q: "Half Million coffee Riyadh" },
  { db: "JAX District · حي جاكس", q: "JAX District Diriyah Riyadh" },
  { db: "Long Beach · لونغ بيتش", q: "Long Beach restaurant Riyadh" },
  { db: "Lusin · لوسين", q: "Lusin restaurant Riyadh" },
  { db: "Maiz at Bujairi", q: "Maiz at Bujairi Terrace Riyadh" },
  { db: "Medd Cafe", q: "Medd Cafe Riyadh" },
  { db: "Mokha 1450 · مخا", q: "Mokha 1450 Riyadh coffee" },
  { db: "Myazu · مايازو", q: "Myazu restaurant Riyadh" },
  { db: "Najran · نجران", q: "Najran restaurant Riyadh" },
  { db: "Section B Steakhouse", q: "Section B Steakhouse Riyadh" },
  { db: "Sky Bridge · الجسر السماوي", q: "Sky Bridge Kingdom Tower Riyadh" },
  { db: "Spazio 77 · سبازيو", q: "Spazio 77 Riyadh Kingdom Tower" },
  { db: "Suhail · سهيل", q: "Suhail restaurant Riyadh" },
  { db: "Takya · تكية", q: "Takya restaurant Diriyah Riyadh" },
  { db: "The Globe · الفيصلية", q: "The Globe Al Faisaliah Riyadh" },
  { db: "Twiggy by Twiggy", q: "Twiggy by Twiggy Riyadh" },
  { db: "المتحف الوطني السعودي", q: "Saudi National Museum Riyadh" },
  { db: "حافة العالم · Edge of the World", q: "Edge of the World Riyadh" },
  { db: "حي الطريف · الدرعية", q: "At-Turaif Diriyah Riyadh UNESCO" },
  { db: "قصر المصمك", q: "Masmak Fortress Riyadh" },
  { db: "نجد فيليج (Najd Village)", q: "Najd Village restaurant Riyadh" },
  { db: "وادي حنيفة", q: "Wadi Hanifah Riyadh park" },
  { db: "Saint-Paul-de-Vence", q: "Saint Paul de Vence village" },
  { db: "Villefranche-sur-Mer", q: "Villefranche-sur-Mer France" },
];

type Hit = { place_id: string; rating?: number; user_ratings_total?: number; photos?: { photo_reference: string }[]; geometry?: { location: { lat: number; lng: number } } };
const sqlEscape = (s: string) => s.replace(/'/g, "''");
const photoUrl = (ref: string) => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_KEY}`;

async function searchOne(query: string): Promise<Hit | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query); url.searchParams.set("key", GOOGLE_KEY); url.searchParams.set("language", "ar");
  const r = await fetch(url.toString()); if (!r.ok) return null;
  const data = await r.json(); if (data.status !== "OK" || !data.results?.length) return null;
  return data.results[0] as Hit;
}
(async () => {
  let ok = 0, missing = 0;
  console.log("-- orphan photos\n");
  for (const p of PLACES) {
    const hit = await searchOne(p.q);
    if (!hit) { console.log(`-- MISSING: ${p.db}`); missing++; continue; }
    const sets: string[] = [];
    if (hit.photos?.[0]?.photo_reference) sets.push(`photo_url = '${sqlEscape(photoUrl(hit.photos[0].photo_reference))}'`);
    if (hit.geometry?.location) { sets.push(`lat = ${hit.geometry.location.lat}`, `lng = ${hit.geometry.location.lng}`); }
    if (hit.rating != null) sets.push(`rating = ${hit.rating}`);
    if (hit.user_ratings_total != null) sets.push(`review_count = ${hit.user_ratings_total}`);
    if (sets.length) console.log(`UPDATE places SET ${sets.join(", ")} WHERE name = '${sqlEscape(p.db)}';`);
    ok++; await new Promise((r) => setTimeout(r, 60));
  }
  console.error(`\n✓ ${ok} ok / ${missing} missing`);
})();
