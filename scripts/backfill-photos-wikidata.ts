// ─────────────────────────────────────────────────────────────────────────────
// Backfill photo_url for places missing one, using free Wikidata + Wikipedia.
//
// Strategy (in order, free + no API key):
//   1) Wikidata wbsearchentities  → wbgetentities (look for P18 image claim,
//      and verify proximity via P625 coordinates when lat/lng exist on place).
//   2) Wikipedia REST query with prop=pageimages&piprop=original (en, then fr
//      for Riviera, then ar for Riyadh).
//   3) Wikimedia Commons category search as a generic-but-relevant fallback
//      (tagged `generic_photo`).
//
// All final URLs are forced through https://upload.wikimedia.org/wikipedia/...
// to satisfy the existing CSP (`img-src` already whitelists that host).
//
// Run:
//   npx tsx scripts/backfill-photos-wikidata.ts
//   npx tsx scripts/backfill-photos-wikidata.ts --dry-run
//   npx tsx scripts/backfill-photos-wikidata.ts --limit 50
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── CLI flags ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const limitFlagIdx = argv.indexOf("--limit");
const LIMIT_OVERRIDE =
  limitFlagIdx >= 0 ? Number.parseInt(argv[limitFlagIdx + 1] ?? "", 10) : null;
const HARD_LIMIT = Number.isFinite(LIMIT_OVERRIDE!) && LIMIT_OVERRIDE! > 0
  ? LIMIT_OVERRIDE!
  : 2000;

const TARGET_CITIES = ["nice", "cannes", "monaco", "riyadh"] as const;
const TARGET_CITY_LABELS = ["نيس", "كان", "موناكو", "الرياض"] as const;

// Rate-limit windows (ms between requests, per host).
const WIKIDATA_DELAY_MS = 1100;   // ~1 rps
const WIKIPEDIA_DELAY_MS = 550;   // ~2 rps
const COMMONS_DELAY_MS = 1100;    // ~1 rps
const PROXIMITY_KM = 25;          // Wikidata P625 must be within X km of place

const USER_AGENT =
  "rihla-app/1.0 (https://github.com/rihla; abdullah.alshehail@gmail.com) tsx-backfill-photos";

// ── Types ────────────────────────────────────────────────────────────────────
type PlaceRow = {
  id: string;
  name: string;
  city: string;
  city_label: string | null;
  lat: number | null;
  lng: number | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  tags: string[] | null;
};

type ResolveResult = {
  url: string;
  source: "wikidata" | "wikipedia-en" | "wikipedia-fr" | "wikipedia-ar" | "commons-generic";
  generic: boolean;
};

// ── Small helpers ────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stripArabic(s: string): string {
  // Drop the Arabic half of "English · العربية" / "العربية · English" names.
  const parts = s.split("·").map((p) => p.trim()).filter(Boolean);
  const englishish = parts.find((p) => /[A-Za-z]/.test(p) && !/^[؀-ۿ\s]+$/.test(p));
  return (englishish ?? s).replace(/[؀-ۿ]+/g, "").replace(/\s+/g, " ").trim();
}

function arabicOnly(s: string): string | null {
  const parts = s.split("·").map((p) => p.trim()).filter(Boolean);
  const ar = parts.find((p) => /[؀-ۿ]/.test(p));
  return ar ?? null;
}

function cityHumanEn(city: string): string {
  switch (city) {
    case "nice": return "Nice";
    case "cannes": return "Cannes";
    case "monaco": return "Monaco";
    case "riyadh": return "Riyadh";
    default: return city;
  }
}

function cityHumanFr(city: string): string {
  switch (city) {
    case "nice": return "Nice";
    case "cannes": return "Cannes";
    case "monaco": return "Monaco";
    case "riyadh": return "Riyad";
    default: return city;
  }
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function fetchJson<T = unknown>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function headOk(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
    return r.ok;
  } catch {
    return false;
  }
}

// Convert a Commons "File:Foo bar.jpg" title (or already-stripped filename)
// to the canonical upload.wikimedia.org URL via the redirect-friendly
// Special:FilePath endpoint, which honours our CSP whitelist.
function commonsFileToUrl(rawTitle: string, width = 1200): string {
  const fname = rawTitle.replace(/^File:/i, "").replace(/\s+/g, "_");
  const enc = encodeURIComponent(fname);
  // Special:FilePath redirects to upload.wikimedia.org/wikipedia/commons/...
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${enc}?width=${width}`;
}

// Wikipedia/PageImages typically returns a thumbnail URL already on
// upload.wikimedia.org — pass through unchanged.
function isUploadHost(url: string): boolean {
  return /^https?:\/\/upload\.wikimedia\.org\//i.test(url);
}

// ── Wikidata pipeline ────────────────────────────────────────────────────────
type WbSearch = {
  search?: { id: string; label?: string; description?: string }[];
};

type WbEntity = {
  entities?: Record<
    string,
    {
      claims?: Record<string, { mainsnak?: { datavalue?: { value: unknown } } }[]>;
    }
  >;
};

async function wikidataSearchIds(query: string): Promise<string[]> {
  const u = new URL("https://www.wikidata.org/w/api.php");
  u.searchParams.set("action", "wbsearchentities");
  u.searchParams.set("search", query);
  u.searchParams.set("language", "en");
  u.searchParams.set("type", "item");
  u.searchParams.set("limit", "3");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  const data = await fetchJson<WbSearch>(u.toString());
  return (data?.search ?? []).map((s) => s.id).filter(Boolean);
}

async function wikidataPickEntityWithImage(
  ids: string[],
  ref: { lat: number; lng: number } | null,
): Promise<string | null> {
  if (ids.length === 0) return null;
  const u = new URL("https://www.wikidata.org/w/api.php");
  u.searchParams.set("action", "wbgetentities");
  u.searchParams.set("ids", ids.join("|"));
  u.searchParams.set("props", "claims");
  u.searchParams.set("languages", "en");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  const data = await fetchJson<WbEntity>(u.toString());
  if (!data?.entities) return null;

  // Preserve search rank — iterate ids in order.
  for (const id of ids) {
    const ent = data.entities[id];
    if (!ent?.claims) continue;

    // Proximity gate (if we have ref coords AND entity has coords).
    if (ref) {
      const coordSnak = ent.claims["P625"]?.[0]?.mainsnak?.datavalue?.value as
        | { latitude?: number; longitude?: number }
        | undefined;
      if (
        coordSnak?.latitude != null &&
        coordSnak?.longitude != null &&
        Number.isFinite(coordSnak.latitude) &&
        Number.isFinite(coordSnak.longitude)
      ) {
        const d = haversineKm(ref, { lat: coordSnak.latitude, lng: coordSnak.longitude });
        if (d > PROXIMITY_KM) continue;
      }
      // Note: if entity has no P625 we don't filter it out — many businesses lack coords.
    }

    const img = ent.claims["P18"]?.[0]?.mainsnak?.datavalue?.value;
    if (typeof img === "string" && img.trim().length > 0) {
      return img.trim();
    }
  }
  return null;
}

async function resolveViaWikidata(
  name: string,
  ref: { lat: number; lng: number } | null,
): Promise<string | null> {
  const ids = await wikidataSearchIds(name);
  await sleep(WIKIDATA_DELAY_MS);
  if (ids.length === 0) return null;
  const file = await wikidataPickEntityWithImage(ids, ref);
  await sleep(WIKIDATA_DELAY_MS);
  return file;
}

// ── Wikipedia pipeline ───────────────────────────────────────────────────────
type WikiQuery = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        original?: { source?: string };
        thumbnail?: { source?: string };
      }
    >;
  };
};

async function wikipediaPageImage(lang: "en" | "fr" | "ar", title: string): Promise<string | null> {
  // generator=search lets us search and fetch pageimages in one call.
  const u = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  u.searchParams.set("action", "query");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", title);
  u.searchParams.set("gsrlimit", "3");
  u.searchParams.set("prop", "pageimages");
  u.searchParams.set("piprop", "original|thumbnail");
  u.searchParams.set("pithumbsize", "1200");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  const data = await fetchJson<WikiQuery>(u.toString());
  const pages = data?.query?.pages;
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const src = page.original?.source ?? page.thumbnail?.source;
    if (src && isUploadHost(src)) return src;
  }
  return null;
}

// ── Commons generic-category fallback ────────────────────────────────────────
type CommonsSearch = {
  query?: { search?: { title: string }[] };
};

async function commonsCategoryImage(category: string): Promise<string | null> {
  // Search Commons for a representative image under a category.
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("list", "search");
  u.searchParams.set("srsearch", `${category} filetype:bitmap`);
  u.searchParams.set("srnamespace", "6"); // File:
  u.searchParams.set("srlimit", "5");
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  const data = await fetchJson<CommonsSearch>(u.toString());
  const first = data?.query?.search?.[0]?.title;
  return first ?? null;
}

function genericCategoryFor(place: PlaceRow): string {
  const cityEn = cityHumanEn(place.city);
  // Try to nudge toward a meaningful Commons category.
  const lowered = place.name.toLowerCase();
  if (/coffee|café|cafe|brew|roaster|espresso/.test(lowered)) return `coffee shop ${cityEn}`;
  if (/restaurant|bistro|bistrot|grill|kitchen|steak/.test(lowered)) return `restaurant ${cityEn}`;
  if (/beach|plage|shore/.test(lowered)) return `beach ${cityEn}`;
  if (/museum|musée|متحف/.test(lowered)) return `museum ${cityEn}`;
  if (/palace|قصر|palais/.test(lowered)) return `palace ${cityEn}`;
  if (/garden|jardin|park|حديقة/.test(lowered)) return `garden ${cityEn}`;
  if (/casino/.test(lowered)) return `casino ${cityEn}`;
  return cityEn;
}

// ── Top-level per-place resolver ────────────────────────────────────────────
async function resolvePlace(place: PlaceRow): Promise<ResolveResult | null> {
  const ref =
    place.lat != null && place.lng != null
      ? { lat: place.lat, lng: place.lng }
      : null;

  const englishName = stripArabic(place.name) || place.name;
  const cityEn = cityHumanEn(place.city);
  const cityFr = cityHumanFr(place.city);
  const arName = arabicOnly(place.name);

  // 1) Wikidata — try "Name City" first, then bare name.
  for (const q of [`${englishName} ${cityEn}`, englishName]) {
    const file = await resolveViaWikidata(q, ref);
    if (file) {
      const url = commonsFileToUrl(file);
      if (await headOk(url)) return { url, source: "wikidata", generic: false };
    }
  }

  // 2) Wikipedia EN → FR → AR.
  const enTitle = `${englishName} ${cityEn}`;
  const enImg = await wikipediaPageImage("en", enTitle);
  await sleep(WIKIPEDIA_DELAY_MS);
  if (enImg && (await headOk(enImg))) return { url: enImg, source: "wikipedia-en", generic: false };

  // For Riviera places, try French Wikipedia.
  if (place.city !== "riyadh") {
    const frImg = await wikipediaPageImage("fr", `${englishName} ${cityFr}`);
    await sleep(WIKIPEDIA_DELAY_MS);
    if (frImg && (await headOk(frImg))) return { url: frImg, source: "wikipedia-fr", generic: false };
  }

  // For Riyadh places, try Arabic Wikipedia using the Arabic half of the name.
  if (place.city === "riyadh" && arName) {
    const arImg = await wikipediaPageImage("ar", `${arName} الرياض`);
    await sleep(WIKIPEDIA_DELAY_MS);
    if (arImg && (await headOk(arImg))) return { url: arImg, source: "wikipedia-ar", generic: false };
  }

  // 3) Commons generic category — always upload.wikimedia.org, always free.
  const cat = genericCategoryFor(place);
  const fileTitle = await commonsCategoryImage(cat);
  await sleep(COMMONS_DELAY_MS);
  if (fileTitle) {
    const url = commonsFileToUrl(fileTitle);
    if (await headOk(url)) return { url, source: "commons-generic", generic: true };
  }

  return null;
}

// ── DB + main loop ───────────────────────────────────────────────────────────
async function fetchTargetPlaces(): Promise<PlaceRow[]> {
  // We want: photo_url IS NULL/empty AND ( city IN (...) OR city_label IN (...) )
  // The Supabase JS client expresses the OR via .or(); empty photo_url handled
  // by `or("photo_url.is.null,photo_url.eq.")`.
  const cityFilter = `city.in.(${TARGET_CITIES.join(",")})`;
  const labelFilter = `city_label.in.(${TARGET_CITY_LABELS.map((l) => `"${l}"`).join(",")})`;

  const { data, error } = await supabase
    .from("places")
    .select("id,name,city,city_label,lat,lng,photo_url,photo_urls,tags")
    .or("photo_url.is.null,photo_url.eq.")
    .or(`${cityFilter},${labelFilter}`)
    .limit(HARD_LIMIT);

  if (error) {
    console.error("✗ Supabase select failed:", error.message);
    process.exit(1);
  }
  return (data ?? []) as PlaceRow[];
}

async function updatePlace(
  place: PlaceRow,
  result: ResolveResult,
): Promise<{ ok: boolean; err?: string }> {
  if (DRY_RUN) return { ok: true };

  const nextPhotoUrls =
    place.photo_urls && place.photo_urls.length > 0 ? place.photo_urls : [result.url];

  const nextTags = (() => {
    if (!result.generic) return undefined; // leave tags alone
    const existing = place.tags ?? [];
    return existing.includes("generic_photo") ? existing : [...existing, "generic_photo"];
  })();

  const patch: Record<string, unknown> = {
    photo_url: result.url,
    photo_urls: nextPhotoUrls,
  };
  if (nextTags) patch.tags = nextTags;

  const { error } = await supabase.from("places").update(patch).eq("id", place.id);
  if (error) return { ok: false, err: error.message };
  return { ok: true };
}

async function main() {
  console.log(
    `→ Backfilling photos for places in ${TARGET_CITIES.join("/")} ` +
      `(dry-run=${DRY_RUN}, limit=${HARD_LIMIT})`,
  );

  const places = await fetchTargetPlaces();
  console.log(`→ ${places.length} candidate places without photo_url\n`);

  let matched = 0;
  let generic = 0;
  let failed = 0;
  let dbFail = 0;

  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    const tag = `[${i + 1}/${places.length}]`;
    try {
      const result = await resolvePlace(p);
      if (!result) {
        failed++;
        console.log(`${tag} ✗ ${p.name} → no match`);
        continue;
      }
      const upd = await updatePlace(p, result);
      if (!upd.ok) {
        dbFail++;
        console.log(`${tag} ! ${p.name} → DB error: ${upd.err}`);
        continue;
      }
      if (result.generic) generic++;
      else matched++;
      console.log(`${tag} ✓ ${p.name} → ${result.source}${result.generic ? " (generic)" : ""}`);
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${tag} ! ${p.name} → exception: ${msg}`);
    }
  }

  console.log("\n──────────── Summary ────────────");
  console.log(`  matched (specific): ${matched}`);
  console.log(`  generic fallback : ${generic}`);
  console.log(`  failed           : ${failed}`);
  if (dbFail > 0) console.log(`  DB write errors  : ${dbFail}`);
  console.log(`  total scanned    : ${places.length}`);
  if (DRY_RUN) console.log("  (dry-run — no DB writes)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
