// Smart filters for the "اكتشف" tab — pure functions, fully tested.
//
// Design principles:
//  - Each filter is a predicate (Place + ctx → boolean). Composable.
//  - "Quality" filters (Michelin, Fine Dining, Hidden Gem) combine multiple
//    public signals (kind, tags, rating, price_level, review_count) so we
//    catch the right places even when Google's `kind` is generic.
//  - All filtering runs on the catalogue already loaded — zero extra API
//    calls, instant feedback on toggle.

import type { Place } from "@/lib/supabase/database.types";
import { isOpenNow, haversineKm } from "@/lib/utils";
import { mealTimes, coffeeOfferings, activityVibe } from "@/lib/discover/offerings";

export type SortKey = "score" | "rating" | "newest";

export type DiscoverFilterId =
  // Top quality picks
  | "michelin"
  | "fine_dining"
  | "specialty_coffee"
  | "hidden_gem"
  | "editor_pick"
  | "new_spot"      // recently opened / trending (heuristic)
  | "trending"      // ACTUAL social-media trend (TikTok/Instagram), scored by cron
  | "rating_4_5"    // ≥ 4.5★
  | "highly_rated"  // ≥ 4.8★ (top tier)
  | "luxury"        // price ≥ 3
  | "budget"        // price ≤ 2
  | "open_now"
  | "saved"
  | "near_hotel"    // ≤ 12 km from trip's hotel (~30 min city drive)
  | "near_user"     // ≤ 2 km from user's current geolocation
  | "popular"       // top 100 by rating × log(reviews) in current city scope
  // Cuisines (food category)
  | "cuisine_italian"
  | "cuisine_french"
  | "cuisine_japanese"
  | "cuisine_chinese"
  | "cuisine_korean"
  | "cuisine_thai"
  | "cuisine_indian"
  | "cuisine_lebanese"
  | "cuisine_saudi"
  | "cuisine_yemeni"
  | "cuisine_turkish"
  | "cuisine_greek"
  | "cuisine_mexican"
  | "cuisine_peruvian"
  | "cuisine_british"
  | "cuisine_mediterranean"
  | "cuisine_seafood"
  | "cuisine_steak"
  | "cuisine_pizza"
  | "cuisine_burger"
  | "cuisine_vegan"
  // Meal-time filters (food)
  | "meal_breakfast"
  | "meal_brunch"
  | "meal_lunch"
  | "meal_snack"
  | "meal_dinner"
  // Cafe / sweet offerings
  | "offers_dessert"
  | "offers_pastry"
  // Activity vibe (for sights/nature/events)
  | "vibe_cultural"
  | "vibe_active"
  | "vibe_scenic"
  | "vibe_entertainment"
  | "vibe_shopping"
  // Categories (mutually exclusive in spirit, but technically additive)
  | "cat_food"
  | "cat_coffee"
  | "cat_sight"
  | "cat_nature"
  | "cat_sweet"
  | "cat_event"
  | "cat_bar";

export type FilterContext = {
  savedSet: Set<string>;
  now?: Date;
  hotel?: { lat: number; lng: number } | null;
  user?: { lat: number; lng: number } | null;
  /** Pre-computed set of "popular" place ids — top 100 in current scope by
   *  rating × log(reviews). Driven by the "⭐ مشهور" chip. Computed in the
   *  parent so it doesn't recompute for every predicate call. */
  popularSet?: Set<string>;
};

// 30-min city drive in Riyadh-style sprawl ≈ 12km point-to-point.
// Slightly generous so users don't lose great places that just sit on the edge.
const NEAR_HOTEL_KM = 12;

// ── Heuristics ───────────────────────────────────────────────────────────

const looksMichelin = (p: Place): boolean => {
  if (p.kind === "michelin" || p.kind === "michelin_3") return true;
  const tagText = (p.tags ?? []).join(" ").toLowerCase();
  const hlText = (p.highlights ?? []).join(" ").toLowerCase();
  const sumText = `${p.ai_summary ?? ""} ${p.review_summary ?? ""}`.toLowerCase();
  if (/michelin|ميشلان|نجمة|étoile|etoile/i.test(`${tagText} ${hlText} ${sumText}`)) {
    return true;
  }
  // Stat-based proxy: very expensive + very high rating + meaningful review count
  if (
    (p.price_level ?? 0) >= 4 &&
    (p.rating ?? 0) >= 4.7 &&
    (p.review_count ?? 0) >= 300
  ) return true;
  return false;
};

const isFineDining = (p: Place): boolean => {
  if (p.kind === "fine_dining" || p.kind === "michelin" || p.kind === "michelin_3") return true;
  if (p.category !== "food") return false;
  // Upscale proxy
  if ((p.price_level ?? 0) >= 4 && (p.rating ?? 0) >= 4.5) return true;
  if ((p.price_level ?? 0) >= 3 && (p.rating ?? 0) >= 4.7) return true;
  return false;
};

const isSpecialtyCoffee = (p: Place): boolean => {
  if (p.category !== "coffee") return false;
  return p.kind === "specialty" || p.kind === "roastery";
};

const isHiddenGem = (p: Place): boolean => {
  if ((p.hidden_gem_score ?? 0) >= 70) return true;
  // Loved by the few who knew about it
  const r = p.rating ?? 0;
  const c = p.review_count ?? 0;
  return r >= 4.7 && c >= 40 && c <= 1500;
};

// "New / trending" — explicit tag wins; else heuristic on early-life signals.
// Google doesn't expose opening dates, so the proxy is: solid rating with
// an audience that's still small relative to landmark icons (those have 5k-30k).
// Upper bound is generous because trendy Riyadh openings get to 1k reviews fast.
const isNewSpot = (p: Place): boolean => {
  const tags = (p.tags ?? []).map((t) => t.toLowerCase());
  if (tags.includes("جديد") || tags.includes("new") || tags.includes("trending")) return true;
  const r = p.rating ?? 0;
  const c = p.review_count ?? 0;
  return r >= 4.5 && c >= 20 && c <= 1000;
};

// ── Predicate map ────────────────────────────────────────────────────────

const PREDICATES: Record<DiscoverFilterId, (p: Place, ctx: FilterContext) => boolean> = {
  michelin: looksMichelin,
  fine_dining: isFineDining,
  specialty_coffee: isSpecialtyCoffee,
  hidden_gem: isHiddenGem,
  editor_pick: (p) => p.is_editor_pick === true,
  new_spot: isNewSpot,
  // 🔥 Trending — scored by /api/cron/trending-scan. Threshold 50 keeps the
  // bar high so the chip means something. Scores >14d old are wiped by cron,
  // so we don't need a date check here.
  trending: (p) => (p.trending_score ?? 0) >= 50,
  rating_4_5: (p) => (p.rating ?? 0) >= 4.5,
  highly_rated: (p) => (p.rating ?? 0) >= 4.8,
  // Cuisines — kind match OR tag match (Arabic + English)
  cuisine_italian:       (p) => p.kind === "italian"       || p.kind === "pizzeria"   || (p.tags ?? []).some((t) => /إيطالي|italian/i.test(t)),
  cuisine_french:        (p) => p.kind === "french"        || p.kind === "brasserie"  || p.kind === "nicois" || p.kind === "bistro" || (p.tags ?? []).some((t) => /فرنسي|french/i.test(t)),
  cuisine_japanese:      (p) => p.kind === "japanese"      || p.kind === "sushi"      || (p.tags ?? []).some((t) => /ياباني|سوشي|japanese|sushi/i.test(t)),
  cuisine_chinese:       (p) => p.kind === "chinese"       || (p.tags ?? []).some((t) => /صيني|chinese/i.test(t)),
  cuisine_korean:        (p) => p.kind === "korean"        || (p.tags ?? []).some((t) => /كوري|korean/i.test(t)),
  cuisine_thai:          (p) => p.kind === "thai"          || (p.tags ?? []).some((t) => /تايلندي|thai/i.test(t)),
  cuisine_indian:        (p) => p.kind === "indian"        || (p.tags ?? []).some((t) => /هندي|indian/i.test(t)),
  cuisine_lebanese:      (p) => p.kind === "lebanese"      || (p.tags ?? []).some((t) => /لبناني|lebanese|شرقي/i.test(t)),
  cuisine_saudi:         (p) => p.kind === "saudi"         || p.kind === "najdi"      || (p.tags ?? []).some((t) => /سعودي|نجدي|saudi|najdi/i.test(t)),
  cuisine_yemeni:        (p) => p.kind === "yemeni"        || (p.tags ?? []).some((t) => /يمني|yemeni/i.test(t)),
  cuisine_turkish:       (p) => p.kind === "turkish"       || (p.tags ?? []).some((t) => /تركي|turkish/i.test(t)),
  cuisine_greek:         (p) => p.kind === "greek"         || (p.tags ?? []).some((t) => /يوناني|greek/i.test(t)),
  cuisine_mexican:       (p) => p.kind === "mexican"       || (p.tags ?? []).some((t) => /مكسيكي|mexican/i.test(t)),
  cuisine_peruvian:      (p) => p.kind === "peruvian"      || (p.tags ?? []).some((t) => /بيروفي|peruvian/i.test(t)),
  cuisine_british:       (p) => p.kind === "british"       || p.kind === "gastropub"  || p.kind === "pub" || (p.tags ?? []).some((t) => /بريطاني|british/i.test(t)),
  cuisine_mediterranean: (p) => p.kind === "mediterranean" || (p.tags ?? []).some((t) => /متوسطي|mediterranean/i.test(t)),
  cuisine_seafood:       (p) => p.kind === "seafood"       || (p.tags ?? []).some((t) => /مأكولات بحرية|seafood/i.test(t)),
  cuisine_steak:         (p) => p.kind === "steakhouse"    || p.kind === "steak"      || (p.tags ?? []).some((t) => /ستيك|steak/i.test(t)),
  cuisine_pizza:         (p) => p.kind === "pizza"         || p.kind === "pizzeria"   || (p.tags ?? []).some((t) => /بيتزا|pizza/i.test(t)),
  cuisine_burger:        (p) => p.kind === "burger"        || (p.tags ?? []).some((t) => /برغر|burger/i.test(t)),
  cuisine_vegan:         (p) => p.kind === "vegan"         || (p.tags ?? []).some((t) => /نباتي|vegan/i.test(t)),
  luxury: (p) => (p.price_level ?? 0) >= 3,
  budget: (p) => (p.price_level ?? 5) > 0 && (p.price_level ?? 5) <= 2,
  open_now: (p, ctx) => {
    const r = isOpenNow(p.opening_hours, ctx.now);
    return r.kind === "open" || r.kind === "free";
  },
  saved: (p, ctx) => ctx.savedSet.has(p.id),
  near_hotel: (p, ctx) => {
    if (!ctx.hotel || p.lat == null || p.lng == null) return false;
    return haversineKm({ lat: p.lat, lng: p.lng }, ctx.hotel) <= NEAR_HOTEL_KM;
  },
  // "قريب" — 2 km from user's GPS. Falls back to hotel-12km if no user GPS,
  // so the chip is always useful even when geolocation is denied.
  near_user: (p, ctx) => {
    if (p.lat == null || p.lng == null) return false;
    if (ctx.user) {
      return haversineKm({ lat: p.lat, lng: p.lng }, ctx.user) <= 2;
    }
    if (ctx.hotel) {
      return haversineKm({ lat: p.lat, lng: p.lng }, ctx.hotel) <= NEAR_HOTEL_KM;
    }
    return false;
  },
  // "⭐ مشهور" — top 100 by rating × log(reviews) within the active city
  // scope. Free, instant — no AI / network call required.
  popular: (p, ctx) => ctx.popularSet?.has(p.id) ?? false,
  // Meal times — derived from kind + tags + opening hours
  meal_breakfast: (p) => mealTimes(p).some((m) => m.key === "breakfast"),
  meal_brunch:    (p) => mealTimes(p).some((m) => m.key === "brunch"),
  meal_lunch:     (p) => mealTimes(p).some((m) => m.key === "lunch"),
  meal_snack:     (p) => mealTimes(p).some((m) => m.key === "snack"),
  meal_dinner:    (p) => mealTimes(p).some((m) => m.key === "dinner"),
  // Coffee/sweet offerings — pastry/dessert
  offers_pastry: (p) => coffeeOfferings(p).some((o) => o.key === "pastry"),
  offers_dessert: (p) => coffeeOfferings(p).some((o) => o.key === "dessert" || o.key === "icecream" || o.key === "chocolate" || o.key === "donut"),
  // Activity vibes
  vibe_cultural:      (p) => activityVibe(p).some((v) => v.key === "cultural"),
  vibe_active:        (p) => activityVibe(p).some((v) => v.key === "active"),
  vibe_scenic:        (p) => activityVibe(p).some((v) => v.key === "scenic" || v.key === "leisure"),
  vibe_entertainment: (p) => activityVibe(p).some((v) => v.key === "entertainment"),
  vibe_shopping:      (p) => activityVibe(p).some((v) => v.key === "shopping"),
  cat_food: (p) => p.category === "food",
  cat_coffee: (p) => p.category === "coffee",
  cat_sight: (p) => p.category === "sight",
  cat_nature: (p) => p.category === "nature",
  cat_sweet: (p) => p.category === "sweet",
  cat_event: (p) => p.category === "event",
  cat_bar: (p) => p.category === "bar",
};

// Quality filters are AND'd with category filters; categories are OR'd
// together among themselves (a user picking "مطاعم" + "قهاوي" means EITHER).
const CATEGORY_IDS: ReadonlySet<DiscoverFilterId> = new Set<DiscoverFilterId>([
  "cat_food", "cat_coffee", "cat_sight", "cat_nature",
  "cat_sweet", "cat_event", "cat_bar",
]);

export function applyFilters(
  places: Place[],
  active: ReadonlySet<DiscoverFilterId>,
  ctx: FilterContext,
): Place[] {
  if (active.size === 0) return places;
  const cats: DiscoverFilterId[] = [];
  const quals: DiscoverFilterId[] = [];
  for (const id of active) {
    (CATEGORY_IDS.has(id) ? cats : quals).push(id);
  }
  return places.filter((p) => {
    if (cats.length > 0 && !cats.some((id) => PREDICATES[id](p, ctx))) return false;
    for (const id of quals) {
      if (!PREDICATES[id](p, ctx)) return false;
    }
    return true;
  });
}

// Count how many places match each filter when applied IN ISOLATION
// (relative to the current category-narrowed set). Lets us grey out chips
// that would produce zero results and show counts on each chip.
export function countPerFilter(
  places: Place[],
  active: ReadonlySet<DiscoverFilterId>,
  ctx: FilterContext,
  ids: readonly DiscoverFilterId[],
): Record<string, number> {
  const out: Record<string, number> = {};
  // For already-active chips the badge should reflect CURRENT matches (the
  // number the user is seeing); for inactive chips it simulates "what would I
  // see if I turned this on" (audit fix 2026-06-15).
  for (const id of ids) {
    if (active.has(id)) {
      out[id] = applyFilters(places, active, ctx).length;
      continue;
    }
    const next = new Set(active);
    next.add(id);
    out[id] = applyFilters(places, next, ctx).length;
  }
  return out;
}

// ─── Filter groupings (Phase 2A) ─────────────────────────────────────────
// Each filter belongs to a semantic group. The DiscoverFilterBar uses this
// to render only the "quick" essentials in the main bar and tuck the rest
// behind "فلاتر أكثر". Adding a new filter just means registering it once
// here — the bar then groups + labels it automatically.

export type FilterGroup =
  | "category"   // primary row
  | "quick"      // second row — high-frequency essentials
  | "quality"    // advanced curation (michelin/fine-dining/specialty/4.8/new)
  | "cuisine"    // tucked behind sheet
  | "meal"       // tucked behind sheet
  | "vibe";      // tucked behind sheet

export const FILTER_GROUP: Record<DiscoverFilterId, FilterGroup> = {
  // primary
  cat_food: "category", cat_coffee: "category", cat_sight: "category",
  cat_nature: "category", cat_sweet: "category", cat_event: "category",
  cat_bar: "category",
  // quick essentials — keep small, this is what 80% of users tap
  near_hotel: "quick",
  near_user: "quick",
  popular: "quick",
  open_now: "quick",
  luxury: "quick",
  budget: "quick",
  rating_4_5: "quick",
  hidden_gem: "quick",
  saved: "quick",
  trending: "quick",
  // advanced curation — behind "فلاتر أكثر"
  michelin: "quality",
  fine_dining: "quality",
  specialty_coffee: "quality",
  editor_pick: "quality",
  highly_rated: "quality",
  new_spot: "quality",
  // cuisines
  cuisine_italian: "cuisine", cuisine_french: "cuisine", cuisine_japanese: "cuisine",
  cuisine_chinese: "cuisine", cuisine_korean: "cuisine", cuisine_thai: "cuisine",
  cuisine_indian: "cuisine", cuisine_lebanese: "cuisine", cuisine_saudi: "cuisine",
  cuisine_yemeni: "cuisine", cuisine_turkish: "cuisine", cuisine_greek: "cuisine",
  cuisine_mexican: "cuisine", cuisine_peruvian: "cuisine", cuisine_british: "cuisine",
  cuisine_mediterranean: "cuisine", cuisine_seafood: "cuisine", cuisine_steak: "cuisine",
  cuisine_pizza: "cuisine", cuisine_burger: "cuisine", cuisine_vegan: "cuisine",
  // meals
  meal_breakfast: "meal", meal_brunch: "meal", meal_lunch: "meal",
  meal_snack: "meal", meal_dinner: "meal",
  offers_pastry: "meal", offers_dessert: "meal",
  // vibes
  vibe_cultural: "vibe", vibe_active: "vibe", vibe_scenic: "vibe",
  vibe_entertainment: "vibe", vibe_shopping: "vibe",
};

export function idsForGroup(group: FilterGroup): DiscoverFilterId[] {
  return (Object.keys(FILTER_GROUP) as DiscoverFilterId[])
    .filter((id) => FILTER_GROUP[id] === group);
}
