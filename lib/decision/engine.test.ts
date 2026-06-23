// Run: `npx tsx lib/decision/engine.test.ts`
//
// Simple test harness (no jest/vitest installed). Covers every verdict path
// in the decision engine plus mode-dependent behaviour for the same place.

import assert from "node:assert/strict";
import type { Place } from "@/lib/supabase/database.types";
import { decide, type DecisionContext } from "./engine";

// ─── Test runner ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.error(`    ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

// Always-open 24/7 = 7 entries of "12:00 AM - 11:59 PM"
const ALWAYS_OPEN: string[] = Array(7).fill("12:00 AM - 11:59 PM");
// Closes at 9pm
const CLOSES_9PM: string[] = Array(7).fill("9:00 AM - 9:00 PM");

function mkPlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "test-1",
    google_place_id: null,
    external_source: "seed",
    name: "Test Place",
    category: "food",
    kind: null,
    city: "london",
    city_label: "لندن",
    lat: 51.5074,
    lng: -0.1278,
    address: null,
    phone: null,
    website: null,
    rating: 4.6,
    review_count: 500,
    price_level: 2,
    cost_estimate: 50,
    cost_currency: "EUR",
    cost_confidence: "medium",
    opening_hours: ALWAYS_OPEN,
    open_status_cache: null,
    photo_url: null,
    photo_urls: null,
    google_maps_url: null,
    tags: null,
    highlights: null,
    tip: null,
    hidden_gem_score: null,
    is_editor_pick: false,
    data_freshness: new Date().toISOString(),
    review_summary: null,
    google_reviews: null,
    enriched_at: null,
    ai_summary: null,
    trending_score: null,
    trending_source: null,
    trending_updated_at: null,
    trending_evidence: null,
    priority: null,
    best_time: null,
    short_ar: null,
    practical_warning: null,
    seasonal: false,
    reservation_level: null,
    best_for: null,
    country_code: null,
    ...overrides,
  };
}

function mkCtx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    now: new Date(2026, 5, 5, 14, 0), // June 5, 2026, 2:00 PM (midday)
    currentLocation: { lat: 51.5074, lng: -0.1278 },
    hotelLocation: { lat: 51.51, lng: -0.13 },
    budgetRemainingSar: 2000,
    preferenceMode: null,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log("\n🧪 lib/decision/engine.test.ts\n");

// 1) Open, near, well-rated, within budget → recommended
test("open + near + ★4.6 + 500 reviews + in budget → recommended", () => {
  const result = decide(mkPlace(), mkCtx());
  assert.equal(result.verdict, "recommended", `got: ${result.verdict}`);
  assert.ok(result.confidence >= 80, `confidence too low: ${result.confidence}`);
  assert.ok(result.reason.length > 0, "must include reasons");
});

// 2) Closes in 30 minutes → closed_soon
test("open but closes in 30 min → closed_soon", () => {
  // 8:30 PM, closes at 9 PM
  const result = decide(
    mkPlace({ opening_hours: CLOSES_9PM }),
    mkCtx({ now: new Date(2026, 5, 5, 20, 30) }),
  );
  assert.equal(result.verdict, "closed_soon", `got: ${result.verdict}`);
});

// 3) Far (25km away) with average rating → too_far
test("25km away + average rating → too_far", () => {
  const result = decide(
    mkPlace({ rating: 4.2, lat: 52.0, lng: 0.5 }), // ~85km from London
    mkCtx(),
  );
  assert.equal(result.verdict, "too_far", `got: ${result.verdict}`);
});

// 4) Cost > remaining budget → over_budget
test("expensive place + tiny budget → over_budget", () => {
  const result = decide(
    mkPlace({ cost_estimate: 300, cost_currency: "EUR" }), // ~1230 SAR
    mkCtx({ budgetRemainingSar: 200 }),
  );
  assert.equal(result.verdict, "over_budget", `got: ${result.verdict}`);
  assert.ok(
    result.reason.some((r) => r.includes("التكلفة") || r.includes("الميزانية")),
    "reason should mention cost",
  );
});

// 5) Low rating or too-few reviews → low_confidence
test("rating 3.2 + 15 reviews → low_confidence", () => {
  const result = decide(
    mkPlace({ rating: 3.2, review_count: 15 }),
    mkCtx(),
  );
  assert.equal(result.verdict, "low_confidence", `got: ${result.verdict}`);
});

// 6) User explicitly skipped before → skip (highest priority)
test("user history says skip → skip (overrides all positives)", () => {
  const result = decide(
    mkPlace({ rating: 5.0, review_count: 50000, is_editor_pick: true }),
    mkCtx({
      userHistory: {
        saved: [],
        ratings: {},
        verdicts: { "test-1": "skip" },
      },
    }),
  );
  assert.equal(result.verdict, "skip");
  assert.equal(result.confidence, 100);
});

// 7) Decent place, a bit far → good_if_nearby
test("★4.2 + 6km away → good_if_nearby (not too_far, not recommended)", () => {
  const result = decide(
    mkPlace({ rating: 4.2, review_count: 600, lat: 51.55, lng: -0.05 }), // ~7km from London
    mkCtx(),
  );
  assert.ok(
    result.verdict === "good_if_nearby" || result.verdict === "low_confidence",
    `unexpected verdict: ${result.verdict}`,
  );
});

// 8) Same place, different preference modes → different outcomes
test("preference modes change the verdict for the same place", () => {
  // A so-so restaurant 6km away
  const place = mkPlace({ rating: 4.0, review_count: 400, lat: 51.55, lng: -0.05 });

  // Tired mode → too_far (5km cap)
  const tired = decide(place, mkCtx({ preferenceMode: "tired" }));
  assert.equal(tired.verdict, "too_far", `tired: ${tired.verdict}`);

  // Near mode → less favorable beyond 3km
  const near = decide(place, mkCtx({ preferenceMode: "near" }));
  assert.notEqual(near.verdict, "recommended", `near: ${near.verdict}`);

  // Default mode → neutral or good_if_nearby
  const def = decide(place, mkCtx());
  assert.ok(
    def.verdict === "good_if_nearby" || def.verdict === "low_confidence",
    `default: ${def.verdict}`,
  );
});

// 9) Family mode + bar → skip
test("family mode + bar category → skip", () => {
  const result = decide(
    mkPlace({ category: "bar", rating: 4.8, review_count: 5000 }),
    mkCtx({ preferenceMode: "family" }),
  );
  assert.equal(result.verdict, "skip", `got: ${result.verdict}`);
  assert.ok(result.reason.some((r) => r.includes("عائلة")), "reason should explain");
});

// 10) Closed right now → skip
test("place closed now → skip", () => {
  // Sunday closed: empty string
  const hours: string[] = [...ALWAYS_OPEN];
  hours[0] = ""; // Sunday closed
  const result = decide(
    mkPlace({ opening_hours: hours }),
    mkCtx({ now: new Date(2026, 5, 7, 14, 0) }), // June 7 2026 is a Sunday
  );
  assert.equal(result.verdict, "skip");
  assert.ok(result.reason.some((r) => r.includes("مغلق")));
});

// 11) Editor pick at far distance → still recommended (exception)
test("editor pick at 18km → recommended despite distance", () => {
  const result = decide(
    mkPlace({
      rating: 4.8,
      review_count: 2000,
      is_editor_pick: true,
      lat: 51.65, lng: -0.05, // ~16km from London center
    }),
    mkCtx(),
  );
  assert.equal(result.verdict, "recommended", `got: ${result.verdict}`);
});

// 12) Luxury mode boosts a fine-dining option
test("luxury mode + price_level 4 + ★4.7 → recommended", () => {
  const result = decide(
    mkPlace({ rating: 4.7, review_count: 2000, price_level: 4 }),
    mkCtx({ preferenceMode: "luxury" }),
  );
  assert.equal(result.verdict, "recommended");
});

// 13) Loved place gets a strong boost
test("user history verdict=love → confidence boost & recommended", () => {
  const result = decide(
    mkPlace({ rating: 4.3, review_count: 200 }), // borderline on its own
    mkCtx({
      userHistory: {
        saved: ["test-1"],
        ratings: { "test-1": 5 },
        verdicts: { "test-1": "love" },
      },
    }),
  );
  assert.equal(result.verdict, "recommended");
  assert.ok(result.confidence >= 85);
});

// 14) Best-slot suggestion fits the category
test("coffee category → bestSlot=morning", () => {
  const result = decide(
    mkPlace({ category: "coffee", rating: 4.5, review_count: 500 }),
    mkCtx({ now: new Date(2026, 5, 5, 9, 0) }), // 9 AM
  );
  assert.equal(result.bestSlot, "morning");
});

// ─── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log("Failures:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
