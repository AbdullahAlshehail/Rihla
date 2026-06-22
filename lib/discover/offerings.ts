// Distinguishing "offering" chips for a place — what it actually serves and
// what kind of experience it is. Inferred from category + kind + tags +
// opening hours so every place gets meaningful chips without extra API calls.

import type { Place } from "@/lib/supabase/database.types";

export type Offering = { key: string; ar: string; emoji: string };

// ── Meal-time inference ─────────────────────────────────────────────────
// Strategy: start with sensible defaults by `kind`, then refine with
// opening_hours + tags. Cafes get breakfast/brunch by default since most
// specialty cafes open 7-9am and serve light food.

const FOOD_KIND_DEFAULTS: Record<string, string[]> = {
  // ── Premium / fine ──
  fine_dining:   ["dinner"],
  michelin:      ["dinner"],
  michelin_3:    ["dinner"],
  // ── Mainstream cuisines ──
  italian:       ["lunch", "dinner"],
  pizzeria:      ["lunch", "dinner"],
  pizza:         ["lunch", "dinner"],
  japanese:      ["lunch", "dinner"],
  sushi:         ["lunch", "dinner"],
  korean:        ["lunch", "dinner"],
  chinese:       ["lunch", "dinner"],
  thai:          ["lunch", "dinner"],
  indian:        ["lunch", "dinner"],
  french:        ["lunch", "dinner"],
  brasserie:     ["lunch", "dinner"],
  nicois:        ["lunch", "dinner"],
  spanish:       ["lunch", "dinner"],
  tapas:         ["lunch", "snack", "dinner"],
  mexican:       ["lunch", "dinner"],
  peruvian:      ["lunch", "dinner"],
  greek:         ["lunch", "dinner"],
  turkish:       ["lunch", "dinner"],
  // ── Levant + Arabic ──
  arabic:        ["lunch", "dinner"],
  lebanese:      ["lunch", "dinner"],
  yemeni:        ["lunch", "dinner"],
  saudi:         ["breakfast", "lunch", "dinner"],
  najdi:         ["lunch", "dinner"],
  // ── British / pub-style ──
  british:       ["lunch", "dinner"],
  gastropub:     ["lunch", "dinner"],
  pub:           ["lunch", "dinner"],
  // ── Format-based ──
  steak:         ["lunch", "dinner"],
  steakhouse:    ["lunch", "dinner"],
  seafood:       ["lunch", "dinner"],
  mediterranean: ["lunch", "dinner"],
  traditional:   ["lunch", "dinner"],
  bistro:        ["brunch", "lunch", "dinner"],
  bbq:           ["lunch", "dinner"],
  vegan:         ["lunch", "dinner"],
  brunch:        ["breakfast", "brunch"],
  // ── Casual / quick ──
  burger:        ["lunch", "snack", "dinner"],
  fast:          ["lunch", "snack", "dinner"],
  takeaway:      ["lunch", "snack", "dinner"],
  general:       ["lunch", "dinner"],
};

// Cafes default — they're typically open all morning + afternoon.
// Lunch only added when there's a food signal (bakery, brunch tag, etc.).
const COFFEE_DEFAULT_MEALS = ["breakfast", "brunch"];

function parseHours(s: string | null | undefined): { open: number; close: number }[] {
  if (!s) return [];
  return s.split(",").map((seg) => seg.trim()).map((seg) => {
    const m = seg.match(/(\d{1,2}):?(\d{0,2})\s*[-–]\s*(\d{1,2}):?(\d{0,2})/);
    if (!m) return null;
    const open = parseInt(m[1]) * 60 + parseInt(m[2] || "0");
    const close = parseInt(m[3]) * 60 + parseInt(m[4] || "0");
    return { open, close: close <= open ? close + 24 * 60 : close };
  }).filter(Boolean) as { open: number; close: number }[];
}

function spansWindow(intervals: { open: number; close: number }[], winStart: number, winEnd: number): boolean {
  return intervals.some((iv) => iv.open <= winEnd && iv.close >= winStart);
}

const MEAL_WINDOWS = {
  breakfast: [7 * 60, 10 * 60],
  brunch:    [10 * 60, 13 * 60],
  lunch:     [12 * 60, 15 * 60],
  snack:     [15 * 60, 17 * 60],
  dinner:    [18 * 60, 22 * 60],
} as const;

const MEAL_META: Record<string, Offering> = {
  breakfast: { key: "breakfast", ar: "فطور",  emoji: "🌅" },
  brunch:    { key: "brunch",    ar: "برانش", emoji: "🥐" },
  lunch:     { key: "lunch",     ar: "غداء",  emoji: "🍽" },
  snack:     { key: "snack",     ar: "سناك",  emoji: "🥪" },
  dinner:    { key: "dinner",    ar: "عشاء",  emoji: "🌙" },
};

const MEAL_ORDER = ["breakfast", "brunch", "lunch", "snack", "dinner"] as const;

/** Returns the meal periods a food or coffee place serves. */
export function mealTimes(place: Place): Offering[] {
  if (place.category !== "food" && place.category !== "coffee") return [];

  const cands = new Set<string>();
  const tags = (place.tags ?? []).map((t) => t.toLowerCase());
  const kind = place.kind ?? "";

  // Category-level defaults
  if (place.category === "food") {
    const fromKind = FOOD_KIND_DEFAULTS[kind];
    (fromKind ?? ["lunch", "dinner"]).forEach((m) => cands.add(m));
  } else if (place.category === "coffee") {
    COFFEE_DEFAULT_MEALS.forEach((m) => cands.add(m));
    // Cafes with food signals also serve lunch / snack
    if (tags.some((t) => /bakery|pastry|بيستري|مخبز|كرواسون|sandwich|سندويش|brunch|lunch|food/.test(t))) {
      cands.add("lunch");
      cands.add("snack");
    }
  }

  // Explicit tag overrides — work for any category
  if (tags.some((t) => /breakfast|فطور/.test(t))) cands.add("breakfast");
  if (tags.some((t) => /brunch|برانش|برنش/.test(t))) cands.add("brunch");
  if (tags.some((t) => /lunch|غداء/.test(t))) cands.add("lunch");
  if (tags.some((t) => /dinner|عشاء/.test(t))) cands.add("dinner");
  if (tags.some((t) => /snack|سناك|سندويش/.test(t))) cands.add("snack");

  // Opening-hour confirmation. We use it positively (add meals the place is
  // actually open during) but conservatively negatively (only strip a meal
  // when hours clearly preclude it, e.g., a dinner-only place that opens at 7pm
  // shouldn't claim "lunch").
  const hours = place.opening_hours ?? [];
  if (hours.length > 0) {
    const sampleDays = [1, 3, 5, 6]; // Mon, Wed, Fri, Sat
    const intervals = sampleDays.flatMap((d) => parseHours(hours[d] ?? null));
    if (intervals.length > 0) {
      for (const meal of MEAL_ORDER) {
        const [s, e] = MEAL_WINDOWS[meal];
        const open = spansWindow(intervals, s, e);
        if (!open) {
          // Strip impossible breakfast/brunch (most common false positive
          // — a fine-diner opens at 6pm). Be lenient for lunch/dinner since
          // Google hours often miss late breakfast / early lunch boundaries.
          if (meal === "breakfast" || meal === "brunch") {
            cands.delete(meal);
          }
        }
      }
    }
  }

  return MEAL_ORDER.filter((m) => cands.has(m)).map((m) => MEAL_META[m]);
}

// ── Coffee / sweet offerings ───────────────────────────────────────────

const COFFEE_OFF: Record<string, Offering> = {
  specialty: { key: "specialty", ar: "قهوة مختصة", emoji: "☕" },
  roastery:  { key: "roastery",  ar: "محمصة",       emoji: "🫘" },
  pastry:    { key: "pastry",    ar: "بيستري",      emoji: "🥐" },
  dessert:   { key: "dessert",   ar: "حلى",         emoji: "🍰" },
};

/** Specialty / pastry / dessert chips for coffee + sweet places. */
export function coffeeOfferings(place: Place): Offering[] {
  if (place.category !== "coffee" && place.category !== "sweet") return [];
  const out: Offering[] = [];
  const tags = (place.tags ?? []).map((t) => t.toLowerCase());
  const kind = place.kind ?? "";

  if (place.category === "coffee") {
    if (kind === "specialty" || tags.includes("specialty") || kind === "roastery") {
      out.push(COFFEE_OFF.specialty);
    }
    if (kind === "roastery" || tags.includes("roastery")) {
      out.push(COFFEE_OFF.roastery);
    }
    if (tags.some((t) => /bakery|pastry|بيستري|مخبز|كرواسون/.test(t)) || kind === "bakery") {
      out.push(COFFEE_OFF.pastry);
    }
    if (tags.some((t) => /dessert|sweet|حلى|كيك|حلوي/.test(t))) {
      out.push(COFFEE_OFF.dessert);
    }
  } else if (place.category === "sweet") {
    if (kind === "icecream") out.push({ key: "icecream", ar: "آيس كريم", emoji: "🍦" });
    else if (kind === "chocolate") out.push({ key: "chocolate", ar: "شوكولاتة", emoji: "🍫" });
    else if (kind === "dessert" || kind === "sweet") out.push(COFFEE_OFF.dessert);
    else if (kind === "donut") out.push({ key: "donut", ar: "دوناتس", emoji: "🍩" });
    else if (kind === "bakery" || kind === "patisserie") out.push(COFFEE_OFF.pastry);
  }
  return out;
}

// ── Activity vibe ──────────────────────────────────────────────────────
// For sights, nature, events: what KIND of activity is this? Helps the user
// decide between "I want to learn something" vs "I want to move my body" vs
// "I want a chill afternoon".

const VIBE_META = {
  cultural:      { key: "cultural",      ar: "نشاط ثقافي",  emoji: "🧠" },
  active:        { key: "active",        ar: "نشاط حركي",   emoji: "🏃" },
  scenic:        { key: "scenic",        ar: "إطلالة",      emoji: "🌅" },
  leisure:       { key: "leisure",       ar: "استرخاء",     emoji: "😌" },
  entertainment: { key: "entertainment", ar: "ترفيه",       emoji: "🎉" },
  shopping:      { key: "shopping",      ar: "تسوّق",        emoji: "🛍" },
  iconic:        { key: "iconic",        ar: "أيقوني",      emoji: "⭐" },
};

const CULTURAL_KINDS = ["museum", "gallery", "library", "religious", "monument", "historical", "castle", "planetarium", "aquarium", "church", "cathedral", "abbey", "mosque", "palace", "tower", "fort", "ruins"];
const ACTIVE_KINDS = ["hike", "amusement", "water_park", "stadium", "bowling", "arcade", "zoo", "beach_club", "tour", "activity"];
const SCENIC_KINDS = ["view", "viewpoint", "panorama", "beach", "garden", "park", "national_park", "promenade", "wadi", "desert"];
const ENT_KINDS = ["cinema", "concerts", "theater", "theatre", "casino", "club", "pub", "show", "wine_bar", "cocktail", "speakeasy", "rooftop", "shisha"];
const SHOP_KINDS = ["market", "mall", "fashion", "department", "jewelry", "village", "souk"];
const ICONIC_KINDS = ["landmark", "monument"];

/** Returns the activity-type chips for a non-food/coffee/sweet place. */
export function activityVibe(place: Place): Offering[] {
  const c = place.category;
  if (c === "food" || c === "coffee" || c === "sweet") return [];
  const k = place.kind ?? "";
  const out: Offering[] = [];

  if (CULTURAL_KINDS.includes(k))      out.push(VIBE_META.cultural);
  if (ACTIVE_KINDS.includes(k))        out.push(VIBE_META.active);
  if (SCENIC_KINDS.includes(k))        out.push(VIBE_META.scenic);
  if (ENT_KINDS.includes(k))           out.push(VIBE_META.entertainment);
  if (SHOP_KINDS.includes(k))          out.push(VIBE_META.shopping);
  if (ICONIC_KINDS.includes(k) && out.length === 0) out.push(VIBE_META.iconic);

  // Fallback by category if kind didn't match
  if (out.length === 0) {
    if (c === "sight")  out.push(VIBE_META.cultural);
    if (c === "nature") out.push(VIBE_META.scenic);
    if (c === "event")  out.push(VIBE_META.entertainment);
    if (c === "bar")    out.push(VIBE_META.entertainment);
  }

  return out.slice(0, 2);
}

// ── Cross-cutting special badges ───────────────────────────────────────

const BADGES: Array<{ test: (p: Place, tags: string[]) => boolean; chip: Offering }> = [
  { test: (_p, tags) => tags.some((t) => /iconic|أيقوني|مشهور/.test(t)),
    chip: { key: "iconic", ar: "أيقوني", emoji: "⭐" } },
  { test: (_p, tags) => tags.some((t) => /view|panorama|إطلال|سماوي/.test(t)),
    chip: { key: "view", ar: "إطلالة", emoji: "🌅" } },
  { test: (_p, tags) => tags.some((t) => /design|أنيق|تصميم/.test(t)),
    chip: { key: "design", ar: "تصميم مميّز", emoji: "🎨" } },
  { test: (_p, tags) => tags.some((t) => /family|عائل|أطفال/.test(t)),
    chip: { key: "family", ar: "عوائل", emoji: "👨‍👩‍👧" } },
  { test: (_p, tags) => tags.some((t) => /rooftop|سطح/.test(t)),
    chip: { key: "rooftop", ar: "روف توب", emoji: "🏙" } },
  { test: (_p, tags) => tags.some((t) => /shisha|sheesha|شيشة/.test(t)),
    chip: { key: "shisha", ar: "شيشة", emoji: "💨" } },
];

export function specialBadges(place: Place): Offering[] {
  const tags = (place.tags ?? []).map((t) => t.toLowerCase());
  // Dedupe with what vibe already shows
  const vibeKeys = new Set(activityVibe(place).map((v) => v.key));
  return BADGES
    .filter(({ test, chip }) => test(place, tags) && !vibeKeys.has(chip.key))
    .map((b) => b.chip).slice(0, 2);
}

/** Composes the right chip set for a place based on its category. */
export function allOfferings(place: Place): Offering[] {
  if (place.category === "food") {
    return [...mealTimes(place), ...specialBadges(place)];
  }
  if (place.category === "coffee") {
    return [...coffeeOfferings(place), ...mealTimes(place), ...specialBadges(place)];
  }
  if (place.category === "sweet") {
    return [...coffeeOfferings(place), ...specialBadges(place)];
  }
  return [...activityVibe(place), ...specialBadges(place)];
}
