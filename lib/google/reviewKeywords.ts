// Extract "most mentioned" keyword chips from Google review snippets.
// TripAdvisor-style "Reviews mention: cozy · friendly staff · great coffee".
// Pure function — runs on the already-stored google_reviews array.

import type { GoogleReviewSnippet } from "@/lib/supabase/database.types";

// Stopwords we strip BEFORE counting (Arabic + English noise).
const STOP = new Set([
  // English
  "the","a","an","and","or","but","is","was","are","were","be","been","being",
  "have","has","had","do","did","does","will","would","could","should","may","might",
  "of","in","on","at","to","for","with","from","by","about","as","into","through",
  "very","really","so","just","also","too","not","no","yes","than","then",
  "this","that","these","those","it","its","there","here","what","which","who",
  "i","we","you","they","he","she","my","our","your","their","his","her","me","us","them",
  "great","good","nice","amazing","excellent","best","love","like","place","time",
  // Arabic
  "في","من","الى","إلى","على","عن","مع","عند","هذا","هذه","ذلك","تلك",
  "كان","كانت","يكون","تكون","هو","هي","هم","هن","نحن","أنا","انا","انت","أنت",
  "ما","ماذا","لماذا","كيف","متى","أين","اين","الذي","التي","الذين","اللي",
  "جدا","جداً","فقط","ايضا","أيضا","لكن","ولكن","حتى","قد","لقد",
  "مكان","المكان","أفضل","افضل","رائع","رائعة","ممتاز","ممتازة","جميل","جميلة",
  "كثيرا","كثيراً","شي","شيء","واحد","واحدة","الكل","كل","كله","كلها",
]);

// Common useful nouns/adjectives we WANT to surface when they appear.
// Keyed by lowercase form; value is the Arabic display label.
const DISPLAY_OVERRIDES: Record<string, string> = {
  "service": "الخدمة",
  "staff": "الطاقم",
  "food": "الأكل",
  "coffee": "القهوة",
  "atmosphere": "الأجواء",
  "view": "الإطلالة",
  "price": "السعر",
  "vibe": "الفايب",
  "menu": "المنيو",
  "music": "الموسيقى",
  "ambience": "الأجواء",
  "garden": "الحديقة",
  "terrace": "التراس",
  "wine": "النبيذ",
  "dessert": "الحلى",
  "breakfast": "الفطور",
  "lunch": "الغداء",
  "dinner": "العشاء",
  "brunch": "البرانش",
  "خدمة": "الخدمة",
  "الخدمة": "الخدمة",
  "طعم": "الطعم",
  "الطعم": "الطعم",
  "أكل": "الأكل",
  "الأكل": "الأكل",
  "قهوة": "القهوة",
  "القهوة": "القهوة",
  "أجواء": "الأجواء",
  "الأجواء": "الأجواء",
  "إطلالة": "الإطلالة",
  "الإطلالة": "الإطلالة",
  "ديكور": "الديكور",
  "الديكور": "الديكور",
  "موظفين": "الطاقم",
  "العمال": "الطاقم",
  "الموظفين": "الطاقم",
  "أسعار": "الأسعار",
  "الأسعار": "الأسعار",
  "حلويات": "الحلى",
  "الحلى": "الحلى",
};

export type ReviewMention = { label: string; count: number };

/** Returns up to N most-mentioned meaningful keywords across reviews. */
export function extractMentions(
  reviews: GoogleReviewSnippet[] | null | undefined,
  limit = 6,
): ReviewMention[] {
  if (!reviews || reviews.length < 2) return [];
  const counts = new Map<string, number>();
  for (const r of reviews) {
    if (!r.text) continue;
    // Strip punctuation, lowercase Latin, split on whitespace
    const tokens = r.text
      .replace(/[.,!?؟،;:()"'“”‘’«»\-_/\\]/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3 && t.length <= 18 && !/^\d+$/.test(t) && !STOP.has(t));
    // Count UNIQUE tokens per review (so one chatty reviewer doesn't dominate)
    const seenInReview = new Set<string>();
    for (const t of tokens) {
      if (seenInReview.has(t)) continue;
      seenInReview.add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  // Pick tokens that show up in ≥2 reviews (lower-bound trust)
  const ranked = Array.from(counts.entries())
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit * 2); // overshoot so we can dedup by display label

  // Dedup by display label (e.g. "service"/"الخدمة" collapse to one chip)
  const out: ReviewMention[] = [];
  const seenLabel = new Set<string>();
  for (const [tok, n] of ranked) {
    const label = DISPLAY_OVERRIDES[tok] ?? tok;
    if (seenLabel.has(label)) continue;
    seenLabel.add(label);
    out.push({ label, count: n });
    if (out.length >= limit) break;
  }
  return out;
}

/** 5-bucket histogram of star ratings from review snippets. */
export function ratingHistogram(
  reviews: GoogleReviewSnippet[] | null | undefined,
): { stars: 1 | 2 | 3 | 4 | 5; count: number; pct: number }[] {
  const buckets = new Map<1 | 2 | 3 | 4 | 5, number>([[1, 0],[2, 0],[3, 0],[4, 0],[5, 0]]);
  let total = 0;
  for (const r of reviews ?? []) {
    if (typeof r.rating !== "number") continue;
    const s = Math.max(1, Math.min(5, Math.round(r.rating))) as 1 | 2 | 3 | 4 | 5;
    buckets.set(s, (buckets.get(s) ?? 0) + 1);
    total++;
  }
  if (total === 0) return [];
  return [5, 4, 3, 2, 1].map((s) => {
    const stars = s as 1 | 2 | 3 | 4 | 5;
    const count = buckets.get(stars) ?? 0;
    return { stars, count, pct: Math.round((count / total) * 100) };
  });
}
