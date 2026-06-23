// One-off: enrich the 6 Monaco places that are missing photos.
// Uses lib/google/enrich → Place Details (1 call/place) → Place Photo (1/place).
// Photos go through Place Photo's free 1000/month tier — net cost $0.

import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv({ path: path.join(__dirname, "..", ".env.local") });

import { enrichPlaceFromGoogle } from "../lib/google/enrich";

const TARGETS = [
  { id: "034f1969-4b7b-4b9b-b4c3-ba324d9cd62b", name: "Grimaldi Forum" },
  { id: "f3304449-a543-4af0-9622-73f4a5a459bd", name: "Thermes Marins" },
  { id: "ced6406b-f6e2-4b11-9c31-b50bff0c1258", name: "Richmont Monaco" },
  { id: "95733022-9ac5-43f5-910c-c3b4872b4d08", name: "Hoolon Wellness" },
  { id: "9433a5fc-e8c9-466b-b3e7-89ec7f7812e8", name: "La maison du Limoncello" },
  { id: "48e038e0-7d2a-434e-9396-c5a0980bb53e", name: "Kodera Matcha" },
];

async function main() {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const gkey = process.env.GOOGLE_MAPS_API_KEY;
  if (!supaUrl || !svc) {
    console.error("Missing SUPABASE env. Set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }
  if (!gkey) {
    console.error("Missing GOOGLE_MAPS_API_KEY in .env.local");
    process.exit(1);
  }
  const supabase = createClient(supaUrl, svc, { auth: { persistSession: false } });

  console.log(`Enriching ${TARGETS.length} Monaco places…\n`);
  let ok = 0, fail = 0;

  for (const t of TARGETS) {
    // Get the place row with google_place_id
    const { data: row } = await supabase
      .from("places")
      .select("id, google_place_id, name")
      .eq("id", t.id)
      .single();
    if (!row?.google_place_id) {
      console.log(`  ⏭  ${t.name}: no google_place_id, skipping`);
      fail++;
      continue;
    }
    process.stdout.write(`  ${t.name}… `);
    const t0 = Date.now();
    const result = await enrichPlaceFromGoogle(row.id, row.google_place_id, row.name, "موناكو");
    const ms = Date.now() - t0;
    if (!result.ok) {
      console.log(`❌ ${result.reason ?? "fail"} (${ms}ms)`);
      fail++;
      continue;
    }
    // Apply the patch — photo_url goes onto the row
    if (result.patch) {
      const { error } = await supabase.from("places").update(result.patch).eq("id", row.id);
      if (error) { console.log(`❌ db update: ${error.message}`); fail++; continue; }
    }
    const hasPhoto = !!result.patch?.photo_url;
    console.log(`✅ photo=${hasPhoto ? "yes" : "no"} (${ms}ms)`);
    ok++;
  }

  console.log(`\nDone: ${ok} ok / ${fail} failed`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
