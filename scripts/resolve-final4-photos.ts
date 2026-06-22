import { config } from "dotenv"; config({ path: ".env.local" });
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("missing key"); process.exit(1); }

const PLACES: { db: string; q: string }[] = [
  { db: "Mitchell's · ميتشلز", q: "Mitchell's restaurant Monaco Monte-Carlo" },
  { db: "JAX District · حي جاكس", q: "JAX District Diriyah art" },
  { db: "Najran · نجران", q: "Najran restaurant Riyadh Saudi" },
  { db: "Twiggy by Twiggy", q: "Twiggy Riyadh restaurant" },
];

type Hit = { place_id: string; rating?: number; user_ratings_total?: number; photos?: { photo_reference: string }[]; geometry?: { location: { lat: number; lng: number } } };
const sqlEscape = (s: string) => s.replace(/'/g, "''");
const photoUrl = (ref: string) => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${ref}&key=${GOOGLE_KEY}`;

async function searchOne(query: string): Promise<Hit | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query); url.searchParams.set("key", GOOGLE_KEY); url.searchParams.set("language", "ar");
  const r = await fetch(url.toString()); if (!r.ok) return null;
  const data = await r.json(); if (data.status !== "OK" || !data.results?.length) return null;
  for (const result of data.results) {
    if (result.photos?.[0]?.photo_reference) return result as Hit;
  }
  return data.results[0] as Hit;
}
(async () => {
  console.log("-- final4 photos\n");
  for (const p of PLACES) {
    const hit = await searchOne(p.q);
    if (!hit) { console.log(`-- MISSING: ${p.db}`); continue; }
    const sets: string[] = [];
    if (hit.photos?.[0]?.photo_reference) sets.push(`photo_url = '${sqlEscape(photoUrl(hit.photos[0].photo_reference))}'`);
    else console.log(`-- NO PHOTO HIT for: ${p.db}`);
    if (sets.length) console.log(`UPDATE places SET ${sets.join(", ")} WHERE name = '${sqlEscape(p.db)}';`);
    await new Promise((r) => setTimeout(r, 80));
  }
})();
