// Estimate a place's *operating-since* date from the oldest Google review's
// `relative_time` ("a year ago", "5 years ago", "3 months ago", …). Google
// only ever returns up to 5 reviews, so this is a *lower bound* — the place
// has been around for AT LEAST this long. Good enough for a "since …" badge
// and the "🆕 جديد" filter signal.

import type { GoogleReviewSnippet } from "@/lib/supabase/database.types";

// Parse forms like:
//   "a year ago" → 12
//   "2 years ago" → 24
//   "11 months ago" → 11
//   "a month ago" → 1
//   "3 weeks ago" → ~0.75
//   "5 days ago" → ~0.16
//   "in the last week" → ~0.25
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function parseEnglishRelative(s: string): number | null {
  const t = s.trim().toLowerCase();
  const m = t.match(/(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(year|month|week|day|hour)s?\s+ago/);
  if (!m) {
    if (/in the last (week|month|year)/.test(t)) return 0.5;
    return null;
  }
  const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : (NUMBER_WORDS[m[1]] ?? 1);
  switch (m[2]) {
    case "year": return n * 12;
    case "month": return n;
    case "week": return n * 0.25;
    case "day": return n / 30;
    case "hour": return 0;
  }
  return null;
}

// Arabic-relative forms returned when language=ar:
//   "قبل سنة" / "قبل سنتين" / "قبل ٣ سنوات" / "قبل شهر" / "قبل أسبوع"
function parseArabicRelative(s: string): number | null {
  const t = s.trim();
  const arabicDigits: Record<string, string> = { "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9" };
  const normalized = t.replace(/[٠-٩]/g, (d) => arabicDigits[d] ?? d);
  if (!/قبل/.test(normalized)) return null;
  // Duals first (سنتين, شهرين, ...) — they don't carry a digit.
  if (/سنتين/.test(normalized)) return 24;
  if (/شهرين/.test(normalized)) return 2;
  if (/أسبوعين|اسبوعين/.test(normalized)) return 0.5;
  if (/يومين/.test(normalized)) return 2 / 30;
  // Singular without a digit ("قبل سنة", "قبل شهر") — \b doesn't work with
  // Arabic letters (word-boundary is a non-word transition, and \w doesn't
  // include Arabic), so we end-anchor with whitespace-or-EOS instead.
  if (/قبل\s+(سنة|سنه)(?:\s|$|[.,!؟])/.test(normalized)) return 12;
  if (/قبل\s+شهر(?:\s|$|[.,!؟])/.test(normalized)) return 1;
  if (/قبل\s+(أسبوع|اسبوع)(?:\s|$|[.,!؟])/.test(normalized)) return 0.25;
  if (/قبل\s+يوم(?:\s|$|[.,!؟])/.test(normalized)) return 1 / 30;
  // Digit-bearing form ("قبل 3 سنوات"). Tight match for `سنة|سنوات` so a stray
  // `سن` token alone doesn't accidentally read as "years".
  const m = normalized.match(/(\d+)\s*(سنة|سنوات|شهر|شهور|أشهر|اشهر|أسبوع|اسبوع|يوم|أيام|ايام)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (/سن/.test(m[2])) return n * 12;
    if (/شهر|أشهر|اشهر/.test(m[2])) return n;
    if (/أسبوع|اسبوع/.test(m[2])) return n * 0.25;
    if (/يوم|أيام|ايام/.test(m[2])) return n / 30;
  }
  return null;
}

function parseRelativeMonths(s: string): number | null {
  return parseArabicRelative(s) ?? parseEnglishRelative(s);
}

/** Months since the oldest review (a lower-bound place age). */
export function estimatePlaceAgeMonths(reviews: GoogleReviewSnippet[] | null | undefined): number | null {
  if (!reviews || reviews.length === 0) return null;
  let oldest: number | null = null;
  for (const r of reviews) {
    if (!r.relative_time) continue;
    const m = parseRelativeMonths(r.relative_time);
    if (m == null) continue;
    if (oldest == null || m > oldest) oldest = m;
  }
  return oldest;
}

/** Compact Arabic label like "منذ ٣ سنوات" / "منذ ٧ أشهر" / "جديد · شهرين". */
export function ageLabelAr(months: number | null): string | null {
  if (months == null) return null;
  if (months < 0.7) return "🆕 جديد · هذا الشهر";
  if (months < 6) return `🆕 جديد · منذ ${months < 2 ? "شهر" : `${Math.round(months)} أشهر`}`;
  // Avoid "منذ 12 أشهر" — rounding 11.5+ should jump straight to "سنة"
  if (Math.round(months) < 12) return `منذ ${Math.round(months)} أشهر`;
  const years = months / 12;
  if (years < 2) return "منذ سنة";
  if (years < 3) return "منذ سنتين";
  if (years < 10) return `منذ ${Math.round(years)} سنوات`;
  return `منذ +١٠ سنوات`;
}
