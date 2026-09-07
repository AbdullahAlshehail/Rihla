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
import { isOpenNow, haversineKm, tzForCity } from "@/lib/utils";
import { mealTimes, coffeeOfferings, activityVibe } from "@/lib/discover/offerings";
import { isSpecificEvidence } from "@/lib/trending/evidence";
import { arNum } from "@/lib/social/format";
import { isReligiousPlace } from "@/lib/highlights";

export type SortKey = "score" | "rating" | "newest";

export type DiscoverFilterId =
  // Top quality picks
  | "michelin"
  | "fine_dining"
  | "specialty_coffee"
  | "hidden_gem"
  | "editor_pick"
  | "new_spot"      // recently opened / trending (heuristic)
  | "new_open"      // 🆕 hard signal: earliest review < 6 months + ≤40 reviews
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
  | "solo"          // 🧍 comfortable/rewarding to visit alone
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
  /** Trend recency window in days for the 🔥 filter (هذا الأسبوع = 7،
   *  آخر أسبوعين = 14، الكل = null). Undefined → default 14. */
  trendWindowDays?: number | null;
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

// "سولو 🧍" — places comfortable/rewarding to visit ALONE. Exclusion-biased:
// a false exclusion is invisible (place still shows under other filters), a
// false inclusion is the failure (solo user stuck in a team game or a
// couples-only dining room). Curated `best_for:['solo']` tag overrides the
// heuristic in both directions. (Fable design 2026-09-07.)
const SOLO_CASUAL_FOOD = new Set([
  "cafe", "bakery", "counter", "deli", "ramen", "noodle",
  "street_food", "market", "sandwich", "pizza",
]);
// Group/team activities that are awkward or impossible solo.
const SOLO_GROUP_GAME = /crystal maze|escape|puttshack|swingers|flight club|darts|karaoke|bowling|team|group/i;

const isSoloFriendly = (p: Place): boolean => {
  if ((p.best_for ?? []).includes("solo")) return true;
  const kind = p.kind ?? "";
  switch (p.category) {
    case "coffee":
    case "sight":
    case "nature":
    case "sweet":
      return true;
    case "food":
      if (SOLO_CASUAL_FOOD.has(kind)) return true;
      return (p.price_level ?? 99) <= 2 && kind !== "fine_dining" && kind !== "steakhouse";
    case "event": {
      if (kind !== "experience" && kind !== "theatre") return false;
      const hay = `${p.name} ${(p.tags ?? []).join(" ")}`;
      return !SOLO_GROUP_GAME.test(hay);
    }
    default:
      return false; // bar + unknown → out
  }
};

// ── Trending display predicate ───────────────────────────────────────────
// The DB is APPEND-ONLY for trend data (user rule): scans never clear old
// trending_score rows, and a focused scan (e.g. "قهاوي") only touches its
// own category. So the DISPLAY layer must be the gatekeeper:
//  • score ≥ 50 — the chip has to mean something
//  • never religious venues (mosques/churches) — not tourism for our users
//  • ignore scores older than the window — a place viral last month isn't
//    "ترند الآن". Row stays intact in the DB. Window is configurable via
//    the recency filter (هذا الأسبوع / آخر أسبوعين / الكل).
//  • evidence must be venue-specific — legacy rows whose only "proof" is a
//    generic discover/search page are never presented as trending (owner
//    rule 2026-07; new scans reject these at write time).
export const TRENDING_MAX_AGE_DAYS = 14;

/** The timestamp that drives trend recency: the newest of first-seen /
 *  last-refreshed. Exposed for the UI's «متى انجلب» badge + filter. */
export function trendRecencyAt(p: Place): number | null {
  const a = p.trending_first_seen_at ? Date.parse(p.trending_first_seen_at) : NaN;
  const b = p.trending_updated_at ? Date.parse(p.trending_updated_at) : NaN;
  const max = Math.max(Number.isNaN(a) ? -1 : a, Number.isNaN(b) ? -1 : b);
  return max < 0 ? null : max;
}

export function isTrendingNow(
  p: Place,
  now?: Date,
  /** Age window in days; null = no age gate («الكل»). Default 14. */
  maxAgeDays: number | null = TRENDING_MAX_AGE_DAYS,
): boolean {
  if ((p.trending_score ?? 0) < 50) return false;
  if (isReligiousPlace(p)) return false;
  const ev = p.trending_evidence;
  if (ev && ev.length > 0 && !ev.some((e) => e.url && isSpecificEvidence(e.url))) {
    return false;
  }
  if (maxAgeDays != null) {
    const at = trendRecencyAt(p);
    if (at != null) {
      const age = (now ?? new Date()).getTime() - at;
      if (age > maxAgeDays * 86_400_000) return false;
    }
  }
  return true;
}

/** «متى انجلب» badge for trend cards — REAL dates only.
 *  isNew: first ever seen trending < 7 days ago → «جديد». */
export function trendBadge(
  p: Place, now: Date = new Date(),
): { label: string; isNew: boolean } | null {
  if ((p.trending_score ?? 0) < 50) return null;
  const at = trendRecencyAt(p);
  if (at == null) return null;
  const firstSeen = p.trending_first_seen_at ? Date.parse(p.trending_first_seen_at) : null;
  const isNew = firstSeen != null && now.getTime() - firstSeen < 7 * 86_400_000;
  const days = Math.floor((now.getTime() - at) / 86_400_000);
  const label =
    days <= 0 ? "ترند · اليوم"
    : days === 1 ? "ترند · أمس"
    : days === 2 ? "ترند · منذ يومين"
    : days <= 10 ? `ترند · منذ ${arNum(days)} أيام`
    : `ترند · منذ ${arNum(days)} يوم`;
  return { label, isNew };
}

// ── Predicate map ────────────────────────────────────────────────────────

const PREDICATES: Record<DiscoverFilterId, (p: Place, ctx: FilterContext) => boolean> = {
  michelin: looksMichelin,
  fine_dining: isFineDining,
  specialty_coffee: isSpecialtyCoffee,
  hidden_gem: isHiddenGem,
  editor_pick: (p) => p.is_editor_pick === true,
  new_spot: isNewSpot,
  // 🔥 Trending — scored by the trending scan. See isTrendingNow above:
  // threshold 50, religious places excluded, generic-evidence rows hidden,
  // scores age out per the recency window AT DISPLAY TIME (the DB is
  // append-only — rows are never wiped).
  trending: (p, ctx) => isTrendingNow(
    p, ctx.now, ctx.trendWindowDays === undefined ? TRENDING_MAX_AGE_DAYS : ctx.trendWindowDays,
  ),
  // 🆕 جديد — hard newness signal when `earliest_review_at` is populated
  // (opened < 6 months + ≤ 40 reviews). Falls back to a rating+low-review
  // heuristic for legacy catalogue rows where the column is still NULL —
  // otherwise the chip is permanently 0 on unenriched places.
  new_open: (p) => p.earliest_review_at
    ? (p.review_count ?? 999) <= 40 && Date.now() - Date.parse(p.earliest_review_at) < 183 * 86_400_000
    : (p.rating ?? 0) >= 4.5 && (p.review_count ?? 999) <= 40,
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
    // Evaluate in the PLACE's timezone — deterministic server/client (fixes
    // the /map hydration mismatch) and correct for remote planning.
    const r = isOpenNow(p.opening_hours, ctx.now, tzForCity(p.city ?? p.city_label));
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
  solo: (p) => isSoloFriendly(p),
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
  cat_sight: (p) => p.category === "sight" && !isReligiousPlace(p),
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
  // Active chips ALL show the same current matches count → compute it once
  // instead of running k identical full-catalogue passes (perf audit).
  const activeLen = applyFilters(places, active, ctx).length;
  for (const id of ids) {
    if (active.has(id)) {
      out[id] = activeLen;
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
  new_open: "quick",
  solo: "quick",
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
