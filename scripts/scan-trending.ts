// One-off CLI runner for the trending scan.
//
// Reads .env.local, then scans the trip cities serially (Nice, Cannes,
// Monaco, Riyadh by default — pass city labels as args to override). Writes
// directly to Supabase via the service-role key, bypassing the API.
//
// Usage:
//   npx tsx scripts/scan-trending.ts                  # default 4 cities
//   npx tsx scripts/scan-trending.ts "نيس" "كان"      # specific cities
//
// Cost: ~$0.12 per city (Sonnet 4.6 + 6 web searches).

import { config as dotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv({ path: path.join(__dirname, "..", ".env.local") });

import {
  adminSupabase,
  pickCandidates,
  scanCity,
  applyMatches,
} from "../lib/trending/scan";

const DEFAULT_CITIES = [
  { key: "nice", label: "نيس" },
  { key: "cannes", label: "كان" },
  { key: "monaco", label: "موناكو" },
  { key: "riyadh", label: "الرياض" },
];

async function main() {
  const args = process.argv.slice(2);

  const supabase = adminSupabase();

  // If args were supplied, resolve them to {key,label}. Otherwise use defaults.
  let cities = DEFAULT_CITIES;
  if (args.length > 0) {
    cities = [];
    for (const arg of args) {
      // Try matching as both city (en) and city_label (ar).
      const { data: hit } = await supabase
        .from("places")
        .select("city,city_label")
        .or(`city.eq.${arg},city_label.eq.${arg}`)
        .limit(1)
        .maybeSingle();
      if (hit?.city) {
        cities.push({ key: hit.city, label: hit.city_label ?? arg });
      } else {
        console.warn(`[skip] '${arg}' not in catalogue`);
      }
    }
  }

  if (cities.length === 0) {
    console.error("no cities to scan");
    process.exit(1);
  }

  console.log(`\nScanning ${cities.length} cities:`, cities.map((c) => c.label).join(", "));
  console.log("=".repeat(60));

  let totalCost = 0;
  let totalWritten = 0;
  let totalCleared = 0;

  for (const c of cities) {
    console.log(`\n📍 ${c.label} (${c.key})`);
    const candidates = await pickCandidates(supabase, {
      city: c.key,
      city_label: c.label,
    });
    console.log(`   ${candidates.length} candidates`);

    if (candidates.length === 0) {
      console.log("   ⏭  skipped (no candidates)");
      continue;
    }

    const t0 = Date.now();
    try {
      const result = await scanCity({
        cityKey: c.key,
        cityLabel: c.label,
        candidates,
      });
      console.log(
        `   🔍 ${result.searches} searches · ${result.matches.length} matches · ` +
          `${result.inputTokens}+${result.outputTokens} tok · ` +
          `${Math.round(result.durationMs / 1000)}s · $${result.costUsd.toFixed(4)}`,
      );
      if (result.warnings.length) {
        console.log(`   ⚠  ${result.warnings.join(", ")}`);
      }

      const apply = await applyMatches(supabase, c.key, c.label, result.matches);
      console.log(`   ✅ wrote ${apply.written} · cleared ${apply.cleared}`);

      if (result.matches.length > 0) {
        console.log("   Top matches:");
        const sorted = [...result.matches].sort((a, b) => b.score - a.score).slice(0, 5);
        for (const m of sorted) {
          const cand = candidates.find((x) => x.id === m.place_id);
          console.log(`     ${m.score}/100  ${m.source.padEnd(9)}  ${cand?.name ?? m.place_id}`);
          if (m.evidence_snippet) console.log(`              "${m.evidence_snippet.slice(0, 80)}"`);
        }
      }

      totalCost += result.costUsd;
      totalWritten += apply.written;
      totalCleared += apply.cleared;
    } catch (e) {
      console.error(`   ❌ ${e instanceof Error ? e.message : String(e)}`);
    }

    // Be polite — small gap between cities.
    if (cities.indexOf(c) < cities.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Total: wrote ${totalWritten} · cleared ${totalCleared} · $${totalCost.toFixed(4)}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
