// Stage 1 — candidate discovery queries (Brave only, near-zero cost).
//
// The full pool is NOT run every time: queries ROTATE deterministically by
// day so consecutive runs cover different slices (base phrasings, site:
// filters, districts) while staying ≤ MAX_BRAVE_QUERIES per run.

export const MAX_BRAVE_QUERIES = 8;

/** Riyadh-cafe query pool — owner's exact phrasings (AR + EN). */
export const BASE_QUERIES_RIYADH_CAFES = [
  "كافيه جديد الرياض",
  "مقهى جديد الرياض",
  "افتتاح كافيه الرياض",
  "جربنا كافيه الرياض",
  "ترند كافيهات الرياض",
  "كافيه يستاهل التجربة الرياض",
  "جديد مطاعم وكافيهات الرياض",
  "viral cafe Riyadh",
  "trending cafe Riyadh",
  "new cafe Riyadh",
  "Riyadh cafe opening",
  "TikTok Riyadh cafe",
  "Instagram Riyadh cafe",
] as const;

export const RIYADH_DISTRICTS = [
  "حطين", "الياسمين", "النرجس", "الملقا", "العليا",
  "الدرعية", "السفارات", "واجهة الرياض", "كافد", "قرطبة",
] as const;

/** site: filters — platforms whose direct posts are the strongest evidence. */
export const SITE_FILTERS = [
  "site:tiktok.com", "site:instagram.com", "site:youtube.com",
  "site:youtu.be", "site:x.com",
] as const;

function pickRotating<T>(pool: readonly T[], count: number, offset: number): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    out.push(pool[(offset + i) % pool.length]);
  }
  return out;
}

/**
 * Deterministic rotation seeded by UTC day: 5 base queries + 2 site-filtered
 * + 1 district query = 8. Same day → same set (works with the 12h Brave
 * cache); next day → the window slides.
 */
export function rotateQueries(now: Date, opts?: { cityLabel?: string }): string[] {
  const day = Math.floor(now.getTime() / 86_400_000);
  const base = pickRotating(BASE_QUERIES_RIYADH_CAFES, 5, day * 5);
  const sites = pickRotating(SITE_FILTERS, 2, day * 2);
  const district = RIYADH_DISTRICTS[day % RIYADH_DISTRICTS.length];

  const queries = [
    ...base,
    `${sites[0]} كافيه الرياض`,
    `${sites[1]} cafe Riyadh`,
    `كافيه ${district} الرياض`,
  ];
  // Non-Riyadh callers get generic phrasings (same rotation mechanics).
  if (opts?.cityLabel && !/riyadh|الرياض/i.test(opts.cityLabel)) {
    const c = opts.cityLabel;
    return [
      `new cafe ${c}`, `viral cafe ${c}`, `trending cafe ${c}`,
      `كافيه جديد ${c}`, `افتتاح كافيه ${c}`,
      `${sites[0]} cafe ${c}`, `${sites[1]} cafe ${c}`,
      `tiktok cafe ${c}`,
    ].slice(0, MAX_BRAVE_QUERIES);
  }
  return queries.slice(0, MAX_BRAVE_QUERIES);
}
