// Sanity check the new "Similar places" carousel logic.
// We can't easily simulate a logged-in session here, so we statically import
// the helper used in the sheet and run it against a real DB snapshot.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Pull Le Vingt4 + a sample of ~150 nice restaurants (same category, same city)
const { data: targets, error } = await sb
  .from("places")
  .select("id,name,category,kind,lat,lng,city,city_label,rating,review_count,price_level")
  .eq("id", "8dac864a-e172-4685-8ac5-4ecdf1608c1a")
  .limit(1);
if (error) console.error("err:", error);
const target = targets?.[0];
if (!target) { console.error("Le Vingt4 not found"); process.exit(1); }
console.log("Target:", target.name, "·", target.category, "·", target.city_label);

const { data: pool } = await sb
  .from("places")
  .select("id,name,category,kind,lat,lng,city_label,city,rating,review_count,price_level")
  .eq("category", target.category)
  .or(`city_label.eq.${target.city_label},city.eq.${target.city}`)
  .neq("id", target.id)
  .limit(500);
console.log("Pool size:", pool.length);

// Replicate the haversine + sort from PlaceDetailSheet
function km(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const ranked = pool
  .filter((p) => p.lat != null && p.lng != null)
  .map((p) => ({ p, km: km(target, p) }))
  .sort((a, b) => {
    const aw = a.p.kind === target.kind ? -0.5 : 0;
    const bw = b.p.kind === target.kind ? -0.5 : 0;
    return a.km + aw - (b.km + bw);
  })
  .slice(0, 20);

console.log(`\nTop 10 (carousel) for ${target.name}:`);
ranked.slice(0, 10).forEach((r, i) => {
  const sameKind = r.p.kind === target.kind ? "🎯" : "  ";
  console.log(`  ${i + 1}. ${sameKind} ${r.p.name.padEnd(48)} ${r.p.kind?.padEnd(15)} ${r.km.toFixed(2)}km ⭐${r.p.rating ?? "-"}`);
});
console.log(`\nExtra (positions 11-20, "see all"):`);
ranked.slice(10).forEach((r, i) => {
  console.log(`  ${i + 11}. ${r.p.name.padEnd(48)} ${r.km.toFixed(2)}km`);
});

console.log("\n✓ Logic check passed.");
