// Round 3 photo resolver — quick script for the latest 52 Riviera additions.
// Run: npx tsx scripts/resolve-riviera3-photos.ts > /tmp/riviera3.sql
import { config } from "dotenv"; config({ path: ".env.local" });
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("missing key"); process.exit(1); }

const PLACES: { db: string; q: string }[] = [
  { db: "Salsamenteria di Parma · سالساميتيريا", q: "Salsamenteria di Parma Cannes" },
  { db: "Riff · ريف", q: "Riff Cannes restaurant" },
  { db: "L'Esther · ليستير", q: "L'Esther Cannes restaurant" },
  { db: "La Tarte Tropézienne Cannes", q: "La Tarte Tropezienne Cannes Hoche" },
  { db: "Plage du Martinez · شاطئ مارتينيز", q: "Plage du Martinez Cannes" },
  { db: "Plage Macé · شاطئ ماسيه", q: "Plage Mace Cannes" },
  { db: "Le Petit Majestic · لو بتي ماجستيك", q: "Petit Majestic Cannes" },
  { db: "Ondine Beach · أوندين بيتش", q: "Ondine Beach Cannes" },
  { db: "La Galerie Gourmande · غاليري غورماند", q: "Galerie Gourmande Cannes" },
  { db: "Roly's Cannes · رولي", q: "Roly Cannes ice cream" },
  { db: "JW Marriott Rooftop · جي دبليو روف", q: "JW Marriott Cannes rooftop" },
  { db: "Notre-Dame de l'Espérance · كنيسة سيدة الرجاء", q: "Notre Dame de l'Esperance Cannes Suquet" },
  { db: "La Petite Maison · لا بتيت ميزون", q: "La Petite Maison Nice" },
  { db: "Le Comptoir du Marché · كومتوار", q: "Le Comptoir du Marche Nice" },
  { db: "La Rossettisserie · روسيتيسري", q: "La Rossettisserie Nice" },
  { db: "Chez Pipo · شيز پيپو", q: "Chez Pipo Nice socca" },
  { db: "Movida · موڤيدا", q: "Movida Nice wine bar" },
  { db: "Lou Mourelec · لو موريليك", q: "Lou Mourelec Nice" },
  { db: "Tonic Hub · تونيك", q: "Tonic Hub Nice coffee" },
  { db: "Pâtisserie Cappa · كابا", q: "Patisserie Cappa Nice" },
  { db: "Glaces Azzurro · غلاسي أزورو", q: "Glaces Azzurro Nice Vieux Nice" },
  { db: "MAMAC · ماماك (متحف الحديث)", q: "MAMAC Nice" },
  { db: "Saint-Réparate Cathedral · كاتدرائية سان ريباراتي", q: "Saint Reparate Cathedral Nice" },
  { db: "Parc Phoenix · حديقة فينيكس", q: "Parc Phoenix Nice" },
  { db: "Old Port Lympia · ميناء نيس القديم", q: "Port Lympia Nice old port" },
  { db: "Plage Beau Rivage · شاطئ بو ريفاج", q: "Plage Beau Rivage Nice" },
  { db: "Opéra Plage · أوبرا بلاج", q: "Opera Plage Nice" },
  { db: "Le Petit Train de Nice · القطار السياحي", q: "Petit Train de Nice tour" },
  { db: "Mademoiselle M · مادموازيل", q: "Mademoiselle M Nice patisserie" },
  { db: "Song Qi · سونغ تشي", q: "Song Qi Monaco" },
  { db: "Beefbar 78 · بيفبار ٧٨", q: "Beefbar 78 Monaco" },
  { db: "Le Sushi Story · سوشي ستوري", q: "Le Sushi Story Monaco" },
  { db: "Maison Multari · ميزون مولتاري", q: "Maison Multari Monaco" },
  { db: "La Vista Bar · فيستا بار", q: "Vista Bar Hermitage Monaco" },
  { db: "Saint-Devote Chapel · شابيل سان ديڤوت", q: "Saint Devote Monaco" },
  { db: "Stade Louis II · ملعب لوي الثاني", q: "Stade Louis II Monaco" },
  { db: "Plage du Larvotto Public · شاطئ لارفوتو العام", q: "Larvotto public beach Monaco" },
  { db: "Café Llorca · كافيه لوركا", q: "Cafe Llorca Monaco" },
  { db: "Monte-Carlo Country Club · نادي مونت كارلو", q: "Monte Carlo Country Club" },
  { db: "Princesse Antoinette Park · حديقة الأميرة أنطوانيت", q: "Princesse Antoinette Park Monaco" },
  { db: "Le Bistrot du Curé · بيسترو دو كوريه", q: "Le Bistrot du Cure Antibes" },
  { db: "Marché Provençal · السوق البروفنسي", q: "Marche Provencal Antibes Cours Massena" },
  { db: "Fort Carré d'Antibes · حصن أنتيب", q: "Fort Carre d'Antibes" },
  { db: "Plage de la Salis · شاطئ سالي", q: "Plage de la Salis Antibes" },
  { db: "Jardin Botanique Val Rahmeh · حديقة ڤال رحمه", q: "Val Rahmeh garden Menton" },
  { db: "Basilique Saint-Michel · بازيليك سان ميشيل", q: "Basilique Saint Michel Menton" },
  { db: "Marché des Halles Menton · سوق منتون", q: "Marche des Halles Menton" },
  { db: "La Colombe d'Or · لا كولومب دور", q: "La Colombe d'Or Saint-Paul" },
  { db: "Villa Ephrussi de Rothschild · فيلا روتشيلد", q: "Villa Ephrussi de Rothschild" },
  { db: "Plage de Passable · شاطئ باسابل", q: "Plage de Passable Cap Ferrat" },
  { db: "Sentier du Cap-Ferrat · مسار كاب فيرا", q: "Sentier Cap Ferrat coastal" },
  { db: "Plage Mala · شاطئ مالا", q: "Plage Mala Cap d'Ail" },
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
  console.log("-- riviera3 photos\n");
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
