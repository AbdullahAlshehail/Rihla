// Derive 1-2 "what's good about THIS coffee place" chips for PlaceCard.
// Pure function — runs off existing fields (kind, name, rating, reviews,
// google_reviews snippets) so adding new chips costs $0 in API.
//
// Saudi traveler context: when scrolling 100+ coffee spots, "specialty roast",
// "good seating", "rooftop", "matcha", "garden" are the deciders.

import type { Place, GoogleReviewSnippet } from "@/lib/supabase/database.types";

export type CoffeeHighlight = {
  key: string;
  ar: string;
  emoji: string;
  // tonal classes — light bg + dark text, fits the existing card aesthetic
  cls: string;
};

const PALETTE = {
  amber:   "bg-amber-50 text-amber-800 border-amber-200",
  sky:     "bg-sky-50 text-sky-800 border-sky-200",
  emerald: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rose:    "bg-rose-50 text-rose-800 border-rose-200",
  violet:  "bg-violet-50 text-violet-800 border-violet-200",
  stone:   "bg-stone-50 text-stone-800 border-stone-200",
};

const NAME_REGEX = {
  matcha:   /matcha|ماتشا/i,
  garden:   /garden|جاردن|garden|حديقة|تراس|terrace/i,
  rooftop:  /rooftop|روف ?توب|سكاي|sky|إطلال/i,
  bakery:   /bakery|بيكري|مخبز|bread|دوكة|باجيتا/i,
  brunch:   /brunch|برانش|breakfast|فطور/i,
  artisan:  /artisan|روست(ر|ري)|محمصة|roaster/i,
  saudi:    /شاهي|عربي|عُمق|سعودي|نجد/i,
  view:     /view|اطلال|سكاي|مطل|sky/i,
  family:   /family|عائل/i,
};

const REVIEW_KEYWORDS: Array<{ key: string; ar: string; emoji: string; cls: string; words: RegExp }> = [
  { key: "quiet",     ar: "جلسات هادئة",     emoji: "🧘", cls: PALETTE.emerald, words: /quiet|calm|peaceful|هادئ|هادي|سكون|ريلاكس/i },
  { key: "wifi",      ar: "للعمل",            emoji: "💻", cls: PALETTE.sky,     words: /wifi|wi-?fi|laptop|work|دراسة|عمل|لابتوب|اشتغل/i },
  { key: "tasty",     ar: "قهوة ممتازة",     emoji: "☕", cls: PALETTE.amber,   words: /great coffee|amazing coffee|قهوة (ممتازة|روعة|جميلة|طعم|نكهة|كثير ?حلوة)/i },
  { key: "view",      ar: "إطلالة",           emoji: "🌇", cls: PALETTE.rose,    words: /great view|view is|إطلال|منظر|مطل/i },
  { key: "decor",     ar: "ديكور جميل",      emoji: "✨", cls: PALETTE.violet,  words: /beautiful|design|aesthetic|ديكور|تصميم|جميل|fancy/i },
  { key: "fresh",     ar: "إفطار طازج",      emoji: "🥐", cls: PALETTE.amber,   words: /fresh bread|croissant|pastry|طازج|كروسون|معجنات|فطور (لذيذ|طازج|روعة)/i },
  { key: "matcha",    ar: "ماتشا",            emoji: "🍵", cls: PALETTE.emerald, words: /matcha|ماتشا/i },
];

/** Returns up to 2 highlights specific to this coffee place. Falls back
 *  to category-style chips when reviews are sparse. */
export function coffeeHighlights(place: Place): CoffeeHighlight[] {
  if (place.category !== "coffee") return [];
  const out: CoffeeHighlight[] = [];
  const seen = new Set<string>();

  const push = (h: CoffeeHighlight) => {
    if (seen.has(h.key)) return;
    seen.add(h.key);
    out.push(h);
  };

  // 1) Kind-based wins (deterministic)
  if (place.kind === "rooftop") push({ key: "rooftop", ar: "روف توب", emoji: "🌃", cls: PALETTE.rose });
  if (place.kind === "roastery") push({ key: "roaster", ar: "محمصة", emoji: "🔥", cls: PALETTE.amber });
  if (place.kind === "specialty") {
    // only push as "specialty" if rating earns it
    if ((place.rating ?? 0) >= 4.6) push({ key: "specialty", ar: "قهوة ممتازة", emoji: "☕", cls: PALETTE.amber });
  }

  // 2) Name-based wins
  const name = place.name ?? "";
  if (NAME_REGEX.matcha.test(name))   push({ key: "matcha",  ar: "ماتشا",       emoji: "🍵", cls: PALETTE.emerald });
  if (NAME_REGEX.garden.test(name))   push({ key: "garden",  ar: "جاردن",       emoji: "🌿", cls: PALETTE.emerald });
  if (NAME_REGEX.rooftop.test(name))  push({ key: "rooftop", ar: "روف توب",     emoji: "🌃", cls: PALETTE.rose });
  if (NAME_REGEX.bakery.test(name))   push({ key: "bakery",  ar: "مخبوزات",     emoji: "🥐", cls: PALETTE.amber });
  if (NAME_REGEX.brunch.test(name))   push({ key: "brunch",  ar: "برانش",       emoji: "🍳", cls: PALETTE.amber });
  if (NAME_REGEX.saudi.test(name))    push({ key: "saudi",   ar: "قهوة سعودية", emoji: "🇸🇦", cls: PALETTE.emerald });
  if (NAME_REGEX.view.test(name))     push({ key: "view",    ar: "إطلالة",       emoji: "🌇", cls: PALETTE.rose });

  // 3) Review-keyword wins — only if we have ≥3 reviews to draw from
  const reviews = (place.google_reviews as GoogleReviewSnippet[] | null | undefined) ?? [];
  if (reviews.length >= 3) {
    const allText = reviews.map((r) => r.text ?? "").join(" ").toLowerCase();
    for (const r of REVIEW_KEYWORDS) {
      if (r.words.test(allText)) {
        push({ key: r.key, ar: r.ar, emoji: r.emoji, cls: r.cls });
      }
    }
  }

  // 4) Fallback: if nothing matched but rating is great, push trust signal
  if (out.length === 0 && (place.rating ?? 0) >= 4.7 && (place.review_count ?? 0) >= 100) {
    push({ key: "topRated", ar: "محبوب جداً", emoji: "🌟", cls: PALETTE.amber });
  }

  // Cap at 2 chips to keep the card calm
  return out.slice(0, 2);
}

// ─── Now-Screen helpers ──────────────────────────────────────────────────
// One "primary character" label per place — what's THIS cafe actually about?
// Used on the Now card for cafes so the user can tell three coffee suggestions
// apart at a glance (real specialty vs photo spot vs work hangout).

export type CoffeeNature = {
  key: "real_specialty" | "morning" | "work" | "photo" | "view_over_coffee" | "trending_crowded" | "pastry_strong";
  ar: string;
  emoji: string;
};

const VIEW_NAME_REGEX = /rooftop|روف ?توب|view|اطلال|إطلال|مطل|sky|سكاي/i;
const TRENDING_TEXT_REGEX = /trending|ترند|انستقرام|انستاجرام|انستجرام|instagram|viral|طابور|crowd(ed)?|مزدحم/i;

/** Return up to 2 distinctive labels — used to differentiate cafes side-by-side. */
export function coffeeNature(place: Place): CoffeeNature[] {
  if (place.category !== "coffee") return [];
  const out: CoffeeNature[] = [];

  const name = place.name ?? "";
  const tagText = ((place.tags ?? []).join(" ") + " " + (place.highlights ?? []).join(" ")).toLowerCase();
  const reviews = (place.google_reviews as GoogleReviewSnippet[] | null | undefined) ?? [];
  const allReviewText = reviews.map((r) => r.text ?? "").join(" ").toLowerCase();
  const r = place.rating ?? 0;
  const c = place.review_count ?? 0;

  // Real specialty: kind says so AND people rave about the actual coffee
  if (
    (place.kind === "specialty" || place.kind === "roastery" || /specialty|مختصة/i.test(tagText))
    && (r >= 4.5 || /great coffee|amazing coffee|قهوة (ممتازة|رو(ع|ع)ة)/i.test(allReviewText))
  ) {
    out.push({ key: "real_specialty", ar: "قهوة مختصة فعلاً", emoji: "☕" });
  }

  // Morning spot — opens early + has pastry/breakfast signals
  const opensEarly = (() => {
    const todays = place.opening_hours?.[0];
    if (!todays) return false;
    return /[5-9]:?[0-9]?[0-9]?\s*am/i.test(todays) || /^(5|6|7|8|9)/.test(todays);
  })();
  if (
    (opensEarly || /breakfast|brunch|فطور|برانش/i.test(allReviewText + tagText))
    && (place.category === "coffee")
  ) {
    out.push({ key: "morning", ar: "مناسب صباحًا", emoji: "🌅" });
  }

  // Work-friendly
  if (/wifi|wi-?fi|laptop|work|دراسة|عمل|لابتوب|اشتغل|quiet|هادئ/i.test(allReviewText)) {
    out.push({ key: "work", ar: "مناسب شغل", emoji: "💻" });
  }

  // Photogenic — strong design/view mentions
  if (
    /beautiful|design|aesthetic|ديكور|تصميم|fancy|insta|إنستا/i.test(allReviewText)
    || VIEW_NAME_REGEX.test(name)
    || place.kind === "rooftop"
  ) {
    out.push({ key: "photo", ar: "مناسب تصوير", emoji: "📸" });
  }

  // View-over-coffee: design/view mentioned heavily BUT coffee rating modest
  if (
    (VIEW_NAME_REGEX.test(name) || /view|إطلال|مطل/i.test(allReviewText))
    && r < 4.4 && c >= 50
  ) {
    out.push({ key: "view_over_coffee", ar: "المكان أجمل من القهوة", emoji: "🌇" });
  }

  // Trending / crowded
  if (TRENDING_TEXT_REGEX.test(tagText + " " + allReviewText) && c > 800) {
    out.push({ key: "trending_crowded", ar: "ترند وقد يكون مزدحم", emoji: "🔥" });
  }

  // Pastry-strong
  if (/croissant|pastry|كروسون|معجنات|بيستري|donut|دونات/i.test(allReviewText)) {
    out.push({ key: "pastry_strong", ar: "البيستري قوي", emoji: "🥐" });
  }

  // Cap — Now card stays calm
  return out.slice(0, 2);
}
