// Run: npx tsx lib/discover/offerings.test.ts
import type { Place } from "@/lib/supabase/database.types";
import { mealTimes, coffeeOfferings, activityVibe, allOfferings } from "./offerings";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

function makePlace(over: Partial<Place>): Place {
  return {
    id: "x", google_place_id: null, external_source: "google",
    name: "X", category: "food", kind: null,
    city: "riyadh", city_label: "الرياض",
    lat: null, lng: null, address: null, phone: null, website: null,
    rating: null, review_count: null, price_level: null,
    cost_estimate: null, cost_currency: "SAR", cost_confidence: "low",
    opening_hours: null, open_status_cache: null,
    photo_url: null, photo_urls: null, google_maps_url: null,
    tags: null, highlights: null, tip: null,
    hidden_gem_score: null, is_editor_pick: false, data_freshness: "fresh",
    review_summary: null, google_reviews: null, enriched_at: null,
    ai_summary: null,
    trending_score: null, trending_source: null,
    trending_updated_at: null, trending_evidence: null,
    ...over,
  };
}

console.log("── meal times: food ──");
ok("fine_dining → عشاء only",
  JSON.stringify(mealTimes(makePlace({ kind: "fine_dining" })).map((m) => m.key)) === '["dinner"]');
ok("italian → غداء + عشاء",
  JSON.stringify(mealTimes(makePlace({ kind: "italian" })).map((m) => m.key)) === '["lunch","dinner"]');
ok("burger → غداء + سناك + عشاء",
  JSON.stringify(mealTimes(makePlace({ kind: "burger" })).map((m) => m.key)) === '["lunch","snack","dinner"]');
ok("bistro → برانش + غداء + عشاء",
  JSON.stringify(mealTimes(makePlace({ kind: "bistro" })).map((m) => m.key)) === '["brunch","lunch","dinner"]');
ok("tag 'فطور' adds breakfast for fine_dining",
  mealTimes(makePlace({ kind: "fine_dining", tags: ["فطور"] })).some((m) => m.key === "breakfast"));

console.log("── meal times: coffee (NEW) ──");
ok("specialty coffee → فطور + برانش defaults",
  JSON.stringify(mealTimes(makePlace({ category: "coffee", kind: "specialty" })).map((m) => m.key)) === '["breakfast","brunch"]');
ok("roastery coffee → فطور + برانش defaults",
  JSON.stringify(mealTimes(makePlace({ category: "coffee", kind: "roastery" })).map((m) => m.key)) === '["breakfast","brunch"]');
ok("coffee + bakery tag → adds lunch + snack",
  mealTimes(makePlace({ category: "coffee", kind: "specialty", tags: ["bakery"] })).map((m) => m.key).join() === "breakfast,brunch,lunch,snack");
ok("coffee + brunch tag → has brunch",
  mealTimes(makePlace({ category: "coffee", kind: "specialty", tags: ["brunch"] })).some((m) => m.key === "brunch"));
ok("sweet category → empty meal times",
  mealTimes(makePlace({ category: "sweet", kind: "icecream" })).length === 0);

console.log("── coffee offerings ──");
ok("specialty cafe → قهوة مختصة",
  coffeeOfferings(makePlace({ category: "coffee", kind: "specialty" }))[0]?.key === "specialty");
ok("roastery cafe → قهوة مختصة + محمصة",
  coffeeOfferings(makePlace({ category: "coffee", kind: "roastery" })).map((o) => o.key).join() === "specialty,roastery");
ok("cafe with bakery tag → adds بيستري",
  coffeeOfferings(makePlace({ category: "coffee", kind: "specialty", tags: ["bakery"] })).some((o) => o.key === "pastry"));
ok("cafe with dessert tag → adds حلى",
  coffeeOfferings(makePlace({ category: "coffee", kind: "specialty", tags: ["dessert"] })).some((o) => o.key === "dessert"));
ok("ice cream shop → آيس كريم",
  coffeeOfferings(makePlace({ category: "sweet", kind: "icecream" }))[0]?.key === "icecream");

console.log("── activity vibe ──");
ok("museum → ثقافي",
  activityVibe(makePlace({ category: "sight", kind: "museum" }))[0]?.key === "cultural");
ok("hike → حركي",
  activityVibe(makePlace({ category: "event", kind: "hike" }))[0]?.key === "active");
ok("amusement park → حركي",
  activityVibe(makePlace({ category: "event", kind: "amusement" }))[0]?.key === "active");
ok("beach → استرخاء/إطلالة",
  activityVibe(makePlace({ category: "nature", kind: "beach" }))[0]?.key === "scenic");
ok("market → تسوّق",
  activityVibe(makePlace({ category: "sight", kind: "market" }))[0]?.key === "shopping");
ok("food place → no vibe",
  activityVibe(makePlace({ category: "food", kind: "italian" })).length === 0);
ok("unknown sight falls back to ثقافي",
  activityVibe(makePlace({ category: "sight", kind: null }))[0]?.key === "cultural");

console.log("── allOfferings composition ──");
ok("food restaurant gets meal times only",
  allOfferings(makePlace({ category: "food", kind: "italian" })).map((o) => o.key).join() === "lunch,dinner");
ok("specialty cafe gets specialty + meal times",
  allOfferings(makePlace({ category: "coffee", kind: "specialty" })).map((o) => o.key).join() === "specialty,breakfast,brunch");
ok("museum gets ثقافي vibe",
  allOfferings(makePlace({ category: "sight", kind: "museum" })).some((o) => o.key === "cultural"));

console.log("\n" + (fail === 0 ? "✓" : "✗") + ` ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
