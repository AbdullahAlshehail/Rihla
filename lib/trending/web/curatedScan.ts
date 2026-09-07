// Curated web-trending scan — server-safe (no Brave, no WebSearch).
//
// Method (Fable-verified 2026-09-07): fetch 2-3 fixed credible London list
// pages → Groq extracts venue names from the prose → Google Text Search (New)
// confirms identity + gets a photo → Greater-London bounding-box guard +
// dedupe by place_id. Returns rows the caller upserts with trending_* fields.
//
// Accuracy is guarded by the Google confirm + London box + a per-run cap, so a
// stray LLM name can never reach the catalogue as trending. On any hard failure
// (fetch error / <MIN_VENUES extracted) the caller ABORTS and writes nothing —
// the 14-day display window then self-cleans. NEVER wipes existing rows.

const UA = "Mozilla/5.0 (compatible; RihlaBot/1.0; +https://rihla-travel.netlify.app)";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const PLACES_TEXT = "https://places.googleapis.com/v1/places:searchText";

// Fixed, credible, server-rendered London "new/hot restaurants" lists.
export const CURATED_SOURCES = [
  { url: "https://www.hot-dinners.com/Features/Hot-Dinners-recommends/hot-right-now-london-s-hottest-restaurants", label: "Hot Dinners" },
  { url: "https://www.timeout.com/london/restaurants/the-best-new-restaurants-in-london", label: "Time Out" },
];

export const MIN_VENUES = 3;         // <this from a source-set → abort, no write
export const MAX_GOOGLE_CALLS = 25;  // per-run cap → ~2% of the 5,000/mo free tier
export const TREND_SCORE = 62;       // curated baseline (display threshold is 50)

// Greater-London bounding box — identity guard against wrong-city matches.
function inLondon(lat: number | null, lng: number | null): boolean {
  return lat != null && lng != null && lat > 51.28 && lat < 51.72 && lng > -0.55 && lng < 0.34;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    return htmlToText(await r.text());
  } catch {
    return null;
  }
}

async function groqExtract(text: string, key: string): Promise<string[]> {
  const prompt =
    "From this London restaurant article, list ONLY the names of the NEW / trending / " +
    "recently-opened restaurants or venues it features. Return a STRICT JSON array of " +
    "venue names (strings), max 15, no commentary, no duplicates.\n\nARTICLE:\n" +
    text.slice(0, 12000);
  try {
    const r = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 400,
      }),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const out: string = d?.choices?.[0]?.message?.content ?? "";
    const m = out.match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : out);
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string").map((s) => s.trim()) : [];
  } catch {
    return [];
  }
}

export type CuratedVenue = {
  google_place_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number | null;
  photo_url: string | null;
  evidence_url: string;
};

async function googleVerify(name: string, key: string): Promise<Omit<CuratedVenue, "evidence_url"> | null> {
  try {
    const r = await fetch(PLACES_TEXT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.photos",
      },
      body: JSON.stringify({ textQuery: `${name} London`, regionCode: "GB", maxResultCount: 1 }),
    });
    if (!r.ok) return null;
    const p = ((await r.json()).places ?? [])[0];
    if (!p?.id) return null;
    const lat = p.location?.latitude ?? null;
    const lng = p.location?.longitude ?? null;
    if (!inLondon(lat, lng)) return null;
    const ref: string | undefined = p.photos?.[0]?.name;
    const photo_url = ref?.includes("/photos/")
      ? `/api/photo?ref=${ref.split("/photos/")[1]}&pid=${p.id}`
      : null;
    return {
      google_place_id: p.id,
      name: p.displayName?.text ?? name,
      lat, lng,
      rating: p.rating ?? null,
      review_count: p.userRatingCount ?? null,
      photo_url,
    };
  } catch {
    return null;
  }
}

export type CuratedScanResult = {
  venues: CuratedVenue[];
  extracted: number;
  googleCalls: number;
  warnings: string[];
};

/** Run the curated web-trending pipeline. Pure of DB — caller upserts. */
export async function curatedWebScan(env?: { groqKey?: string; googleKey?: string }): Promise<CuratedScanResult> {
  const groqKey = env?.groqKey ?? process.env.GROQ_API_KEY;
  const googleKey = env?.googleKey ?? process.env.GOOGLE_MAPS_API_KEY;
  const warnings: string[] = [];
  if (!groqKey || !googleKey) {
    return { venues: [], extracted: 0, googleCalls: 0, warnings: ["missing_keys"] };
  }

  // 1) fetch + extract per source; a source maps to its own evidence URL.
  const nameToEvidence = new Map<string, string>();
  for (const src of CURATED_SOURCES) {
    const text = await fetchText(src.url);
    if (!text) { warnings.push(`fetch_failed:${src.label}`); continue; }
    const names = await groqExtract(text, groqKey);
    if (names.length === 0) warnings.push(`no_extract:${src.label}`);
    for (const n of names) if (n && !nameToEvidence.has(n.toLowerCase())) nameToEvidence.set(n.toLowerCase(), src.url);
  }
  const extracted = nameToEvidence.size;
  // ABORT guard — never write on a thin/failed harvest; let the 14-day window self-clean.
  if (extracted < MIN_VENUES) {
    warnings.push(`abort_below_min:${extracted}`);
    return { venues: [], extracted, googleCalls: 0, warnings };
  }

  // 2) Google verify + London guard + dedupe by place_id (capped).
  const seen = new Set<string>();
  const venues: CuratedVenue[] = [];
  let googleCalls = 0;
  for (const [nameLc, evidence] of nameToEvidence) {
    if (googleCalls >= MAX_GOOGLE_CALLS) break;
    googleCalls++;
    const v = await googleVerify(nameLc, googleKey);
    if (!v || seen.has(v.google_place_id)) continue;
    seen.add(v.google_place_id);
    venues.push({ ...v, evidence_url: evidence });
  }
  return { venues, extracted, googleCalls, warnings };
}
