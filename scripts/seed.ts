// ─────────────────────────────────────────────────────────────
// Seed script — inserts/upserts the 82 curated places into Postgres.
// Run: npm run db:seed
// Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (server-only).
// ─────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { SEED_PLACES } from "../data/seed-places";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function seed() {
  console.log(`→ Seeding ${SEED_PLACES.length} places...`);
  let ok = 0, fail = 0;

  for (const place of SEED_PLACES) {
    const row = {
      google_place_id: place.google_place_id,
      external_source: "seed" as const,
      name: place.name,
      category: place.category,
      kind: place.kind ?? null,
      city: place.city,
      city_label: place.city_label,
      lat: place.lat,
      lng: place.lng,
      phone: place.phone ?? null,
      rating: place.rating ?? null,
      review_count: place.review_count ?? null,
      price_level: place.price_level ?? null,
      cost_estimate: place.cost_estimate ?? null,
      cost_currency: place.cost_currency,
      cost_confidence: place.cost_confidence,
      opening_hours: place.opening_hours,
      tags: place.tags ?? [],
      highlights: place.highlights ?? [],
      tip: place.tip,
      is_editor_pick: place.is_editor_pick ?? false,
    };

    // Upsert by google_place_id when present, else by (name + city)
    const { error } = place.google_place_id
      ? await supabase.from("places").upsert(row, { onConflict: "google_place_id" })
      : await supabase.from("places").insert(row);

    if (error) {
      fail++;
      console.error(`  ✗ ${place.name}: ${error.message}`);
    } else {
      ok++;
    }
  }

  console.log(`\n✓ Done: ${ok} inserted/updated, ${fail} failed.`);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
