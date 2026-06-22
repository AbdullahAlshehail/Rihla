// One-off photo + coords resolver for the new Riviera curated places.
// Outputs SQL UPDATEs to stdout. Pipe to the MCP execute_sql.
// Run: npx tsx scripts/resolve-riviera-photos.ts > /tmp/riviera-updates.sql

import { config } from "dotenv";
config({ path: ".env.local" });

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) { console.error("Missing GOOGLE_MAPS_API_KEY"); process.exit(1); }

const PLACES: { db: string; queries: string[] }[] = [
  // Cannes — food
  { db: "La Palme d'Or · لا بالم دور", queries: ["La Palme d'Or Cannes Martinez"] },
  { db: "L'Antidote · لانتيدوت", queries: ["L'Antidote restaurant Cannes"] },
  { db: "Astoux et Brun · أستو إيه برون", queries: ["Astoux et Brun Cannes"] },
  { db: "Da Bouttau · دا بوتو", queries: ["Da Bouttau Cannes Auberge Provençale"] },
  { db: "Sea Sens · سي سينس", queries: ["Sea Sens Cannes Five Hotel"] },
  { db: "Le Caveau 30 · لو كافو ٣٠", queries: ["Le Caveau 30 Cannes"] },
  { db: "Bobo Bistro · بوبو بيسترو", queries: ["Bobo Bistro Cannes"] },
  { db: "La Toque d'Or · لا توك دور", queries: ["La Toque d'Or Cannes"] },
  { db: "Aux Bons Enfants · أو بون زنفان", queries: ["Aux Bons Enfants Cannes Meynadier"] },
  // Cannes — coffee/sweets
  { db: "Marcel · مارسيل", queries: ["Marcel coffee Cannes"] },
  { db: "Brüt Café · برت كافيه", queries: ["Brut Cafe Cannes"] },
  { db: "Pâtisserie Jean-Luc Pelé · باتيسري بيليه", queries: ["Patisserie Jean-Luc Pele Cannes"] },
  { db: "Maison Diana · ميزون ديانا", queries: ["Maison Diana Cannes macarons"] },
  // Cannes — sights/nature
  { db: "Marché Forville · سوق فورفيل", queries: ["Marche Forville Cannes"] },
  { db: "Le Suquet · لو سوكيه (المدينة القديمة)", queries: ["Le Suquet old town Cannes"] },
  { db: "Boulevard de la Croisette · الكروازيت", queries: ["La Croisette Cannes"] },
  { db: "Île Sainte-Marguerite · جزيرة سانت مارغريت", queries: ["Ile Sainte Marguerite Cannes"] },
  { db: "Plage du Midi · شاطئ ميدي", queries: ["Plage du Midi Cannes"] },
  { db: "Palais des Festivals · قصر المهرجانات", queries: ["Palais des Festivals Cannes"] },
  { db: "Casino Croisette · كازينو كروازيت", queries: ["Casino Croisette Cannes Barriere"] },

  // Monaco — food
  { db: "Le Louis XV - Alain Ducasse · لو لوي ١٥", queries: ["Le Louis XV Alain Ducasse Monaco"] },
  { db: "Yoshi · يوشي", queries: ["Yoshi Joel Robuchon Monaco"] },
  { db: "Joël Robuchon Monte-Carlo", queries: ["Joel Robuchon Monte Carlo"] },
  { db: "Blue Bay · بلو باي", queries: ["Blue Bay Marcel Ravin Monaco"] },
  { db: "La Marée · لا ماريه", queries: ["La Maree Monaco seafood"] },
  { db: "Beefbar · بيفبار", queries: ["Beefbar Monaco"] },
  { db: "Cipriani Monte-Carlo · شيبرياني", queries: ["Cipriani Monte-Carlo"] },
  { db: "Sass Café · ساس كافيه", queries: ["Sass Cafe Monaco"] },
  { db: "Maya Bay · مايا باي", queries: ["Maya Bay Monaco"] },
  { db: "Loga · لوغا", queries: ["Loga Monaco Sainte Devote"] },
  // Monaco — coffee/sweets
  { db: "Café de Paris Monte-Carlo · كافيه دو باري", queries: ["Cafe de Paris Monte Carlo"] },
  { db: "Caffè Milano · كافيه ميلانو", queries: ["Caffe Milano Monaco"] },
  { db: "Pâtisserie Riviera · باتيسري ريفييرا", queries: ["Patisserie Riviera Monaco"] },
  // Monaco — sights/events
  { db: "Casino de Monte-Carlo · كازينو مونت كارلو", queries: ["Casino de Monte-Carlo"] },
  { db: "Place du Casino · ساحة الكازينو", queries: ["Place du Casino Monaco"] },
  { db: "Palais Princier · القصر الأميري", queries: ["Prince's Palace of Monaco"] },
  { db: "Old Town Monaco · المدينة القديمة (Le Rocher)", queries: ["Monaco old town Le Rocher"] },
  { db: "Musée Océanographique · المتحف البحري", queries: ["Oceanographic Museum Monaco"] },
  { db: "Jardin Exotique de Monaco · الحديقة الاستوائية", queries: ["Jardin Exotique de Monaco"] },
  { db: "Saint-Martin Gardens · حدائق سان مارتن", queries: ["Saint-Martin Gardens Monaco"] },
  { db: "Larvotto Beach · شاطئ لارفوتو", queries: ["Larvotto Beach Monaco"] },
  { db: "Cathédrale de Monaco · كاتدرائية موناكو", queries: ["Cathedrale de Monaco"] },
  { db: "One Monte-Carlo · ون مونت كارلو", queries: ["One Monte-Carlo"] },
  { db: "Carré d'Or · كاريه دور", queries: ["Carre d'Or Monaco shopping"] },

  // Nice — fine dining
  { db: "Le Chantecler · لو شانتكلير", queries: ["Le Chantecler Negresco Nice"] },
  { db: "JAN · جان", queries: ["JAN restaurant Nice"] },
  { db: "Flaveur · فلافور", queries: ["Flaveur restaurant Nice"] },
  // Nice — sights
  { db: "Promenade des Anglais · بروموناد دي زنغليه", queries: ["Promenade des Anglais Nice"] },
  { db: "Vieux Nice · المدينة القديمة", queries: ["Vieux Nice old town"] },
  { db: "Colline du Château · تلة القلعة", queries: ["Colline du Chateau Nice castle hill"] },
  { db: "Cours Saleya · سوق كور ساليا", queries: ["Cours Saleya Nice market"] },
  { db: "Musée Matisse · متحف ماتيس", queries: ["Musee Matisse Nice"] },
  { db: "Musée Marc Chagall · متحف شاغال", queries: ["Musee Marc Chagall Nice"] },
  { db: "Place Masséna · ساحة ماسينا", queries: ["Place Massena Nice"] },
  { db: "Place Garibaldi · ساحة غاريبالدي", queries: ["Place Garibaldi Nice"] },

  // Eze / Villefranche / Antibes
  { db: "Château de la Chèvre d'Or · شاتو لا شيفر دور", queries: ["La Chevre d'Or Eze"] },
  { db: "Jardin Exotique d'Èze · حديقة إيز الاستوائية", queries: ["Jardin Exotique Eze"] },
  { db: "Fragonard Perfumery Èze · معطرة فراغونار", queries: ["Fragonard Perfumery Eze"] },
  { db: "Citadelle Saint-Elme · قلعة سان إلم", queries: ["Citadelle Saint Elme Villefranche"] },
  { db: "Plage des Marinières · شاطئ فيلفرانش", queries: ["Plage des Marinieres Villefranche"] },
  { db: "Musée Picasso Antibes · متحف بيكاسو", queries: ["Musee Picasso Antibes"] },
  { db: "Marineland · مارينلاند", queries: ["Marineland Antibes"] },
  { db: "Cap d'Antibes · رأس أنتيب", queries: ["Cap d'Antibes coastal path"] },
  { db: "Fondation Maeght · مؤسسة مايغت", queries: ["Fondation Maeght Saint-Paul"] },
  { db: "Jardin Serre de la Madone · حديقة سير دو لا مادون", queries: ["Serre de la Madone garden Menton"] },
];

type Hit = {
  place_id: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  photos?: { photo_reference: string }[];
  geometry?: { location: { lat: number; lng: number } };
};

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

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
  console.log("-- Generated by scripts/resolve-riviera-photos.ts");
  console.log("-- " + new Date().toISOString());
  console.log();
  for (const p of PLACES) {
    let hit: Hit | null = null;
    for (const q of p.queries) {
      hit = await searchOne(q);
      if (hit) break;
    }
    if (!hit) {
      console.log(`-- MISSING: ${p.db}`);
      missing++;
      continue;
    }
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
