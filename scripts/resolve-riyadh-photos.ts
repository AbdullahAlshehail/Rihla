// One-off photo resolver for the newly-curated Riyadh catalogue.
// Pulls a single Google Text Search hit per place, grabs the first photo,
// and prints SQL UPDATEs to stdout. Pipe / paste them into the MCP.
//
// Run: npx tsx scripts/resolve-riyadh-photos.ts > /tmp/riyadh-photo-updates.sql

import { config } from "dotenv";
config({ path: ".env.local" });

const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY!;
if (!GOOGLE_KEY) {
  console.error("Missing GOOGLE_MAPS_API_KEY in .env.local");
  process.exit(1);
}

// Riyadh place names we just inserted (Round 1 + Round 2).
// Searching by Arabic name + Riyadh works best for chains; for international
// brands the English name resolves better. We try both.
const PLACES: { db: string; queries: string[] }[] = [
  // Round 1 — famous restaurants
  { db: "Hakkasan · هاكاسان", queries: ["Hakkasan Riyadh"] },
  { db: "Roka Riyadh · روكا", queries: ["Roka Via Riyadh"] },
  { db: "Cipriani Riyadh · شيبرياني", queries: ["Cipriani Via Riyadh"] },
  { db: "LPM · La Petite Maison", queries: ["La Petite Maison Riyadh"] },
  { db: "Sumosan · سوموسان", queries: ["Sumosan Riyadh"] },
  { db: "Nusr-Et Steakhouse Riyadh · نصرت", queries: ["Nusr-Et Steakhouse Riyadh Boulevard"] },
  { db: "Spago by Wolfgang Puck", queries: ["Spago Riyadh Bujairi"] },
  { db: "Cuts · كاتس", queries: ["Cuts Restaurant Riyadh"] },
  { db: "Al Orjouan · الأرجوان", queries: ["Al Orjouan Ritz Carlton Riyadh"] },
  { db: "Mama Noura · ماما نورة", queries: ["Mama Noura Riyadh"] },
  { db: "Najran · نجران", queries: ["Najran Restaurant Riyadh"] },
  { db: "Al Romansiah · الرومانسية", queries: ["Al Romansiah Riyadh"] },
  { db: "Yamal Al Sham · يمال الشام", queries: ["Yamal Al Sham Riyadh"] },
  { db: "Beit Beirut · بيت بيروت", queries: ["Beit Beirut Riyadh"] },
  { db: "Hadiqa · الحديقة", queries: ["Hadiqa Restaurant Riyadh"] },
  { db: "Toki Riyadh · توكي", queries: ["Toki Riyadh"] },
  { db: "Olio · أوليو", queries: ["Olio Restaurant Riyadh"] },
  { db: "Mado · مادو", queries: ["Mado Riyadh Boulevard"] },
  // Round 1 — cafes
  { db: "Drift Coffee Bar · دريفت", queries: ["Drift Coffee Bar Riyadh"] },
  { db: "Subul Coffee · سُبُل", queries: ["Subul Coffee Riyadh"] },
  { db: "Common Grounds · كومن غراوندز", queries: ["Common Grounds Riyadh"] },
  { db: "AND Coffee Studio · أند", queries: ["AND Coffee Studio Riyadh"] },
  { db: "The Roasting House · ذا روستينق", queries: ["The Roasting House Riyadh"] },
  { db: "Wadi Coffee Roasters · وادي", queries: ["Wadi Coffee Riyadh"] },
  { db: "Mokha 1450 · مخا", queries: ["Mokha 1450 Riyadh"] },
  { db: "Black Stone Coffee · بلاك ستون", queries: ["Black Stone Coffee Riyadh"] },
  { db: "Marble & Beans · ماربل آند بينز", queries: ["Marble and Beans Coffee Riyadh"] },
  { db: "Brewing Stories · برووينق ستوريز", queries: ["Brewing Stories Coffee Riyadh"] },
  { db: "Frame Coffee · فريم", queries: ["Frame Coffee Riyadh"] },
  { db: "Manhattan Cafe · مانهاتن", queries: ["Manhattan Cafe Riyadh"] },
  { db: "Roasters and Bakers · روسترز", queries: ["Roasters and Bakers Riyadh"] },
  { db: "The Lab Coffee · ذا لاب", queries: ["The Lab Coffee Riyadh"] },
  // Round 2 — fine dining
  { db: "Maiz at Bujairi (Modern)", queries: ["Maiz Bujairi Diriyah"] },
  { db: "Stage by Hakkasan", queries: ["Stage Hakkasan Bujairi Diriyah"] },
  { db: "Coya Riyadh · كويا الرياض", queries: ["Coya Riyadh Via"] },
  { db: "Zuma Riyadh · زوما", queries: ["Zuma Riyadh"] },
  { db: "Caviar Kaspia · كافيار كاسبيا", queries: ["Caviar Kaspia Riyadh"] },
  { db: "Em Sherif Sea · إم شريف", queries: ["Em Sherif Riyadh"] },
  { db: "Gaia Riyadh · غايا", queries: ["Gaia Restaurant Riyadh"] },
  { db: "Almond by Akira Back", queries: ["Almond Akira Back Riyadh"] },
  { db: "Twiggy by Twiggy", queries: ["Twiggy Restaurant Riyadh"] },
  { db: "Tatel Riyadh · تاتيل", queries: ["Tatel Riyadh"] },
  // Round 2 — mid restaurants
  { db: "Burger Joint · برغر جوينت", queries: ["Burger Joint Riyadh"] },
  { db: "Section Z · سكشن زد", queries: ["Section Z Riyadh"] },
  { db: "Sumo Sushi · سومو", queries: ["Sumo Sushi Bar Riyadh"] },
  { db: "Maharaja by Vineet · ماهاراجا", queries: ["Maharaja by Vineet Riyadh"] },
  { db: "Pasta House · باستا هاوس", queries: ["Pasta House Riyadh"] },
  { db: "Tortilla Casa · تورتيلا كاسا", queries: ["Tortilla Casa Riyadh"] },
  { db: "Gusto Riyadh · غوستو", queries: ["Gusto Riyadh"] },
  { db: "Madeleine · مادلين", queries: ["Madeleine Restaurant Riyadh"] },
  { db: "Akasaka · أكاساكا", queries: ["Akasaka Restaurant Riyadh"] },
  { db: "Hashi Restaurant · هاشي", queries: ["Hashi Restaurant Riyadh"] },
  { db: "Khazana · خزانة", queries: ["Khazana Restaurant Riyadh"] },
  { db: "Najd Village (King Abdullah) · نجد فيليج", queries: ["Najd Village King Abdullah Riyadh"] },
  { db: "Albaik · البيك", queries: ["Albaik Riyadh"] },
  { db: "Hadramaut Mandi · حضرموت", queries: ["Hadramaut Mandi Riyadh"] },
  // Round 2 — coffee
  { db: "Camel Step · جمل ستيب", queries: ["Camel Step Coffee Roasters Riyadh"] },
  { db: "Drink and Drown · درنك أند دراون", queries: ["Drink and Drown Coffee Riyadh"] },
  { db: "Casca Coffee · كاسكا", queries: ["Casca Coffee Riyadh"] },
  { db: "Almer Coffee · ألمر", queries: ["Almer Coffee Riyadh"] },
  { db: "Roastery by Sammar", queries: ["Roastery by Sammar Riyadh"] },
  { db: "Coffea Riyadh · كوفيا", queries: ["Coffea Riyadh"] },
  { db: "The Coffee Address · ذا كوفي أدرس", queries: ["The Coffee Address Riyadh"] },
  { db: "Brewed by Faisal · برود باي فيصل", queries: ["Brewed by Faisal Riyadh"] },
  { db: "Brewing Co · بروينج كو", queries: ["Brewing Co Riyadh"] },
  { db: "Roastery by % Arabica", queries: ["% Arabica Boulevard Riyadh"] },
  { db: "Khabaz Café · خباز", queries: ["Khabaz Cafe Riyadh"] },
  { db: "Kayan Cafe · كيان", queries: ["Kayan Cafe Riyadh"] },
  { db: "Kineya Coffee · كينيا", queries: ["Kineya Coffee Riyadh"] },
  { db: "Nineteen Coffee · ١٩", queries: ["Nineteen Coffee Riyadh"] },
  { db: "Hekayat Coffee · حكايات", queries: ["Hekayat Coffee Riyadh"] },
  // Round 2 — sweets & sights
  { db: "Saadeddin Pastry · سعد الدين", queries: ["Saadeddin Pastry Riyadh"] },
  { db: "Helu Helwa · حلو حلوة", queries: ["Helu Helwa Riyadh"] },
  { db: "Roly's Coffee & Slice", queries: ["Roly's Coffee Slice Riyadh"] },
  { db: "Crumbl Cookies Riyadh", queries: ["Crumbl Cookies Riyadh"] },
  { db: "Bateel · بتيل", queries: ["Bateel Riyadh"] },
  { db: "JAX District · حي جاكس", queries: ["JAX District Diriyah"] },
  { db: "Diriyah Gate · بوابة الدرعية", queries: ["Diriyah Gate"] },
  { db: "King Salman Park · حديقة الملك سلمان", queries: ["King Salman Park Riyadh"] },
  { db: "Riyadh Zoo · حديقة حيوان الرياض", queries: ["Riyadh Zoo"] },
  { db: "Salam Park · حديقة السلام", queries: ["Salam Park Riyadh"] },
  { db: "Riyadh Front · واجهة الرياض", queries: ["Riyadh Front"] },
  { db: "Park View Riyadh · بارك فيو", queries: ["Park View Riyadh Hittin"] },
  { db: "U-Walk Riyadh", queries: ["U-Walk Riyadh"] },
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
  // Photo Service URL (legacy). Server expands the redirect on first hit
  // and we cache the final URL.
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
  if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) return null;
  return data.results[0] as Hit;
}

async function main() {
  let ok = 0, missing = 0;
  console.log("-- Generated by scripts/resolve-riyadh-photos.ts");
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
    const sets: string[] = [`google_place_id = '${sqlEscape(hit.place_id)}'`];
    if (photo) sets.push(`photo_url = '${sqlEscape(photoUrl(photo))}'`);
    if (hit.geometry?.location) {
      sets.push(`lat = ${hit.geometry.location.lat}`);
      sets.push(`lng = ${hit.geometry.location.lng}`);
    }
    if (hit.rating != null) sets.push(`rating = ${hit.rating}`);
    if (hit.user_ratings_total != null) sets.push(`review_count = ${hit.user_ratings_total}`);
    console.log(
      `UPDATE places SET ${sets.join(", ")} WHERE name = '${sqlEscape(p.db)}';`
    );
    ok++;
    await new Promise((r) => setTimeout(r, 60)); // gentle pacing
  }
  console.error(`\n✓ resolved ${ok} / missing ${missing}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
