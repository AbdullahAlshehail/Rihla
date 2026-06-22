// End-to-end verification of the trending-scan pipeline against real Monaco
// candidates. Does NOT touch the DB — only calls scanCity() and prints what
// Claude returned. Use this to confirm:
//   1. ANTHROPIC_API_KEY is valid and has credits
//   2. Haiku 4.5 + web_search returns valid save_trending tool calls
//   3. Cost stays in the ~$0.04 envelope
//   4. Returned place_ids match the catalogue (no hallucinated IDs)
//
// Usage: ANTHROPIC_API_KEY=... npx tsx scripts/verify-trending.ts

import { scanCity, type ScanCandidate } from "../lib/trending/scan";

const MONACO_CANDIDATES: ScanCandidate[] = [
  { id: "377c52eb-44d0-40c7-b1b5-3231245ba2dc", name: "Casino de Monte-Carlo · كازينو مونت كارلو", category: "event", rating: 4.6, review_count: 41943 },
  { id: "7d21bb30-0352-48af-8a83-377773be7c57", name: "Musée Océanographique · المتحف البحري", category: "sight", rating: 4.5, review_count: 32339 },
  { id: "705f0292-7acf-4d9b-a64f-46c54e60b103", name: "Palais Princier · القصر الأميري", category: "sight", rating: 4.6, review_count: 23771 },
  { id: "7e2a11cd-7680-4463-924c-9dfe6960e04c", name: "Place du Casino · ساحة الكازينو", category: "sight", rating: 4.6, review_count: 9500 },
  { id: "19742a10-1941-4bef-881c-5cbfd3bc208c", name: "Princess Grace Japanese Garden", category: "nature", rating: 4.6, review_count: 6872 },
  { id: "a8df1149-f9bc-4bc7-a59a-170291af4d60", name: "Private Cars Collection of HSH Prince of Monaco", category: "sight", rating: 4.7, review_count: 6782 },
  { id: "034f1969-4b7b-4b9b-b4c3-ba324d9cd62b", name: "Grimaldi Forum", category: "event", rating: 4.6, review_count: 5355 },
  { id: "99612395-9a32-438a-9de4-bde7c190dee1", name: "Caffè Milano · كافيه ميلانو", category: "coffee", rating: 4.7, review_count: 4381 },
  { id: "22cb12cd-e358-49e9-8f0f-29548c05e9c4", name: "Exotic Garden of Monaco", category: "sight", rating: 4.6, review_count: 3716 },
  { id: "6defc549-939f-4baa-a021-9fc0d70451cf", name: "Yacht Club de Monaco · نادي اليخوت", category: "sight", rating: 4.7, review_count: 2793 },
  { id: "b8f708f8-773b-47fb-9d0b-f803747bb214", name: "Buddha-Bar Monte-Carlo", category: "food", rating: 4.5, review_count: 2737 },
  { id: "27576b38-b283-46f6-9ad9-0a55f394eae3", name: "Stars 'N' Bars · ستارز آند بارز", category: "food", rating: 4.2, review_count: 2682 },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  console.log("=".repeat(70));
  console.log("Trending scan verification — Monaco · 12 candidates");
  console.log("=".repeat(70));
  console.log("Model: claude-haiku-4-5-20251001");
  console.log("Caps: 3 web_searches · 2048 output tokens · $1 ceiling");
  console.log("");
  console.log("⏱  Calling Claude…");

  const t0 = Date.now();
  const result = await scanCity({
    cityKey: "monaco",
    cityLabel: "موناكو",
    candidates: MONACO_CANDIDATES,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log("");
  console.log("─".repeat(70));
  console.log(`✅ Done in ${elapsed}s`);
  console.log(`   Web searches:  ${result.searches}`);
  console.log(`   Input tokens:  ${result.inputTokens}`);
  console.log(`   Output tokens: ${result.outputTokens}`);
  console.log(`   💰 Cost: $${result.costUsd.toFixed(4)}`);
  if (result.warnings.length) {
    console.log(`   ⚠  Warnings: ${result.warnings.join(", ")}`);
  }
  console.log(`   📊 Matches found: ${result.matches.length}`);
  console.log("");

  // Validate matches against candidate UUIDs to confirm no hallucination
  const candidateIds = new Set(MONACO_CANDIDATES.map((c) => c.id));
  let hallucinated = 0;
  if (result.matches.length === 0) {
    console.log("   (No viral places found — silence is correct if nothing trends)");
  } else {
    console.log("   Match details:");
    for (const m of result.matches) {
      const known = candidateIds.has(m.place_id);
      const cand = MONACO_CANDIDATES.find((c) => c.id === m.place_id);
      if (!known) hallucinated++;
      console.log(
        `     ${known ? "✓" : "✗"} ${m.score}/100  ${m.source.padEnd(9)}  ${cand?.name ?? "(UUID NOT IN CANDIDATES — hallucinated!)"}`,
      );
      if (m.evidence_snippet) {
        console.log(`             "${m.evidence_snippet.slice(0, 90)}"`);
      }
      console.log(`             ${m.evidence_url}`);
    }
  }

  console.log("");
  console.log("─".repeat(70));
  if (hallucinated > 0) {
    console.log(`❌ ${hallucinated} match(es) had IDs NOT in the candidate set`);
    process.exit(2);
  }
  if (result.costUsd > 1) {
    console.log(`❌ Cost exceeded $1 ceiling: $${result.costUsd.toFixed(4)}`);
    process.exit(3);
  }
  console.log(`✅ End-to-end verification PASSED — pipeline is healthy.`);
}

main().catch((e) => {
  console.error("❌ FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
