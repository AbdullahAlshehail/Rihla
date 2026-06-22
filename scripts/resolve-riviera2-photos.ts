// Round 2 photo resolver for newly-added Riviera places.
// Run: npx tsx scripts/resolve-riviera2-photos.ts > /tmp/riviera2-updates.sql

import { config } from "dotenv";
config({ path: ".env.local" });

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("Missing GOOGLE_MAPS_API_KEY"); process.exit(1); }

const PLACES: { db: string; queries: string[] }[] = [
  // Cannes
  { db: "Mantel · مونتيل", queries: ["Mantel restaurant Cannes Saint-Antoine"] },
  { db: "La Maison du Caviar · ميزون كافيار", queries: ["La Maison du Caviar Cannes"] },
  { db: "Da Laura · دا لورا", queries: ["Da Laura Cannes Italian"] },
  { db: "La Môme Cannes · لاموم", queries: ["La Mome Cannes restaurant"] },
  { db: "Vesuvio · فيزوفيو", queries: ["Vesuvio Cannes Croisette"] },
  { db: "Bistrot des Halles · بيسترو هال", queries: ["Bistrot des Halles Cannes Forville"] },
  { db: "Coccinelle Bistrot · كوكسينل", queries: ["Coccinelle Bistrot Cannes"] },
  { db: "La Plage 45 · بلاج ٤٥", queries: ["Plage 45 Cannes Croisette"] },
  { db: "Carlton Beach · شاطئ كارلتون", queries: ["Carlton Beach Cannes"] },
  { db: "Z. Plage by Martinez · زد بلاج", queries: ["Z Plage Martinez Cannes"] },
  { db: "Musée de la Castre · متحف لا كاستر", queries: ["Musee de la Castre Cannes"] },
  { db: "Villa Domergue · فيلا دومرغ", queries: ["Villa Domergue Cannes"] },
  { db: "Bâoli Cannes · باولي", queries: ["Baoli Cannes club"] },
  { db: "360 by Radisson · ٣٦٠", queries: ["360 Radisson Cannes rooftop"] },
  { db: "Fenocchio Cannes · فينوكيو", queries: ["Fenocchio Cannes Meynadier"] },
  // Nice
  { db: "Acchiardo · أكياردو", queries: ["Acchiardo Nice Rue Droite"] },
  { db: "La Merenda · لا ميريندا", queries: ["La Merenda Nice"] },
  { db: "Bistrot d'Antoine · بيسترو أنتوان", queries: ["Bistrot d'Antoine Nice"] },
  { db: "Peixes · پيش", queries: ["Peixes Nice Opera"] },
  { db: "Olive et Artichaut · أوليف إيه أرتيشو", queries: ["Olive et Artichaut Nice"] },
  { db: "Le Restaurant Jouni · جوني", queries: ["Restaurant Jouni Nice Atelier"] },
  { db: "Vinivore · فينيفور", queries: ["Vinivore Nice wine bar"] },
  { db: "Lou Pilha Leva · لو بيلها", queries: ["Lou Pilha Leva Nice"] },
  { db: "Pizza Pili · بيتزا بيلي", queries: ["Pizza Pili Nice Bonaparte"] },
  { db: "Café de Turin · كافيه دو تورين", queries: ["Cafe de Turin Nice Garibaldi"] },
  { db: "Emilie and the Cool Kids · إيميلي", queries: ["Emilie and the Cool Kids Nice"] },
  { db: "Café Carette · كافيه كاريت", queries: ["Cafe Carette Nice"] },
  { db: "Fenocchio · فينوكيو نيس", queries: ["Fenocchio Nice Place Rossetti"] },
  { db: "Maison Auer · ميزون أوور", queries: ["Maison Auer Nice chocolate"] },
  { db: "Confiserie Florian · كونفيسري فلوريان", queries: ["Confiserie Florian Nice"] },
  { db: "Russian Orthodox Cathedral · الكاتدرائية الروسية", queries: ["Saint Nicholas Russian Cathedral Nice"] },
  { db: "Place Rossetti · ساحة روسيتي", queries: ["Place Rossetti Nice"] },
  { db: "Marché aux Antiquités · سوق الأنتيك", queries: ["Marche aux Antiquites Nice Cours Saleya"] },
  { db: "Castel Plage · كاستل بلاج", queries: ["Castel Plage Nice"] },
  { db: "Hi Beach · هاي بيتش", queries: ["Hi Beach Nice"] },
  // Monaco
  { db: "Elsa · إلسا", queries: ["Elsa Monte-Carlo Beach Hotel"] },
  { db: "Avenue 31 · أفنيو ٣١", queries: ["Avenue 31 Monaco"] },
  { db: "Pavyllon Monte-Carlo · بافيون", queries: ["Pavyllon Monte-Carlo Hermitage"] },
  { db: "Quai des Artistes · كي دي زرتيست", queries: ["Quai des Artistes Monaco"] },
  { db: "Stars 'N' Bars · ستارز آند بارز", queries: ["Stars N Bars Monaco"] },
  { db: "Mitchell's · ميتشلز", queries: ["Mitchell's Monte-Carlo"] },
  { db: "Boulangerie Multari · مولتاري", queries: ["Boulangerie Multari Monaco"] },
  { db: "Port Hercule · ميناء هرقل", queries: ["Port Hercule Monaco"] },
  { db: "Yacht Club de Monaco · نادي اليخوت", queries: ["Yacht Club de Monaco"] },
  { db: "Promenade Princesse Grace · بروموناد الأميرة غريس", queries: ["Promenade Princesse Grace Monaco"] },
  { db: "Casino Square Gardens · حدائق الكازينو", queries: ["Casino Gardens Monte-Carlo"] },
  // Saint-Tropez
  { db: "Sénéquier · سينيكييه", queries: ["Senequier Saint-Tropez"] },
  { db: "Le Club 55 · كلوب ٥٥", queries: ["Le Club 55 Pampelonne"] },
  { db: "Plage de Pampelonne · شاطئ بامبيلون", queries: ["Plage de Pampelonne Saint-Tropez"] },
  { db: "Place des Lices · ساحة دي ليس", queries: ["Place des Lices Saint-Tropez"] },
  { db: "Musée de l'Annonciade · متحف لانونسياد", queries: ["Musee de l'Annonciade Saint-Tropez"] },
  { db: "Citadelle de Saint-Tropez · قلعة سان تروبيه", queries: ["Citadelle Saint-Tropez"] },
  { db: "La Tarte Tropézienne · تارت تروبيزيين", queries: ["La Tarte Tropezienne Saint-Tropez"] },
  // Grasse
  { db: "Musée International de la Parfumerie · متحف العطور الدولي", queries: ["Musee International Parfumerie Grasse"] },
  { db: "Fragonard Factory · مصنع فراغونار", queries: ["Fragonard Factory Grasse"] },
  { db: "Molinard Parfumerie · مولينار", queries: ["Molinard Parfumerie Grasse"] },
  { db: "Old Town Grasse · مدينة غراس القديمة", queries: ["Old Town Grasse Vieille Ville"] },
  // Mougins
  { db: "Le Moulin de Mougins · موليه دو موجن", queries: ["Moulin de Mougins restaurant"] },
  { db: "Old Mougins Village · قرية موجن", queries: ["Vieux Village Mougins"] },
  // Biot
  { db: "Verrerie de Biot · معمل زجاج بيو", queries: ["Verrerie de Biot"] },
  // Vence
  { db: "Chapelle du Rosaire · كنيسة ماتيس", queries: ["Chapelle du Rosaire Vence Matisse"] },
  { db: "Old Town Vence · مدينة فانس القديمة", queries: ["Old Town Vence Vieille Ville"] },
];

type Hit = {
  place_id: string;
  rating?: number;
  user_ratings_total?: number;
  photos?: { photo_reference: string }[];
  geometry?: { location: { lat: number; lng: number } };
};

function sqlEscape(s: string): string { return s.replace(/'/g, "''"); }
function photoUrl(ref: string): string {
  const u = new URL("https://maps.googleapis.com/maps/api/place/photo");
  u.searchParams.set("maxwidth", "800");
  u.searchParams.set("photo_reference", ref);
  u.searchParams.set("key", GOOGLE_KEY);
  return u.toString();
}
async function searchOne(query: string): Promise<Hit | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("key", GOOGLE_KEY);
  url.searchParams.set("language", "ar");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const data = await r.json();
  if (data.status !== "OK" || !data.results?.length) return null;
  return data.results[0] as Hit;
}

async function main() {
  let ok = 0, missing = 0;
  console.log("-- Riviera Round 2 photo updates");
  console.log("-- " + new Date().toISOString());
  console.log();
  for (const p of PLACES) {
    let hit: Hit | null = null;
    for (const q of p.queries) { hit = await searchOne(q); if (hit) break; }
    if (!hit) { console.log(`-- MISSING: ${p.db}`); missing++; continue; }
    const photo = hit.photos?.[0]?.photo_reference;
    const sets: string[] = [];
    if (photo) sets.push(`photo_url = '${sqlEscape(photoUrl(photo))}'`);
    if (hit.geometry?.location) {
      sets.push(`lat = ${hit.geometry.location.lat}`);
      sets.push(`lng = ${hit.geometry.location.lng}`);
    }
    if (hit.rating != null) sets.push(`rating = ${hit.rating}`);
    if (hit.user_ratings_total != null) sets.push(`review_count = ${hit.user_ratings_total}`);
    if (sets.length > 0) {
      console.log(`UPDATE places SET ${sets.join(", ")} WHERE name = '${sqlEscape(p.db)}';`);
    }
    ok++;
    await new Promise((r) => setTimeout(r, 60));
  }
  console.error(`\n✓ resolved ${ok} / missing ${missing}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
