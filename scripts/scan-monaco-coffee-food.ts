// One-off: run two scans for موناكو (coffee + food) and dump matches as JSON
// for the caller to persist via Supabase MCP. Does NOT write to DB itself.

import { scanCity, type ScanCandidate } from "../lib/trending/scan";

const COFFEE: ScanCandidate[] = [
  { id: "99612395-9a32-438a-9de4-bde7c190dee1", name: "Caffè Milano · كافيه ميلانو", category: "coffee", rating: 4.7, review_count: 4381 },
  { id: "3f9c722f-07aa-4d71-a894-3d7ba2d9cd47", name: "Café de Paris Monte-Carlo · كافيه دو باري", category: "coffee", rating: 4.1, review_count: 4100 },
  { id: "87fd5f79-e566-4c41-8a9a-5f4785d9d142", name: "Casino Café de Paris", category: "coffee", rating: 4.3, review_count: 2206 },
  { id: "15fea5d9-ed4c-4b80-a0bd-37226dff437c", name: "Starbucks", category: "coffee", rating: 4.1, review_count: 1723 },
  { id: "2a23c4fc-3b2e-465c-9d86-23059f02c99c", name: "Santo Gelato Monaco", category: "coffee", rating: 4.6, review_count: 567 },
  { id: "ae426928-9c92-44e0-a2b7-a7108983c134", name: "L’Épi d’Or", category: "coffee", rating: 4.1, review_count: 521 },
  { id: "aff54805-1b6e-4a18-b81b-2e082e3c297c", name: "EUNOIA COFFEE", category: "coffee", rating: 4.7, review_count: 437 },
  { id: "0177e346-a54b-4a07-8dc8-9b7236fc3c34", name: "كاسا ديل كافيه", category: "coffee", rating: 4.3, review_count: 422 },
  { id: "2c881ed9-8931-4d93-8a44-3183df263d14", name: "Le Bar Américain", category: "coffee", rating: 4.3, review_count: 392 },
  { id: "a750e6b1-a67e-46a3-89af-6996f93a92eb", name: "Pasticceria Cova Moulins", category: "coffee", rating: 4.3, review_count: 376 },
  { id: "b54b32f1-9f9d-44b5-8515-919c63a9b2f8", name: "Mitchell's · ميتشلز", category: "coffee", rating: 4.5, review_count: 320 },
  { id: "220901ad-1355-42c4-9ca8-6229998add9f", name: "Café Llorca · كافيه لوركا", category: "coffee", rating: 4.6, review_count: 267 },
  { id: "b456c307-c5a7-419b-8f3d-d9cd7cf7ef05", name: "Pâtisserie Riviera", category: "coffee", rating: 4.4, review_count: 261 },
  { id: "a86f165c-fa5e-4377-a4c6-7bcdf986b78b", name: "Garden Perk", category: "coffee", rating: 4.4, review_count: 103 },
  { id: "8901707e-64ff-4fbb-a7ea-b9f33f63e64e", name: "Le Café Lacoste", category: "coffee", rating: 4.7, review_count: 89 },
  { id: "cbd32cd0-d634-400c-9f79-7144fb547918", name: "Espresso Napoli Bd. d'Italie", category: "coffee", rating: 4.5, review_count: 81 },
  { id: "a5af293c-7463-4cc9-a46f-f48137198613", name: "Le Deli Robuchon Monaco", category: "coffee", rating: 4.7, review_count: 72 },
  { id: "b05c8fe0-6176-4334-b9cf-f1d3f4e5af5f", name: "Café Semplice Monaco", category: "coffee", rating: 4.5, review_count: 53 },
  { id: "99396ccb-655f-4bbd-8c92-4d8e8f7af8d6", name: "One Love Café Monaco", category: "coffee", rating: 4.5, review_count: 52 },
  { id: "94be9cc3-d4c2-4f85-a4a3-9b105a60e1ab", name: "Tenka Matcha", category: "coffee", rating: 4.6, review_count: 34 },
];

const FOOD: ScanCandidate[] = [
  { id: "2febd81e-4401-462e-b739-910dbdac0bc7", name: "فيرمونت مونتي كارلو", category: "food", rating: 4.5, review_count: 4995 },
  { id: "0f59eef9-ebb0-41ea-b162-3733361219ba", name: "Caffè Milano", category: "food", rating: 4.7, review_count: 4377 },
  { id: "10eb6e39-1b64-4123-a440-92a2720a432d", name: "Café de Paris Monte-Carlo", category: "food", rating: 4.1, review_count: 4102 },
  { id: "347882bf-cf16-4a9e-b83d-729f297df53d", name: "Steak ‘n Shake", category: "food", rating: 4.2, review_count: 2983 },
  { id: "b8f708f8-773b-47fb-9d0b-f803747bb214", name: "Buddha-Bar Monte-Carlo", category: "food", rating: 4.5, review_count: 2737 },
  { id: "27576b38-b283-46f6-9ad9-0a55f394eae3", name: "Stars 'N' Bars · ستارز آند بارز", category: "food", rating: 4.2, review_count: 2682 },
  { id: "e3023d18-1a9d-44bf-a753-c3dd103bdb56", name: "Bella Vita", category: "food", rating: 4.2, review_count: 2660 },
  { id: "772976af-4590-47df-82db-5743376e4c30", name: "Giacomo", category: "food", rating: 4.6, review_count: 2562 },
  { id: "9348a272-3bac-4d6a-8d58-cd8ccb9f49dd", name: "La Salière", category: "food", rating: 4.6, review_count: 2021 },
  { id: "f64f1a90-a401-4e9b-952d-14189b579c21", name: "La Vista Bar · فيستا بار", category: "food", rating: 4.7, review_count: 1920 },
  { id: "b8c69a8c-3637-424f-b647-3a80d08da7a7", name: "La Môme Monte-Carlo", category: "food", rating: 4.7, review_count: 1871 },
  { id: "1a24d8dd-1f7a-4a11-af35-b0bcec6c174a", name: "La Note Bleue · لا نوت بلو", category: "food", rating: 4.5, review_count: 1747 },
  { id: "19d24a29-cd51-4428-957b-1959676deb60", name: "Beefbar", category: "food", rating: 4.4, review_count: 1743 },
  { id: "76a28a4c-2d33-40f7-a604-8e58b39ac4e1", name: "Maya Mia", category: "food", rating: 4.4, review_count: 1406 },
  { id: "00d15964-b16d-432c-8e04-a3b574371057", name: "Restaurant A'TREGO", category: "food", rating: 4.4, review_count: 1401 },
  { id: "f19248ac-18a1-4290-bc86-fa2131e3a450", name: "Crazy Pizza Monte Carlo", category: "food", rating: 4.3, review_count: 1243 },
  { id: "47c25211-8422-41bc-8cea-899f48efb810", name: "MayaBay", category: "food", rating: 4.4, review_count: 1204 },
  { id: "cfcf6295-155d-452f-a883-430121a2dc0e", name: "Il Terrazzino", category: "food", rating: 4.5, review_count: 1193 },
  { id: "51751444-27a0-4591-ab00-943d415cac4a", name: "Avenue 31", category: "food", rating: 4.5, review_count: 1169 },
  { id: "bd39a313-be2d-440b-b57f-7ffb4326936f", name: "مايبورن ريفييرا", category: "food", rating: 4.6, review_count: 1130 },
  { id: "c1023fb4-5beb-4137-87be-b4649aa110ae", name: "Sass Café · ساس كافيه", category: "food", rating: 4.2, review_count: 936 },
  { id: "a319ec79-4f34-4201-a82c-d217676e9c27", name: "Il fornaio", category: "food", rating: 4.9, review_count: 905 },
  { id: "960f5e7b-a0f8-4d40-b31a-fcf913150e17", name: "Quai des Artistes", category: "food", rating: 4.5, review_count: 904 },
  { id: "f254f6ee-c94c-4df5-9dab-42f914272837", name: "Cipriani Monte-Carlo", category: "food", rating: 4.4, review_count: 900 },
  { id: "331c4cc9-7a17-4b5b-84d9-caaf362471d5", name: "COYA Monte-Carlo · كويا", category: "food", rating: 4.4, review_count: 882 },
  { id: "dd3d4894-3c8d-427b-b05b-a16e6a9ba8f0", name: "The Pearls of Monte-Carlo", category: "food", rating: 4.8, review_count: 866 },
  { id: "6011bac9-d1eb-4308-86b0-756a10b4691c", name: "Equivoque - Exclusive Rooftop Terrace", category: "food", rating: 4.7, review_count: 861 },
  { id: "595d42ed-76a0-4026-8c80-d267fc6cdad0", name: "Twiga Monte-Carlo · تويغا", category: "food", rating: 4.2, review_count: 824 },
  { id: "8ccfdf3c-d1a6-4568-aecb-088abba5fd9b", name: "Loga · لوغا", category: "food", rating: 4.6, review_count: 801 },
  { id: "92e19ec9-ff4f-4f32-923a-cef8c15ac47f", name: "Amici Miei", category: "food", rating: 4.6, review_count: 727 },
  { id: "0adeffa5-cb45-41e5-97f7-9f61f41bd8d2", name: "Le Louis XV - Alain Ducasse", category: "food", rating: 4.6, review_count: 521 },
  { id: "98eb2cb2-f480-4365-b7d7-fd52f4f762fb", name: "NOBU FAIRMONT MONTE CARLO", category: "food", rating: 4.2, review_count: 574 },
  { id: "2e6260aa-beed-43ec-a3c4-8310f396636e", name: "Reginèlla", category: "food", rating: 4.7, review_count: 645 },
  { id: "bea915a9-1c7c-46c6-9f57-58e471a0cea5", name: "Song Qi", category: "food", rating: 4.4, review_count: 486 },
  { id: "5badacfc-44fc-453c-bb2e-4c5ac5832817", name: "Maison des Pâtes Condamine", category: "food", rating: 4.6, review_count: 467 },
  { id: "3439475c-b2c5-49b4-842c-bfea582f93a6", name: "Pavyllon Monte-Carlo, Yannick Alléno", category: "food", rating: 4.6, review_count: 364 },
  { id: "5ebaa4da-1bc0-4d2c-826f-29316b1d7a46", name: "Moshi Moshi", category: "food", rating: 4.4, review_count: 359 },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY missing");
    process.exit(1);
  }
  const allMatches: Array<{ focus: string; matches: unknown[]; cost: number; tokens: number; searches: number }> = [];

  for (const [focus, candidates] of [["coffee", COFFEE], ["food", FOOD]] as const) {
    console.log(`\n📍 موناكو · focus=${focus} · ${candidates.length} candidates`);
    const t0 = Date.now();
    const result = await scanCity({
      cityKey: "monaco",
      cityLabel: "موناكو",
      candidates,
      categoryFocus: focus,
    });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ⏱  ${elapsed}s · ${result.searches} searches · ${result.matches.length} matches · $${result.costUsd.toFixed(4)}`);
    if (result.warnings.length) console.log(`  ⚠ ${result.warnings.join(", ")}`);
    for (const m of result.matches) {
      const cand = candidates.find((c) => c.id === m.place_id);
      console.log(`    ${m.score}/100  ${m.source.padEnd(9)}  ${cand?.name ?? "(unknown)"}`);
      console.log(`             ${m.evidence_url}`);
    }
    allMatches.push({
      focus,
      matches: result.matches,
      cost: result.costUsd,
      tokens: result.inputTokens + result.outputTokens,
      searches: result.searches,
    });
  }

  // Final JSON for piping into Supabase MCP
  console.log("\n\n========== JSON OUTPUT (for DB write) ==========");
  console.log(JSON.stringify(allMatches, null, 2));

  const total = allMatches.reduce((s, x) => s + x.cost, 0);
  console.log(`\n💰 Total cost: $${total.toFixed(4)} ≈ ${(total * 3.75).toFixed(2)} ر.س`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
