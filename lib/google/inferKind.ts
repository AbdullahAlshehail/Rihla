// Map Google place `types[]` → user-friendly Arabic "kind" labels.
// First match wins. Returns null when no useful classification is found.

export type Kind = {
  key: string;
  ar: string;
  emoji: string;
  category: "food" | "coffee" | "sight" | "nature" | "event" | "sweet" | "bar" | "shopping" | "wellness" | "other";
};

// Ordered rules — first matching Google type sets the kind.
// Restaurant subtypes (Google added these in 2023) win over the generic "restaurant".
const RULES: Array<{ match: string[]; kind: Kind }> = [
  // Food — specific cuisines and styles
  { match: ["fine_dining_restaurant"], kind: { key: "fine_dining", ar: "فاين داينينق", emoji: "🎩", category: "food" } },
  { match: ["fast_food_restaurant"], kind: { key: "fast", ar: "فاست فود", emoji: "⚡", category: "food" } },
  { match: ["italian_restaurant"], kind: { key: "italian", ar: "إيطالي", emoji: "🍝", category: "food" } },
  { match: ["japanese_restaurant"], kind: { key: "japanese", ar: "ياباني", emoji: "🍣", category: "food" } },
  { match: ["chinese_restaurant"], kind: { key: "chinese", ar: "صيني", emoji: "🥡", category: "food" } },
  { match: ["indian_restaurant"], kind: { key: "indian", ar: "هندي", emoji: "🍛", category: "food" } },
  { match: ["thai_restaurant"], kind: { key: "thai", ar: "تايلندي", emoji: "🌶", category: "food" } },
  { match: ["middle_eastern_restaurant", "lebanese_restaurant"], kind: { key: "arabic", ar: "عربي", emoji: "🥙", category: "food" } },
  { match: ["seafood_restaurant"], kind: { key: "seafood", ar: "بحريات", emoji: "🐟", category: "food" } },
  { match: ["steak_house"], kind: { key: "steak", ar: "ستيك", emoji: "🥩", category: "food" } },
  { match: ["sushi_restaurant"], kind: { key: "sushi", ar: "سوشي", emoji: "🍱", category: "food" } },
  { match: ["pizza_restaurant"], kind: { key: "pizza", ar: "بيتزا", emoji: "🍕", category: "food" } },
  { match: ["burger_restaurant", "hamburger_restaurant"], kind: { key: "burger", ar: "برغر", emoji: "🍔", category: "food" } },
  { match: ["barbecue_restaurant"], kind: { key: "bbq", ar: "مشاوي", emoji: "🍖", category: "food" } },
  { match: ["vegan_restaurant", "vegetarian_restaurant"], kind: { key: "vegan", ar: "نباتي", emoji: "🥗", category: "food" } },
  { match: ["mediterranean_restaurant"], kind: { key: "mediterranean", ar: "متوسطي", emoji: "🫒", category: "food" } },
  { match: ["french_restaurant"], kind: { key: "french", ar: "فرنسي", emoji: "🥖", category: "food" } },
  { match: ["spanish_restaurant"], kind: { key: "spanish", ar: "إسباني", emoji: "🥘", category: "food" } },
  { match: ["mexican_restaurant"], kind: { key: "mexican", ar: "مكسيكي", emoji: "🌮", category: "food" } },
  { match: ["korean_restaurant"], kind: { key: "korean", ar: "كوري", emoji: "🍜", category: "food" } },
  { match: ["brunch_restaurant", "breakfast_restaurant"], kind: { key: "brunch", ar: "برانش", emoji: "🍳", category: "food" } },

  // Coffee + bakery
  { match: ["coffee_shop"], kind: { key: "specialty", ar: "قهوة مختصة", emoji: "☕", category: "coffee" } },
  { match: ["cafe"], kind: { key: "cafe", ar: "كافيه", emoji: "☕", category: "coffee" } },
  { match: ["tea_house"], kind: { key: "tea", ar: "شاي", emoji: "🍵", category: "coffee" } },
  { match: ["bakery"], kind: { key: "bakery", ar: "مخبز", emoji: "🥐", category: "sweet" } },

  // Sweets
  { match: ["ice_cream_shop"], kind: { key: "icecream", ar: "آيس كريم", emoji: "🍦", category: "sweet" } },
  { match: ["dessert_shop", "dessert_restaurant"], kind: { key: "dessert", ar: "حلويات", emoji: "🍰", category: "sweet" } },
  { match: ["chocolate_shop"], kind: { key: "chocolate", ar: "شوكولاتة", emoji: "🍫", category: "sweet" } },
  { match: ["donut_shop"], kind: { key: "donut", ar: "دوناتس", emoji: "🍩", category: "sweet" } },
  { match: ["juice_shop"], kind: { key: "juice", ar: "عصائر", emoji: "🧃", category: "sweet" } },

  // Bar / Night
  { match: ["wine_bar"], kind: { key: "wine_bar", ar: "بار نبيذ", emoji: "🍷", category: "bar" } },
  { match: ["cocktail_bar"], kind: { key: "cocktail", ar: "كوكتيل", emoji: "🍸", category: "bar" } },
  { match: ["pub", "bar"], kind: { key: "pub", ar: "بار", emoji: "🍻", category: "bar" } },
  { match: ["night_club"], kind: { key: "club", ar: "ملهى", emoji: "🪩", category: "bar" } },

  // Sights
  { match: ["museum"], kind: { key: "museum", ar: "متحف", emoji: "🏛", category: "sight" } },
  { match: ["art_gallery"], kind: { key: "gallery", ar: "صالة فنون", emoji: "🖼", category: "sight" } },
  { match: ["historical_landmark", "historical_place"], kind: { key: "landmark", ar: "معلم تاريخي", emoji: "🗿", category: "sight" } },
  { match: ["monument"], kind: { key: "monument", ar: "نصب تاريخي", emoji: "⛲", category: "sight" } },
  { match: ["church", "mosque", "synagogue", "hindu_temple", "place_of_worship"], kind: { key: "religious", ar: "معلم ديني", emoji: "🕌", category: "sight" } },
  { match: ["castle"], kind: { key: "castle", ar: "قلعة", emoji: "🏰", category: "sight" } },
  { match: ["observation_deck"], kind: { key: "view", ar: "إطلالة", emoji: "🌅", category: "sight" } },
  { match: ["library"], kind: { key: "library", ar: "مكتبة", emoji: "📚", category: "sight" } },
  { match: ["aquarium"], kind: { key: "aquarium", ar: "أكواريوم", emoji: "🐠", category: "sight" } },
  { match: ["planetarium"], kind: { key: "planetarium", ar: "قبة فلكية", emoji: "🌌", category: "sight" } },
  { match: ["zoo", "wildlife_park"], kind: { key: "zoo", ar: "حديقة حيوان", emoji: "🦁", category: "sight" } },
  { match: ["market"], kind: { key: "market", ar: "سوق", emoji: "🛒", category: "sight" } },

  // Nature
  { match: ["national_park"], kind: { key: "national_park", ar: "محمية وطنية", emoji: "🏞", category: "nature" } },
  { match: ["state_park"], kind: { key: "park", ar: "متنزه", emoji: "🌳", category: "nature" } },
  { match: ["park"], kind: { key: "park", ar: "متنزه", emoji: "🌳", category: "nature" } },
  { match: ["garden"], kind: { key: "garden", ar: "حديقة", emoji: "🌷", category: "nature" } },
  { match: ["beach"], kind: { key: "beach", ar: "شاطئ", emoji: "🏖", category: "nature" } },
  { match: ["hiking_area"], kind: { key: "hike", ar: "هايكنق", emoji: "🥾", category: "nature" } },

  // Entertainment
  { match: ["amusement_park"], kind: { key: "amusement", ar: "ملاهي", emoji: "🎢", category: "event" } },
  { match: ["amusement_center"], kind: { key: "arcade", ar: "ترفيه", emoji: "🎮", category: "event" } },
  { match: ["water_park"], kind: { key: "water_park", ar: "ألعاب مائية", emoji: "🏊", category: "event" } },
  { match: ["bowling_alley"], kind: { key: "bowling", ar: "بولينج", emoji: "🎳", category: "event" } },
  { match: ["movie_theater"], kind: { key: "cinema", ar: "سينما", emoji: "🎬", category: "event" } },
  { match: ["performing_arts_theater"], kind: { key: "theater", ar: "مسرح", emoji: "🎭", category: "event" } },
  { match: ["stadium"], kind: { key: "stadium", ar: "ملعب", emoji: "🏟", category: "event" } },
  { match: ["concert_hall"], kind: { key: "concerts", ar: "حفلات", emoji: "🎤", category: "event" } },
  { match: ["casino"], kind: { key: "casino", ar: "كازينو", emoji: "🎰", category: "event" } },

  // Shopping
  { match: ["shopping_mall"], kind: { key: "mall", ar: "مول", emoji: "🛍", category: "shopping" } },
  { match: ["clothing_store"], kind: { key: "fashion", ar: "ملابس", emoji: "👗", category: "shopping" } },
  { match: ["department_store"], kind: { key: "department", ar: "متجر شامل", emoji: "🏬", category: "shopping" } },
  { match: ["jewelry_store"], kind: { key: "jewelry", ar: "مجوهرات", emoji: "💎", category: "shopping" } },

  // Wellness
  { match: ["spa"], kind: { key: "spa", ar: "سبا", emoji: "💆", category: "wellness" } },
  { match: ["wellness_center"], kind: { key: "wellness", ar: "مركز صحي", emoji: "🧖", category: "wellness" } },

  // Generic restaurant — last resort for food
  { match: ["restaurant"], kind: { key: "restaurant", ar: "مطعم", emoji: "🍽", category: "food" } },
  { match: ["meal_takeaway", "meal_delivery"], kind: { key: "takeaway", ar: "وجبات سفري", emoji: "🥡", category: "food" } },
  { match: ["food"], kind: { key: "food", ar: "أكل", emoji: "🍴", category: "food" } },
  { match: ["tourist_attraction"], kind: { key: "attraction", ar: "معلم سياحي", emoji: "📍", category: "sight" } },
  { match: ["point_of_interest"], kind: { key: "poi", ar: "مكان مميّز", emoji: "📌", category: "sight" } },
];

/** Returns the first matching kind for a Google types[] array. */
export function inferKind(types?: string[]): Kind | null {
  if (!types || types.length === 0) return null;
  for (const rule of RULES) {
    for (const m of rule.match) {
      if (types.includes(m)) return rule.kind;
    }
  }
  return null;
}

/** Generate a short Arabic blurb describing a place from public signals only.
 *  Costs nothing — built from data already returned by Search/Nearby.
 *  Examples:
 *   "مكان ممتاز · ١٥k زائر يحبّونه · مفتوح الآن"
 *   "متوسطي · ٤.٢★ · يستحق الزيارة لو قربت من المنطقة"
 *   "💎 مكان ذو جودة عالية وزحمة أقل — ٢٠٠ زائر فقط أعطوه ٤.٨★"
 */
export function generateBlurb(args: {
  rating?: number | null;
  reviewCount?: number | null;
  openNow?: boolean | null;
  priceLevel?: number | null;
  kind?: Kind | null;
}): string {
  const { rating, reviewCount: c, openNow, priceLevel: pl, kind } = args;
  const parts: string[] = [];

  // Quality tier
  if (rating != null) {
    if (rating >= 4.7 && c != null && c >= 1000) parts.push("⭐ ممتاز ومشهور");
    else if (rating >= 4.7 && c != null && c >= 80 && c <= 1000) parts.push("💎 جودة عالية وزحمة أقل");
    else if (rating >= 4.5) parts.push("جدير بالزيارة");
    else if (rating >= 4.0) parts.push("جيد عموماً");
    else if (rating >= 3.5) parts.push("متوسط — راجع التقييمات");
    else parts.push("⚠️ تقييمه أقل من المتوسط");
  } else if (c == null || c < 30) {
    parts.push("جديد أو غير مجرّب");
  }

  // Social proof
  if (c != null) {
    if (c >= 10000) parts.push(`أكثر من ${Math.round(c / 1000)}k زائر`);
    else if (c >= 1000) parts.push(`${(c / 1000).toFixed(1)}k زائر يحبّونه`);
    else if (c >= 200) parts.push(`${c} زائر`);
  }

  // Price level
  if (pl === 4) parts.push("💰 فاخر");
  else if (pl === 3) parts.push("💰 سعره عالي");
  else if (pl === 1) parts.push("اقتصادي");

  // Status
  if (openNow === true) parts.push("🟢 مفتوح الآن");

  // Kind context (only if not first chip — adds variety)
  if (kind && parts.length < 3) parts.push(`${kind.emoji} ${kind.ar}`);

  return parts.join(" · ");
}

/** Category-aware verdict for a score. Returns a short Arabic phrase that
 *  tells the user what the number actually means for THIS kind of place.
 *  - "ممتاز" alone is vague; "قهوة مميزة" is concrete.
 *  - Tone drives the colour of the verdict badge.
 */
export type ScoreVerdict = {
  ar: string;
  tone: "excellent" | "good" | "ok" | "weak";
  gradientBg: string; // tailwind classes for badge background
  textColor: string;  // tailwind class for verdict text
};

const VERDICT_BY_CATEGORY: Record<string, Record<"excellent"|"good"|"ok"|"weak", string>> = {
  food:    { excellent: "مطعم ممتاز",   good: "مطعم زين",     ok: "متوسط",       weak: "ضعيف" },
  coffee:  { excellent: "قهوة مميّزة",  good: "قهوة زينة",    ok: "عادية",       weak: "ضعيفة" },
  sight:   { excellent: "لا يفوّت",     good: "يستحق",        ok: "زين لو قريب", weak: "ما يستحق" },
  nature:  { excellent: "خلاّب",        good: "جميل",          ok: "عادي",        weak: "متوسط" },
  event:   { excellent: "ممتعة جداً",    good: "ممتعة",         ok: "متاح",         weak: "متوسط" },
  sweet:   { excellent: "لذيذ جداً",     good: "لذيذ",          ok: "عادي",         weak: "متوسط" },
  bar:     { excellent: "راقي",          good: "ممتع",          ok: "متاح",         weak: "متوسط" },
};

const TONE_STYLE: Record<"excellent"|"good"|"ok"|"weak", { gradientBg: string; textColor: string }> = {
  excellent: { gradientBg: "bg-gradient-to-r from-emerald-500 to-emerald-600", textColor: "text-white" },
  good:      { gradientBg: "bg-gradient-to-r from-amber-500 to-amber-600",     textColor: "text-white" },
  ok:        { gradientBg: "bg-gradient-to-r from-stone-400 to-stone-500",     textColor: "text-white" },
  weak:      { gradientBg: "bg-gradient-to-r from-rose-400 to-rose-500",        textColor: "text-white" },
};

export function scoreVerdict(score: number, category?: string | null): ScoreVerdict {
  const tone: ScoreVerdict["tone"] =
    score >= 85 ? "excellent"
    : score >= 70 ? "good"
    : score >= 55 ? "ok"
    : "weak";
  const ar = VERDICT_BY_CATEGORY[category ?? ""]?.[tone]
    ?? (tone === "excellent" ? "ممتاز" : tone === "good" ? "زين" : tone === "ok" ? "متوسط" : "ضعيف");
  return { ar, tone, ...TONE_STYLE[tone] };
}

/** Generate a 1-line Arabic summary from a Place row's stored fields when
 *  no curated ai_summary/review_summary/tip exists. Costs nothing.
 *  Used by PlacedRow so every place ALWAYS has a written summary. */
export function summarizeFromPlaceFields(args: {
  rating?: number | null;
  reviewCount?: number | null;
  priceLevel?: number | null;
  kindAr?: string | null;
  cityLabel?: string | null;
}): string {
  const r = args.rating ?? 0;
  const c = args.reviewCount ?? 0;
  const parts: string[] = [];

  // Quality verdict
  if (r >= 4.7 && c >= 1000) parts.push("⭐ ممتاز ومشهور");
  else if (r >= 4.6 && c >= 80 && c <= 1500) parts.push("💎 جودة عالية وزحمة أقل");
  else if (r >= 4.5) parts.push("جدير بالزيارة");
  else if (r >= 4.0) parts.push("جيد عموماً");
  else if (r >= 3.5) parts.push("متوسط — راجع التقييمات");
  else if (r > 0) parts.push("⚠️ تقييمه ضعيف");
  else if (c < 30) parts.push("جديد أو غير مجرّب");

  // Social proof in plain words
  if (c >= 10000) parts.push(`أكثر من ${Math.round(c / 1000)}k زائر`);
  else if (c >= 1000) parts.push(`${(c / 1000).toFixed(1)}k زائر يحبّونه`);
  else if (c >= 200) parts.push(`${c} زائر`);

  // Price level
  if (args.priceLevel === 4) parts.push("فاخر");
  else if (args.priceLevel === 3) parts.push("سعره عالي");
  else if (args.priceLevel === 1) parts.push("اقتصادي");

  return parts.length > 0 ? parts.join(" · ") : "مكان متاح في رحلتك";
}

// ── Estimated visit duration by category — used to help users plan their day
export function estimateVisitDuration(category?: string | null): string {
  switch (category) {
    case "food":   return "ساعة - ساعتين";
    case "coffee": return "٣٠ - ٤٥د";
    case "sweet":  return "١٥ - ٣٠د";
    case "sight":  return "ساعة - ساعتين";
    case "nature": return "ساعتين - ٣ ساعات";
    case "event":  return "٢ - ٤ ساعات";
    case "bar":    return "١ - ٣ ساعات";
    default:       return "ساعة";
  }
}

// ── Pick the best review snippet from a place's google_reviews ──
type ReviewLike = {
  author_name?: string;
  rating?: number;
  text: string;
  language?: string;
  relative_time?: string;
};

export function pickReviewSnippet(
  reviews: ReviewLike[] | null | undefined,
): { quote: string; author: string; rating?: number } | null {
  if (!reviews || reviews.length === 0) return null;
  // Prefer Arabic positive reviews with short-medium length
  const score = (r: ReviewLike): number => {
    let s = 0;
    if (r.language === "ar") s += 10;
    if ((r.rating ?? 0) >= 4) s += 5;
    const len = (r.text ?? "").length;
    if (len >= 30 && len <= 200) s += 5;
    if (len >= 200 && len <= 400) s += 2;
    return s;
  };
  const best = [...reviews].sort((a, b) => score(b) - score(a))[0];
  if (!best || !best.text) return null;
  const trimmed = best.text.length > 140 ? best.text.slice(0, 138).trim() + "…" : best.text.trim();
  return {
    quote: trimmed,
    author: best.author_name?.trim() || "زائر",
    rating: best.rating,
  };
}

/** Compute a 0–100 "decision score" from public Google signals only.
 *  Useful BEFORE adding a place, to help the user pick the best. */
export function instantScore(args: {
  rating?: number | null;
  reviewCount?: number | null;
  openNow?: boolean | null;
}): number {
  let s = 50;
  if (args.rating != null) {
    // 4.5★ → +14, 4.8★ → +18, 5.0★ → +21
    s += Math.round((args.rating - 3.5) * 14);
  }
  if (args.reviewCount != null) {
    const c = args.reviewCount;
    s += c >= 10000 ? 15
      : c >= 3000 ? 12
      : c >= 1000 ? 9
      : c >= 300 ? 6
      : c >= 100 ? 3
      : c >= 30 ? 0
      : -8; // <30 reviews — unreliable
  }
  if (args.openNow === true) s += 4;
  return Math.max(0, Math.min(100, s));
}
