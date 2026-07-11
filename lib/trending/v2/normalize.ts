// Stage 3 — name normalization + AR/EN near-matching. Pure, deterministic.
//
// Goals (owner spec):
//   • strip diacritics, unify alef/hamza/ta-marbuta/ya variants
//   • strip symbols/punctuation
//   • drop filler words (كافيه/مقهى/الرياض/فرع + EN equivalents)
//   • lowercase EN
//   • match Arabic vs English spellings via approximate transliteration
//     («نوار» ↔ "Noir") without collapsing genuinely different venues.

const AR_DIACRITICS = /[ً-ْٰـ]/g; // tashkeel + tatweel

/** Words that say "this is a cafe in Riyadh" — carry zero identity. */
const DROP_WORDS = new Set([
  // Arabic (post-normalization forms — ة→ه, أ→ا already applied)
  "كافيه", "كافيهات", "مقهي", "مقهى", "كوفي", "قهوه", "محمصه",
  "الرياض", "رياض", "فرع", "حي", "منطقه",
  // English
  "cafe", "cafes", "caffe", "coffee", "coffeehouse", "roastery", "roasters",
  "specialty", "speciality", "riyadh", "branch", "the", "co",
]);

/** Normalize a venue name to its dedup key. */
export function normalizeName(raw: string): string {
  let s = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")   // latin diacritics (é → e, ï → i)
    .normalize("NFKC")
    .toLowerCase()
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ء/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")  // punctuation/symbols → space
    .replace(/\s+/g, " ")
    .trim();

  const tokens = s
    .split(" ")
    .map((t) => (/^ال./.test(t) && t.length >= 5 ? t.slice(2) : t)) // drop leading ال
    .filter((t) => t.length > 0 && !DROP_WORDS.has(t));

  s = tokens.join(" ").trim();
  return s;
}

// ── Approximate AR→Latin transliteration ─────────────────────────────────
// Coarse on purpose: we only need "نوار" to land near "noir", not a perfect
// romanization. Multi-char sounds first.

const TRANSLIT: Array<[RegExp, string]> = [
  [/ث/g, "th"], [/خ/g, "kh"], [/ذ/g, "th"], [/ش/g, "sh"], [/غ/g, "gh"],
  [/ا/g, "a"], [/ب/g, "b"], [/ت/g, "t"], [/ج/g, "j"], [/ح/g, "h"],
  [/د/g, "d"], [/ر/g, "r"], [/ز/g, "z"], [/س/g, "s"], [/ص/g, "s"],
  [/ض/g, "d"], [/ط/g, "t"], [/ظ/g, "z"], [/ع/g, "a"], [/ف/g, "f"],
  [/ق/g, "q"], [/ك/g, "k"], [/ل/g, "l"], [/م/g, "m"], [/ن/g, "n"],
  [/ه/g, "h"], [/و/g, "o"], [/ي/g, "i"],
];

/** Transliterate an already-normalized Arabic string to a Latin skeleton. */
export function transliterateAr(normalized: string): string {
  let s = normalized;
  for (const [re, to] of TRANSLIT) s = s.replace(re, to);
  return s;
}

function hasArabic(s: string): boolean {
  return /[؀-ۿ]/.test(s);
}

/** Latin comparison form: AR gets transliterated, EN stays as-is. */
export function latinForm(normalized: string): string {
  return hasArabic(normalized) ? transliterateAr(normalized) : normalized;
}

// ── Similarity ───────────────────────────────────────────────────────────

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity on the two strings (1 = identical). */
export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

const SIM_THRESHOLD = 0.72;

/**
 * Same-venue test across normalized names, handling AR↔EN transliteration.
 * Conservative: exact match, containment (≥5 chars), or high transliterated
 * similarity on names of ≥4 chars.
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 5 && longer.includes(shorter)) return true;
  const la = latinForm(a).replace(/\s+/g, "");
  const lb = latinForm(b).replace(/\s+/g, "");
  if (la === lb && la.length >= 3) return true;
  if (la.length >= 4 && lb.length >= 4 && similarity(la, lb) >= SIM_THRESHOLD) return true;
  return false;
}

/** Token-overlap similarity (0..1) — used to verify a Google resolve. */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}
