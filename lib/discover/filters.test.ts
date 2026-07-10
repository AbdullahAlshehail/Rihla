// Unit tests for discover filters — pure logic, no DB.
// Run: npx tsx lib/discover/filters.test.ts

import type { Place } from "@/lib/supabase/database.types";
import { applyFilters, countPerFilter, trendBadge, type DiscoverFilterId } from "./filters";
import { normalizeVenueName } from "@/lib/trending/discover";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// Test factory — minimal Place with sensible defaults
function makePlace(over: Partial<Place>): Place {
  return {
    id: "x", google_place_id: null, external_source: "google",
    name: "X", category: "food", kind: null,
    city: "cannes", city_label: "Cannes",
    lat: null, lng: null, address: null, phone: null, website: null,
    rating: null, review_count: null, price_level: null,
    cost_estimate: null, cost_currency: "EUR", cost_confidence: "low",
    opening_hours: null, open_status_cache: null,
    photo_url: null, photo_urls: null, google_maps_url: null,
    tags: null, highlights: null, tip: null,
    hidden_gem_score: null, is_editor_pick: false, data_freshness: "fresh",
    review_summary: null, google_reviews: null, enriched_at: null,
    earliest_review_at: null, ai_summary: null,
    trending_score: null, trending_source: null,
    trending_updated_at: null, trending_evidence: null, trending_first_seen_at: null,
    priority: null,
    best_time: null,
    short_ar: null,
    practical_warning: null,
    seasonal: false,
    reservation_level: null,
    best_for: null,
    country_code: null,
    ...over,
  };
}

const ctx = { savedSet: new Set<string>(), now: new Date("2026-06-06T14:00:00Z") };

console.log("── michelin heuristic ──");
ok("kind=michelin counts",
  applyFilters([makePlace({ id: "a", kind: "michelin" })], new Set(["michelin" as DiscoverFilterId]), ctx).length === 1);
ok("tags contain ميشلان counts",
  applyFilters([makePlace({ id: "b", tags: ["ميشلان"] })], new Set(["michelin" as DiscoverFilterId]), ctx).length === 1);
ok("ai_summary contains michelin counts",
  applyFilters([makePlace({ id: "c", ai_summary: "Two Michelin stars and a view." })], new Set(["michelin" as DiscoverFilterId]), ctx).length === 1);
ok("price=4 + rating=4.7 + 500 reviews counts as michelin proxy",
  applyFilters([makePlace({ id: "d", price_level: 4, rating: 4.7, review_count: 500 })], new Set(["michelin" as DiscoverFilterId]), ctx).length === 1);
ok("regular fine dining without star signals does NOT count as michelin",
  applyFilters([makePlace({ id: "e", price_level: 3, rating: 4.6, kind: "fine_dining" })], new Set(["michelin" as DiscoverFilterId]), ctx).length === 0);

console.log("── fine dining ──");
ok("kind=fine_dining matches",
  applyFilters([makePlace({ id: "a", kind: "fine_dining" })], new Set(["fine_dining" as DiscoverFilterId]), ctx).length === 1);
ok("kind=michelin also matches fine_dining",
  applyFilters([makePlace({ id: "b", kind: "michelin" })], new Set(["fine_dining" as DiscoverFilterId]), ctx).length === 1);
ok("non-food never matches fine_dining",
  applyFilters([makePlace({ id: "c", category: "coffee", price_level: 4, rating: 4.9 })], new Set(["fine_dining" as DiscoverFilterId]), ctx).length === 0);
ok("food + price 4 + 4.5★ matches fine_dining proxy",
  applyFilters([makePlace({ id: "d", price_level: 4, rating: 4.5 })], new Set(["fine_dining" as DiscoverFilterId]), ctx).length === 1);

console.log("── specialty coffee ──");
ok("coffee + kind=specialty matches",
  applyFilters([makePlace({ id: "a", category: "coffee", kind: "specialty" })], new Set(["specialty_coffee" as DiscoverFilterId]), ctx).length === 1);
ok("coffee + kind=casual does not match",
  applyFilters([makePlace({ id: "b", category: "coffee", kind: "casual" })], new Set(["specialty_coffee" as DiscoverFilterId]), ctx).length === 0);

console.log("── hidden gem ──");
ok("hidden_gem_score>=70 matches",
  applyFilters([makePlace({ id: "a", hidden_gem_score: 80 })], new Set(["hidden_gem" as DiscoverFilterId]), ctx).length === 1);
ok("4.8★ + 200 reviews matches as gem",
  applyFilters([makePlace({ id: "b", rating: 4.8, review_count: 200 })], new Set(["hidden_gem" as DiscoverFilterId]), ctx).length === 1);
ok("4.8★ + 5k reviews does NOT match (too popular)",
  applyFilters([makePlace({ id: "c", rating: 4.8, review_count: 5000 })], new Set(["hidden_gem" as DiscoverFilterId]), ctx).length === 0);

console.log("── new spot ──");
ok("tags=['جديد'] matches new_spot",
  applyFilters([makePlace({ id: "a", tags: ["جديد"] })], new Set(["new_spot" as DiscoverFilterId]), ctx).length === 1);
ok("4.6★ + 100 reviews matches new_spot heuristic",
  applyFilters([makePlace({ id: "b", rating: 4.6, review_count: 100 })], new Set(["new_spot" as DiscoverFilterId]), ctx).length === 1);
ok("4.6★ + 8k reviews does NOT match new_spot (too established)",
  applyFilters([makePlace({ id: "c", rating: 4.6, review_count: 8000 })], new Set(["new_spot" as DiscoverFilterId]), ctx).length === 0);
ok("4.5★ + 600 reviews matches new_spot wider window",
  applyFilters([makePlace({ id: "d", rating: 4.5, review_count: 600 })], new Set(["new_spot" as DiscoverFilterId]), ctx).length === 1);

console.log("── near_hotel ──");
const hotel = { lat: 24.7587, lng: 46.6388 }; // KAFD
const nearCtx = { ...ctx, hotel };
ok("place 2km away matches near_hotel",
  applyFilters([makePlace({ id: "a", lat: 24.77, lng: 46.65 })], new Set(["near_hotel" as DiscoverFilterId]), nearCtx).length === 1);
ok("place 200km away does NOT match near_hotel",
  applyFilters([makePlace({ id: "b", lat: 23.5, lng: 46.0 })], new Set(["near_hotel" as DiscoverFilterId]), nearCtx).length === 0);
ok("no hotel context → near_hotel filter excludes all",
  applyFilters([makePlace({ id: "c", lat: 24.7, lng: 46.7 })], new Set(["near_hotel" as DiscoverFilterId]), ctx).length === 0);

console.log("── category OR ──");
const mixed = [
  makePlace({ id: "f1", category: "food" }),
  makePlace({ id: "c1", category: "coffee" }),
  makePlace({ id: "s1", category: "sight" }),
];
ok("food OR coffee filter keeps both",
  applyFilters(mixed, new Set(["cat_food", "cat_coffee"] as DiscoverFilterId[]), ctx).length === 2);

console.log("── quality AND category ──");
const mix2 = [
  makePlace({ id: "x", category: "food", kind: "fine_dining" }),
  makePlace({ id: "y", category: "coffee", kind: "specialty" }),
  makePlace({ id: "z", category: "food", kind: "fast" }),
];
ok("food + fine_dining only keeps the fine_dining food place",
  applyFilters(mix2, new Set(["cat_food", "fine_dining"] as DiscoverFilterId[]), ctx).length === 1);

console.log("── meal-time filters ──");
ok("fine_dining matches meal_dinner",
  applyFilters([makePlace({ id: "a", category: "food", kind: "fine_dining" })], new Set(["meal_dinner" as DiscoverFilterId]), ctx).length === 1);
ok("fine_dining does NOT match meal_breakfast",
  applyFilters([makePlace({ id: "b", category: "food", kind: "fine_dining" })], new Set(["meal_breakfast" as DiscoverFilterId]), ctx).length === 0);
ok("bistro matches meal_brunch",
  applyFilters([makePlace({ id: "c", category: "food", kind: "bistro" })], new Set(["meal_brunch" as DiscoverFilterId]), ctx).length === 1);
ok("burger matches meal_snack",
  applyFilters([makePlace({ id: "d", category: "food", kind: "burger" })], new Set(["meal_snack" as DiscoverFilterId]), ctx).length === 1);

console.log("── offering filters ──");
ok("cafe with bakery tag matches offers_pastry",
  applyFilters([makePlace({ id: "a", category: "coffee", kind: "specialty", tags: ["bakery"] })], new Set(["offers_pastry" as DiscoverFilterId]), ctx).length === 1);
ok("cafe with dessert tag matches offers_dessert",
  applyFilters([makePlace({ id: "b", category: "coffee", kind: "specialty", tags: ["dessert"] })], new Set(["offers_dessert" as DiscoverFilterId]), ctx).length === 1);
ok("ice cream shop matches offers_dessert",
  applyFilters([makePlace({ id: "c", category: "sweet", kind: "icecream" })], new Set(["offers_dessert" as DiscoverFilterId]), ctx).length === 1);

console.log("── countPerFilter ──");
const counts = countPerFilter(
  mix2,
  new Set<DiscoverFilterId>(),
  ctx,
  ["fine_dining", "specialty_coffee"] as DiscoverFilterId[],
);
ok("counts fine_dining alone", counts.fine_dining === 1);
ok("counts specialty_coffee alone", counts.specialty_coffee === 1);

console.log("── trending (isTrendingNow display gate) ──");
const trendingSet = new Set(["trending"] as DiscoverFilterId[]);
const fresh = "2026-06-05T00:00:00Z"; // 1 day before ctx.now
ok("score 72, fresh, non-religious matches",
  applyFilters([makePlace({ id: "a", trending_score: 72, trending_updated_at: fresh })], trendingSet, ctx).length === 1);
ok("score 49 does NOT match (below threshold)",
  applyFilters([makePlace({ id: "b", trending_score: 49, trending_updated_at: fresh })], trendingSet, ctx).length === 0);
ok("mosque kind excluded even with score 78",
  applyFilters([makePlace({ id: "c", category: "sight", kind: "mosque", trending_score: 78, trending_updated_at: fresh })], trendingSet, ctx).length === 0);
ok("name 'جامع الراجحي' excluded even with kind=landmark",
  applyFilters([makePlace({ id: "d", name: "جامع الراجحي", category: "sight", kind: "landmark", trending_score: 78, trending_updated_at: fresh })], trendingSet, ctx).length === 0);
ok("'جامعة الملك سعود' is NOT excluded (university, not mosque)",
  applyFilters([makePlace({ id: "e", name: "جامعة الملك سعود", category: "sight", trending_score: 60, trending_updated_at: fresh })], trendingSet, ctx).length === 1);
ok("score older than 14 days is aged out at display",
  applyFilters([makePlace({ id: "f", trending_score: 90, trending_updated_at: "2026-05-01T00:00:00Z" })], trendingSet, ctx).length === 0);
ok("score exactly 13 days old still shows",
  applyFilters([makePlace({ id: "g", trending_score: 55, trending_updated_at: "2026-05-24T14:00:00Z" })], trendingSet, ctx).length === 1);
ok("legacy row with score but NULL updated_at still shows",
  applyFilters([makePlace({ id: "h", trending_score: 60 })], trendingSet, ctx).length === 1);
ok("trending + cat_coffee ANDs — old trending sight is filtered out",
  applyFilters([
    makePlace({ id: "i", name: "برج المملكة", category: "sight", kind: "viewpoint", trending_score: 80, trending_updated_at: fresh }),
    makePlace({ id: "j", name: "Half Million", category: "coffee", kind: "specialty", trending_score: 72, trending_updated_at: fresh }),
  ], new Set(["trending", "cat_coffee"] as DiscoverFilterId[]), ctx).map((p) => p.id).join(",") === "j");

console.log("── trending evidence gate (owner rule: venue-specific proof only) ──");
ok("generic-only evidence (tiktok discover page) is HIDDEN from ترند",
  applyFilters([makePlace({
    id: "k", trending_score: 80, trending_updated_at: fresh,
    trending_evidence: [{ url: "https://www.tiktok.com/discover/%D9%82%D9%87%D8%A7%D9%88%D9%8A-%D9%86%D9%8A%D8%B3", platform: "tiktok", found_at: fresh }],
  })], trendingSet, ctx).length === 0);
ok("specific TikTok video evidence still shows",
  applyFilters([makePlace({
    id: "l", trending_score: 66, trending_updated_at: fresh,
    trending_evidence: [{ url: "https://www.tiktok.com/@foodguide/video/7312345678901234567", platform: "tiktok", found_at: fresh }],
  })], trendingSet, ctx).length === 1);
ok("mixed evidence (one generic + one specific post) shows",
  applyFilters([makePlace({
    id: "m", trending_score: 66, trending_updated_at: fresh,
    trending_evidence: [
      { url: "https://www.tiktok.com/discover/nice-cafes", platform: "tiktok", found_at: fresh },
      { url: "https://www.instagram.com/reel/Cx1yz/", platform: "instagram", found_at: fresh },
    ],
  })], trendingSet, ctx).length === 1);

console.log("── trend recency window (متى انجلب filter) ──");
const eightDaysOld = "2026-05-29T14:00:00Z"; // 8 days before ctx.now
ok("8-day-old trend hidden with هذا الأسبوع (7d) window",
  applyFilters([makePlace({ id: "n", trending_score: 70, trending_updated_at: eightDaysOld })],
    trendingSet, { ...ctx, trendWindowDays: 7 }).length === 0);
ok("8-day-old trend shows with آخر أسبوعين (14d) window",
  applyFilters([makePlace({ id: "o", trending_score: 70, trending_updated_at: eightDaysOld })],
    trendingSet, { ...ctx, trendWindowDays: 14 }).length === 1);
ok("40-day-old trend shows with الكل (null) window",
  applyFilters([makePlace({ id: "p", trending_score: 70, trending_updated_at: "2026-04-27T00:00:00Z" })],
    trendingSet, { ...ctx, trendWindowDays: null }).length === 1);
ok("first_seen newer than updated_at keeps place fresh (recency = newest of the two)",
  applyFilters([makePlace({ id: "q", trending_score: 70, trending_updated_at: "2026-04-27T00:00:00Z", trending_first_seen_at: fresh })],
    trendingSet, { ...ctx, trendWindowDays: 7 }).length === 1);

console.log("── trendBadge (متى انجلب badge — real dates) ──");
{
  const nowD = new Date("2026-06-06T14:00:00Z");
  const b1 = trendBadge(makePlace({ trending_score: 70, trending_updated_at: fresh, trending_first_seen_at: fresh }), nowD);
  ok("1-day-old → «ترند · أمس» + جديد", b1?.label === "ترند · أمس" && b1?.isNew === true);
  const b2 = trendBadge(makePlace({ trending_score: 70, trending_updated_at: "2026-06-03T00:00:00Z", trending_first_seen_at: "2026-05-01T00:00:00Z" }), nowD);
  ok("3-day-old refresh, first seen long ago → أيام label, NOT جديد", b2?.label === "ترند · منذ ٣ أيام" && b2?.isNew === false);
  ok("no score → no badge", trendBadge(makePlace({}), nowD) === null);
}

console.log("── normalizeVenueName (discovery dedup key) ──");
ok("diacritics + case + articles normalize",
  normalizeVenueName("Le Café Marinette!") === "cafe marinette");
ok("arabic variants normalize (أ→ا، ة→ه، تشكيل)",
  normalizeVenueName("مقهى المَارِينَة") === "مقهي المارينه");
ok("same venue, different punctuation → same key",
  normalizeVenueName("Chez-Pipo, Nice") === normalizeVenueName("Chez Pipo Nice"));

console.log("\n" + (fail === 0 ? "✓" : "✗") + ` ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
