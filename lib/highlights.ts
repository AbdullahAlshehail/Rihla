// Maps internal highlight keys to Arabic display labels.
// Used in cards + detail sheet to show "أفضل ما في هذا المكان".

export type HighlightInfo = { ar: string; emoji: string; tone: "good" | "neut" | "warm" };

export const HIGHLIGHT_LABEL: Record<string, HighlightInfo> = {
  // ── Coffee/sweets
  coffee_great: { emoji: "☕", ar: "قهوة اختصاصية ممتازة", tone: "good" },
  sweets_great: { emoji: "🥐", ar: "حلا طازج ممتاز", tone: "good" },
  brunch: { emoji: "🍳", ar: "برانش مميّز", tone: "good" },

  // ── Food
  fine: { emoji: "🎩", ar: "تجربة راقية", tone: "good" },
  local: { emoji: "🏛", ar: "أصيل محلي", tone: "good" },
  value: { emoji: "💰", ar: "قيمة ممتازة بالسعر", tone: "good" },
  legendary: { emoji: "📚", ar: "أسطوري — عالم يعرفه", tone: "good" },
  family: { emoji: "👨‍👩‍👧", ar: "مناسب للعائلة", tone: "neut" },

  // ── View / atmosphere
  view_great: { emoji: "🌅", ar: "إطلالة رائعة", tone: "good" },
  vibe_great: { emoji: "✨", ar: "أجواء مميّزة", tone: "good" },
  romantic: { emoji: "💑", ar: "رومانسي", tone: "good" },

  // ── Sights / nature
  iconic: { emoji: "🌟", ar: "أيقوني — لا يفوّت", tone: "good" },
  art: { emoji: "🎨", ar: "للفن وعشّاقه", tone: "good" },
  heritage: { emoji: "📜", ar: "تراثي / تاريخي", tone: "good" },
  hidden: { emoji: "💎", ar: "هيدن جيم", tone: "good" },
  clean: { emoji: "🧼", ar: "نظيف ومرتّب", tone: "good" },
  beach: { emoji: "🏖", ar: "شاطئ جميل", tone: "good" },
  walk: { emoji: "🚶", ar: "مشي ممتع", tone: "neut" },
  nature: { emoji: "🌿", ar: "تجربة طبيعية", tone: "good" },
  best: { emoji: "🏆", ar: "من الأفضل عالمياً", tone: "good" },
};

// Map our internal `kind` (subtype) to Arabic display.
// Each "kind" is the PRIMARY category of the place — what it IS.
export const KIND_LABEL: Record<string, { ar: string; emoji: string }> = {
  // food
  fine_dining: { emoji: "🎩", ar: "فاين داينينق" },
  michelin: { emoji: "⭐", ar: "ميشلان نجمة" },
  traditional: { emoji: "🥖", ar: "مطعم محلي تقليدي" },
  italian: { emoji: "🍝", ar: "مطعم إيطالي" },
  seafood: { emoji: "🐟", ar: "مطعم بحريّات" },
  bistro: { emoji: "🍷", ar: "بسترو" },
  casual: { emoji: "🍴", ar: "كاجوال" },
  fast: { emoji: "⚡", ar: "وجبات سريعة" },
  // coffee
  specialty: { emoji: "☕", ar: "قهوة اختصاصية" },
  roastery: { emoji: "🏭", ar: "محمصة" },
  // bar / nightlife
  rooftop: { emoji: "🌃", ar: "بار روفتوب" },
  beach_club: { emoji: "🏖", ar: "نادي شاطئ" },
  // sights
  museum: { emoji: "🏛", ar: "متحف" },
  landmark: { emoji: "🗿", ar: "معلم" },
  market: { emoji: "🛒", ar: "سوق" },
  panorama: { emoji: "🌅", ar: "نقطة إطلالة" },
  village: { emoji: "🏘", ar: "قرية" },
  // nature
  garden: { emoji: "🌿", ar: "حديقة" },
  beach: { emoji: "🏖", ar: "شاطئ" },
  hike: { emoji: "🥾", ar: "هايكنق / مسار" },
  // event
  activity: { emoji: "🎟", ar: "نشاط / فعالية" },
  // sweet
  sweet: { emoji: "🍦", ar: "حلويات" },
};

export function getHighlightDisplays(highlights: string[] | null | undefined): HighlightInfo[] {
  if (!highlights) return [];
  return highlights
    .map((h) => HIGHLIGHT_LABEL[h])
    .filter((x): x is HighlightInfo => !!x);
}

export function getKindDisplay(kind: string | null | undefined): { ar: string; emoji: string } | null {
  if (!kind) return null;
  return KIND_LABEL[kind] ?? null;
}

// Top-level category — what kind of THING this is, in user-friendly Arabic.
// Always present (every place has a category). Use this as the primary "what
// is this place?" badge.
export const CATEGORY_LABEL: Record<string, { ar: string; emoji: string; bg: string; fg: string }> = {
  food:    { ar: "مطاعم",        emoji: "🍽", bg: "bg-orange-100",  fg: "text-orange-900" },
  coffee:  { ar: "قهاوي",        emoji: "☕", bg: "bg-amber-100",   fg: "text-amber-900" },
  sight:   { ar: "معالم",        emoji: "🏛", bg: "bg-sky-100",     fg: "text-sky-900" },
  nature:  { ar: "طبيعة",        emoji: "🌿", bg: "bg-emerald-100", fg: "text-emerald-900" },
  event:   { ar: "ترفيه وعروض",  emoji: "🎭", bg: "bg-purple-100",  fg: "text-purple-900" },
  sweet:   { ar: "حلويات",       emoji: "🍰", bg: "bg-pink-100",    fg: "text-pink-900" },
  bar:     { ar: "بارات وروف توب", emoji: "🍸", bg: "bg-yellow-100",  fg: "text-yellow-900" },
};

export function getCategoryDisplay(
  category: string | null | undefined,
): { ar: string; emoji: string; bg: string; fg: string } {
  if (!category) return { ar: "مكان", emoji: "📍", bg: "bg-stone-100", fg: "text-ink" };
  return CATEGORY_LABEL[category] ?? { ar: category, emoji: "📍", bg: "bg-stone-100", fg: "text-ink" };
}
