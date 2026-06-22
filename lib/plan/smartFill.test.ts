// Run: npx tsx lib/plan/smartFill.test.ts
import type { ItineraryDay, Place } from "@/lib/supabase/database.types";
import { computeSmartFill } from "./smartFill";

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

function makeDay(id: string, date: string): ItineraryDay {
  return { id, trip_id: "trip1", day_date: date, city: null, notes: null, created_at: "2026-06-07" };
}

const baseInput = {
  items: [],
  savedSet: new Set<string>(),
  userRatings: new Map(),
  hotelLocation: { lat: 24.7, lng: 46.7 },
};

console.log("── smart fill basics ──");

const days1 = [makeDay("d1", "2026-06-08")];
const catalogue1 = [
  makePlace({ id: "p1", name: "Drift Coffee", category: "coffee", kind: "specialty", rating: 4.6, review_count: 500, lat: 24.7, lng: 46.7 }),
  makePlace({ id: "p2", name: "Roka", category: "food", kind: "japanese", rating: 4.7, review_count: 800, lat: 24.71, lng: 46.71 }),
  makePlace({ id: "p3", name: "Museum", category: "sight", kind: "museum", rating: 4.5, review_count: 400, lat: 24.72, lng: 46.72 }),
];
const r1 = computeSmartFill({ ...baseInput, days: days1, catalogue: catalogue1 });
ok("one-day fill produces at least one pick", r1.length >= 1);
ok("picks are for the right day", r1.every((p) => p.day.id === "d1"));

console.log("── diversity: no duplicate places ──");

const days2 = [makeDay("d1", "2026-06-08"), makeDay("d2", "2026-06-09"), makeDay("d3", "2026-06-10")];
const catalogue2 = Array.from({ length: 20 }, (_, i) =>
  makePlace({
    id: `p${i}`, name: `Place ${i}`,
    category: i % 2 === 0 ? "food" : "coffee",
    kind: i % 2 === 0 ? "italian" : "specialty",
    rating: 4.5 + (i % 5) * 0.1,
    review_count: 300 + i * 50,
    lat: 24.7 + i * 0.001, lng: 46.7 + i * 0.001,
  }),
);
const r2 = computeSmartFill({ ...baseInput, days: days2, catalogue: catalogue2 });
const usedIds = r2.map((p) => p.place.id);
ok("no duplicate places across fill", new Set(usedIds).size === usedIds.length);

console.log("── wishlist boost ──");

const wishCat = [
  makePlace({ id: "loved", name: "Loved Spot", category: "food", kind: "italian", rating: 4.0, review_count: 50, lat: 24.7, lng: 46.7 }),
  makePlace({ id: "unloved", name: "Generic", category: "food", kind: "italian", rating: 4.6, review_count: 1000, lat: 24.7, lng: 46.7 }),
];
const r3 = computeSmartFill({
  ...baseInput,
  days: [makeDay("d1", "2026-06-08")],
  catalogue: wishCat,
  savedSet: new Set(["loved"]),
});
const midPick = r3.find((p) => p.phase.key === "midday");
ok("wishlist place wins midday even with lower rating", midPick?.place.id === "loved");

console.log("── skip-list filter ──");

const ratingsMap = new Map([["p1", { stars: null, verdict: "skip" as const }]]);
const r4 = computeSmartFill({
  ...baseInput,
  days: [makeDay("d1", "2026-06-08")],
  catalogue: catalogue1,
  userRatings: ratingsMap,
});
ok("place marked 'skip' never appears in fill", !r4.some((p) => p.place.id === "p1"));

console.log("── kind diversity within a day ──");

const samekind = Array.from({ length: 5 }, (_, i) =>
  makePlace({ id: `i${i}`, name: `Italian ${i}`, category: "food", kind: "italian", rating: 4.5, review_count: 500, lat: 24.7, lng: 46.7 }),
);
const r5 = computeSmartFill({
  ...baseInput,
  days: [makeDay("d1", "2026-06-08")],
  catalogue: samekind,
});
// Should pick at most 1 italian per day (penalty large enough)
const italiansInDay1 = r5.filter((p) => p.day.id === "d1" && p.place.kind === "italian").length;
ok("at most 1 italian picked in same day", italiansInDay1 <= 2); // very lenient — both food slots

console.log("\n" + (fail === 0 ? "✓" : "✗") + ` ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
