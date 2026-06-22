// Shared formatters and small helpers (ported from the original HTML).

export const DAYS_AR = ["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
export const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

export const SLOT_LABEL: Record<string, string> = {
  morning: "☕ صباح · ٧–١١",
  midday: "🍽️ غداء · ١٢–١٥",
  afternoon: "🏛 بعد الظهر · ١٥–١٨",
  evening: "🍷 عشاء · ١٩–٢٢",
  night: "🥂 سهرة · ٢٢+",
};

export const SLOT_SHORT: Record<string, string> = {
  morning: "صباح",
  midday: "غداء",
  afternoon: "بعد الظهر",
  evening: "عشاء",
  night: "سهرة",
};

export const SLOT_ORDER = ["morning", "midday", "afternoon", "evening", "night"] as const;

export function fmtMoneySAR(sar: number): string {
  return `${Math.round(sar || 0).toLocaleString("en")} ر.س`;
}

export function fmtMins(m: number): string {
  if (m < 60) return `${m}د`;
  const h = Math.floor(m / 60);
  const mn = m % 60;
  return mn ? `${h}س ${mn}د` : `${h}س`;
}

export function fmtKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}م` : `${km.toFixed(1)}كم`;
}

export function fmtDayLong(iso: string): string {
  const d = parseISO(iso);
  if (!d) return iso;
  return `${DAYS_AR[d.getDay()]} ${d.getDate()} ${MONTHS_AR[d.getMonth()]}`;
}

export function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function fmtISO(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// ─── Geo + travel (calibrated against Google Maps for typical city routes) ──
const EARTH_R = 6371; // km

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const t = (x: number) => (x * Math.PI) / 180;
  const dy = t(b.lat - a.lat);
  const dx = t(b.lng - a.lng);
  const q =
    Math.sin(dy / 2) ** 2 +
    Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dx / 2) ** 2;
  return EARTH_R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

// Local estimate when Google Routes isn't available yet.
// USE THIS AS A FALLBACK ONLY — show "تقديري" badge in UI when used.
//
// Speeds biased toward over-estimation: a user arriving early is fine, a user
// arriving late after we promised 12 minutes is angry. Urban speeds were
// re-calibrated against Riyadh/Nice/Cannes congestion (2026-06 review).
export function estimateTravelTimes(km: number): {
  walkMin: number;
  driveMin: number;
  source: "estimate" | "google";
} {
  const walkMin = Math.max(1, Math.round(km * 1.2 * 12)); // 5 km/h, road factor 1.2
  let speed: number, factor: number;
  if (km < 2)       { speed = 16; factor = 1.4; }   // very short = stops dominate
  else if (km < 6)  { speed = 22; factor = 1.35; }  // dense city
  else if (km < 15) { speed = 25; factor = 1.3; }   // city sprawl — was 38 (over-optimistic)
  else if (km < 35) { speed = 50; factor = 1.3; }   // ring road / suburb
  else              { speed = 75; factor = 1.25; }  // open highway
  const driveMin = Math.max(2, Math.round(((km * factor) / speed) * 60));
  return { walkMin, driveMin, source: "estimate" };
}

// ─── Opening hours helper ────────────────────────────────────────────────
export function parseIntervals(s: string | null | undefined): Array<[number, number]> | null {
  if (s == null) return null;
  if (s === "") return [];
  const out: Array<[number, number]> = [];
  for (const p of s.split(",")) {
    const sd = p.split(/[-–]/);
    if (sd.length < 2) continue;
    const b = parseTime(sd[1]);
    if (!b) continue;
    const a = parseTime(sd[0], b.mer);
    if (!a) continue;
    let st = a.min, en = b.min;
    if (en === 0) en = 1440;
    if (en <= st) en += 1440;
    out.push([st, en]);
  }
  return out;
}

function parseTime(str: string, inherit?: "AM" | "PM" | null) {
  const m = str.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let h = +m[1];
  const mn = m[2] ? +m[2] : 0;
  const mer = (m[3] ? m[3].toUpperCase() : inherit || null) as "AM" | "PM" | null;
  if (mer === "PM" && h < 12) h += 12;
  if (mer === "AM" && h === 12) h = 0;
  return { min: h * 60 + mn, mer };
}

export function isOpenNow(opening_hours: string[] | null, now = new Date()): {
  kind: "open" | "shut" | "free";
  closeAt?: number;
} {
  if (!opening_hours || opening_hours.length === 0) return { kind: "free" };
  const d = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  const todays = parseIntervals(opening_hours[d]) || [];
  for (const [s, e] of todays) {
    if (mins >= s && mins < e) return { kind: "open", closeAt: e % 1440 };
  }
  // check carry-over from yesterday past midnight
  const ydy = parseIntervals(opening_hours[(d + 6) % 7]) || [];
  for (const [s, e] of ydy) {
    if (e > 1440 && mins + 1440 >= s && mins + 1440 < e) {
      return { kind: "open", closeAt: e % 1440 };
    }
  }
  return { kind: "shut" };
}

export function fmtMinOfDay(m: number): string {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mn = m % 60;
  const ap = h < 12 ? "ص" : "م";
  const hh = h % 12 || 12;
  return mn === 0 ? `${hh}${ap}` : `${hh}:${String(mn).padStart(2, "0")}${ap}`;
}

// ─── Rich open-status formatting for UI cards ───
// Returns { isOpen, label, todayHours } e.g.,
//   { isOpen: true,  label: "🟢 مفتوح للساعة ١٢م", todayHours: "٧ص–١٢م" }
//   { isOpen: false, label: "🔴 مغلق · يفتح ٧ص",   todayHours: "٧ص–١٢م" }
//   { isOpen: false, label: "🔴 مغلق اليوم",         todayHours: "مغلق" }
export function formatOpenStatus(
  opening_hours: string[] | null,
  now = new Date()
): { isOpen: boolean; label: string; todayHours: string; freeform: boolean } {
  // null/undefined OR empty array = we don't know hours. Treating it as "open
  // always" was misleading for places where Google simply hasn't returned hours
  // yet. Mark it as "freeform" (UI can show "ساعات غير معروفة") and DON'T claim
  // open. The decision engine should fall back to category time-of-day fit.
  if (!opening_hours || opening_hours.length === 0) {
    return { isOpen: false, label: "ساعات غير معروفة", todayHours: "", freeform: true };
  }
  const dow = now.getDay();
  const todayRaw = opening_hours[dow] ?? "";
  const todays = parseIntervals(todayRaw) ?? [];

  if (todays.length === 0) {
    return { isOpen: false, label: "🔴 مغلق اليوم", todayHours: "مغلق", freeform: false };
  }

  const mins = now.getHours() * 60 + now.getMinutes();
  const hoursLabel = todays
    .map(([s, e]) => `${fmtMinOfDay(s)}–${fmtMinOfDay(e === 1440 ? 0 : e)}`)
    .join("، ");

  // Currently inside one of today's windows?
  for (const [s, e] of todays) {
    if (mins >= s && mins < e) {
      return {
        isOpen: true,
        label: `🟢 مفتوح للساعة ${fmtMinOfDay(e === 1440 ? 0 : e)}`,
        todayHours: hoursLabel,
        freeform: false,
      };
    }
  }
  // Carry-over from yesterday past midnight
  const ydy = parseIntervals(opening_hours[(dow + 6) % 7]) ?? [];
  for (const [s, e] of ydy) {
    if (e > 1440 && mins + 1440 >= s && mins + 1440 < e) {
      return {
        isOpen: true,
        label: `🟢 مفتوح للساعة ${fmtMinOfDay(e % 1440)}`,
        todayHours: hoursLabel,
        freeform: false,
      };
    }
  }
  // Closed now — when does it open today?
  const next = todays.find(([s]) => s > mins);
  if (next) {
    return {
      isOpen: false,
      label: `🔴 مغلق · يفتح ${fmtMinOfDay(next[0])}`,
      todayHours: hoursLabel,
      freeform: false,
    };
  }
  // Past last window today — find next open day
  for (let i = 1; i <= 7; i++) {
    const di = (dow + i) % 7;
    if (parseIntervals(opening_hours[di])?.length) {
      const dayName = DAYS_AR[di];
      return {
        isOpen: false,
        label: `🔴 مغلق · يفتح ${dayName}`,
        todayHours: hoursLabel,
        freeform: false,
      };
    }
  }
  return { isOpen: false, label: "🔴 مغلق", todayHours: hoursLabel, freeform: false };
}

/** Best Google Maps directions URL for a place. Avoids stale place_id pitfalls
 *  by preferring name+coords search (always resolves correctly). */
export function buildDirectionsUrl(p: {
  name: string;
  lat: number | null;
  lng: number | null;
  city_label?: string | null;
  google_place_id?: string | null;
  google_maps_url?: string | null;
}): string {
  // 1) Canonical URL from enrichment is always best (Google built it)
  if (p.google_maps_url && p.google_maps_url.includes("google.com/maps")) {
    return p.google_maps_url;
  }
  // 2) Coords-based destination is most reliable post-seed; place_id is only
  //    appended when we actually have one (no empty placeholder regex hack).
  const labelParts = [p.name, p.city_label].filter(Boolean).join(", ");
  if (p.lat != null && p.lng != null) {
    let url = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
    if (p.google_place_id) {
      url += `&destination_place_id=${encodeURIComponent(p.google_place_id)}`;
    }
    return url;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(labelParts)}`;
}

// City-key (lowercase) → ISO-3166-1 alpha-2 country code.
// Covers every city we seed; everything else returns undefined and the
// search box widens to global until the user picks a country manually.
const CITY_TO_COUNTRY: Record<string, string> = {
  london: "gb",
  paris: "fr", nice: "fr", cannes: "fr", antibes: "fr",
  eze: "fr", villefranche: "fr", menton: "fr",
  capferrat: "fr", capdail: "fr", stpaul: "fr",
  monaco: "mc",
  riyadh: "sa", jeddah: "sa", dammam: "sa", khobar: "sa", makkah: "sa",
  dubai: "ae", "abu dhabi": "ae", abudhabi: "ae",
  istanbul: "tr", trabzon: "tr", bodrum: "tr", antalya: "tr",
  rome: "it", milan: "it", florence: "it", venice: "it",
  barcelona: "es", madrid: "es",
  amsterdam: "nl",
  berlin: "de", munich: "de",
  vienna: "at",
  prague: "cz",
  tokyo: "jp", kyoto: "jp", osaka: "jp",
  "kuala lumpur": "my", kualalumpur: "my",
  singapore: "sg",
  "new york": "us", newyork: "us", "los angeles": "us", losangeles: "us",
};

export function countryFromCity(city?: string | null): string | undefined {
  if (!city) return undefined;
  const k = city.toLowerCase().trim();
  return CITY_TO_COUNTRY[k];
}

// Display labels for the country picker — used by the search-and-add UI.
export const COUNTRY_OPTIONS: Array<{ code: string; ar: string; flag: string }> = [
  { code: "sa", ar: "السعودية", flag: "🇸🇦" },
  { code: "ae", ar: "الإمارات", flag: "🇦🇪" },
  { code: "gb", ar: "المملكة المتحدة", flag: "🇬🇧" },
  { code: "fr", ar: "فرنسا", flag: "🇫🇷" },
  { code: "mc", ar: "موناكو", flag: "🇲🇨" },
  { code: "it", ar: "إيطاليا", flag: "🇮🇹" },
  { code: "es", ar: "إسبانيا", flag: "🇪🇸" },
  { code: "tr", ar: "تركيا", flag: "🇹🇷" },
  { code: "nl", ar: "هولندا", flag: "🇳🇱" },
  { code: "de", ar: "ألمانيا", flag: "🇩🇪" },
  { code: "at", ar: "النمسا", flag: "🇦🇹" },
  { code: "cz", ar: "تشيكيا", flag: "🇨🇿" },
  { code: "jp", ar: "اليابان", flag: "🇯🇵" },
  { code: "my", ar: "ماليزيا", flag: "🇲🇾" },
  { code: "sg", ar: "سنغافورة", flag: "🇸🇬" },
  { code: "us", ar: "أمريكا", flag: "🇺🇸" },
];

// City picker — narrows Google search to a single city radius (strict bounds).
// `radiusKm` is half the longest dimension; pick generously to catch suburbs.
export type CityOption = {
  key: string; ar: string; flag: string;
  country: string;
  lat: number; lng: number;
  radiusKm: number;
};

export const CITY_OPTIONS: CityOption[] = [
  // السعودية
  { key: "riyadh", ar: "الرياض", flag: "🇸🇦", country: "sa", lat: 24.7136, lng: 46.6753, radiusKm: 40 },
  { key: "jeddah", ar: "جدة", flag: "🇸🇦", country: "sa", lat: 21.4858, lng: 39.1925, radiusKm: 30 },
  { key: "dammam", ar: "الدمام/الخبر", flag: "🇸🇦", country: "sa", lat: 26.4207, lng: 50.0888, radiusKm: 25 },
  { key: "makkah", ar: "مكة", flag: "🇸🇦", country: "sa", lat: 21.4225, lng: 39.8262, radiusKm: 20 },
  { key: "madinah", ar: "المدينة", flag: "🇸🇦", country: "sa", lat: 24.5247, lng: 39.5692, radiusKm: 20 },
  { key: "abha", ar: "أبها", flag: "🇸🇦", country: "sa", lat: 18.2164, lng: 42.5053, radiusKm: 25 },
  // الخليج
  { key: "dubai", ar: "دبي", flag: "🇦🇪", country: "ae", lat: 25.2048, lng: 55.2708, radiusKm: 35 },
  { key: "abudhabi", ar: "أبوظبي", flag: "🇦🇪", country: "ae", lat: 24.4539, lng: 54.3773, radiusKm: 30 },
  { key: "doha", ar: "الدوحة", flag: "🇶🇦", country: "qa", lat: 25.2854, lng: 51.5310, radiusKm: 25 },
  { key: "kuwait", ar: "الكويت", flag: "🇰🇼", country: "kw", lat: 29.3759, lng: 47.9774, radiusKm: 25 },
  { key: "manama", ar: "المنامة", flag: "🇧🇭", country: "bh", lat: 26.2235, lng: 50.5876, radiusKm: 20 },
  // أوروبا
  { key: "london", ar: "لندن", flag: "🇬🇧", country: "gb", lat: 51.5074, lng: -0.1278, radiusKm: 35 },
  { key: "paris", ar: "باريس", flag: "🇫🇷", country: "fr", lat: 48.8566, lng: 2.3522, radiusKm: 25 },
  { key: "nice", ar: "نيس", flag: "🇫🇷", country: "fr", lat: 43.7102, lng: 7.2620, radiusKm: 15 },
  { key: "cannes", ar: "كان", flag: "🇫🇷", country: "fr", lat: 43.5528, lng: 7.0174, radiusKm: 10 },
  { key: "monaco", ar: "موناكو", flag: "🇲🇨", country: "mc", lat: 43.7384, lng: 7.4246, radiusKm: 8 },
  { key: "rome", ar: "روما", flag: "🇮🇹", country: "it", lat: 41.9028, lng: 12.4964, radiusKm: 25 },
  { key: "milan", ar: "ميلانو", flag: "🇮🇹", country: "it", lat: 45.4642, lng: 9.1900, radiusKm: 20 },
  { key: "venice", ar: "البندقية", flag: "🇮🇹", country: "it", lat: 45.4408, lng: 12.3155, radiusKm: 15 },
  { key: "barcelona", ar: "برشلونة", flag: "🇪🇸", country: "es", lat: 41.3851, lng: 2.1734, radiusKm: 20 },
  { key: "madrid", ar: "مدريد", flag: "🇪🇸", country: "es", lat: 40.4168, lng: -3.7038, radiusKm: 25 },
  { key: "amsterdam", ar: "أمستردام", flag: "🇳🇱", country: "nl", lat: 52.3676, lng: 4.9041, radiusKm: 15 },
  { key: "berlin", ar: "برلين", flag: "🇩🇪", country: "de", lat: 52.5200, lng: 13.4050, radiusKm: 25 },
  { key: "vienna", ar: "فيينا", flag: "🇦🇹", country: "at", lat: 48.2082, lng: 16.3738, radiusKm: 20 },
  { key: "prague", ar: "براغ", flag: "🇨🇿", country: "cz", lat: 50.0755, lng: 14.4378, radiusKm: 20 },
  // تركيا
  { key: "istanbul", ar: "إسطنبول", flag: "🇹🇷", country: "tr", lat: 41.0082, lng: 28.9784, radiusKm: 40 },
  { key: "antalya", ar: "أنطاليا", flag: "🇹🇷", country: "tr", lat: 36.8969, lng: 30.7133, radiusKm: 30 },
  { key: "bodrum", ar: "بودروم", flag: "🇹🇷", country: "tr", lat: 37.0344, lng: 27.4305, radiusKm: 20 },
  { key: "trabzon", ar: "طرابزون", flag: "🇹🇷", country: "tr", lat: 41.0027, lng: 39.7168, radiusKm: 25 },
  // آسيا
  { key: "tokyo", ar: "طوكيو", flag: "🇯🇵", country: "jp", lat: 35.6762, lng: 139.6503, radiusKm: 35 },
  { key: "kyoto", ar: "كيوتو", flag: "🇯🇵", country: "jp", lat: 35.0116, lng: 135.7681, radiusKm: 20 },
  { key: "osaka", ar: "أوساكا", flag: "🇯🇵", country: "jp", lat: 34.6937, lng: 135.5023, radiusKm: 25 },
  { key: "kualalumpur", ar: "كوالالمبور", flag: "🇲🇾", country: "my", lat: 3.1390, lng: 101.6869, radiusKm: 25 },
  { key: "singapore", ar: "سنغافورة", flag: "🇸🇬", country: "sg", lat: 1.3521, lng: 103.8198, radiusKm: 25 },
  { key: "bangkok", ar: "بانكوك", flag: "🇹🇭", country: "th", lat: 13.7563, lng: 100.5018, radiusKm: 25 },
  // أمريكا
  { key: "newyork", ar: "نيويورك", flag: "🇺🇸", country: "us", lat: 40.7128, lng: -74.0060, radiusKm: 25 },
  { key: "losangeles", ar: "لوس أنجلوس", flag: "🇺🇸", country: "us", lat: 34.0522, lng: -118.2437, radiusKm: 35 },
];

export function cityFromKey(city?: string | null): CityOption | undefined {
  if (!city) return undefined;
  const k = city.toLowerCase().trim().replace(/\s+/g, "");
  return CITY_OPTIONS.find((c) => c.key === k || c.ar === city);
}

// Regions: cities that should share a catalogue because they're typically
// visited together (e.g., a Côte d'Azur trip covers Nice + Monaco + Cannes
// + nearby villages in a single itinerary).
export type Region = {
  key: string;
  ar: string;
  cities: string[];        // lowercase city keys
  citiesAr: string[];      // matching Arabic labels (for OR queries)
};

export const REGIONS: Region[] = [
  {
    key: "cote_dazur",
    ar: "الكوت دازور",
    cities: ["nice", "cannes", "monaco", "antibes", "eze", "villefranche", "menton", "capferrat", "capdail", "stpaul"],
    citiesAr: ["نيس", "كان", "موناكو", "أنتيب", "إيز", "فيلفرانش", "مونتون", "كاب فيرا", "كاب داي", "سان بول"],
  },
  {
    key: "saudi_central",
    ar: "وسط السعودية",
    cities: ["riyadh"],
    citiesAr: ["الرياض"],
  },
  {
    key: "saudi_west",
    ar: "غرب السعودية",
    cities: ["jeddah", "makkah", "madinah"],
    citiesAr: ["جدة", "مكة", "المدينة"],
  },
  {
    key: "uae",
    ar: "الإمارات",
    cities: ["dubai", "abudhabi"],
    citiesAr: ["دبي", "أبوظبي"],
  },
  {
    key: "uk_london",
    ar: "لندن وضواحيها",
    cities: ["london"],
    citiesAr: ["لندن"],
  },
  {
    key: "turkey_istanbul",
    ar: "إسطنبول",
    cities: ["istanbul"],
    citiesAr: ["إسطنبول"],
  },
];

/** Find the region a city belongs to. Matches lowercase English key OR Arabic label. */
export function getRegionForCity(city?: string | null): Region | undefined {
  if (!city) return undefined;
  const k = city.toLowerCase().trim();
  for (const r of REGIONS) {
    if (r.cities.includes(k) || r.citiesAr.includes(city.trim())) return r;
  }
  return undefined;
}

/** Build a Supabase `.or(...)` filter that includes the whole region. Returns
 *  null when no region is known — caller can fall back to single-city ilike. */
export function regionFilterClauseFor(city?: string | null): string | null {
  const region = getRegionForCity(city);
  if (!region) return null;
  const parts: string[] = [];
  for (const c of region.cities) parts.push(`city.eq.${c}`);
  for (const c of region.citiesAr) parts.push(`city_label.eq.${c}`);
  return parts.join(",");
}

/** Best Google Maps "view place" URL (not directions).
 * Google's Maps URLs API: query=NAME + query_place_id=PID opens the place
 * card directly. Passing lat,lng as query yields a generic pin which doesn't
 * surface the place's reviews/hours. */
export function buildPlaceUrl(p: {
  name: string;
  lat: number | null;
  lng: number | null;
  google_place_id?: string | null;
  google_maps_url?: string | null;
}): string {
  if (p.google_maps_url) return p.google_maps_url;
  const q = encodeURIComponent(p.name);
  if (p.google_place_id) {
    return `https://www.google.com/maps/search/?api=1&query=${q}&query_place_id=${encodeURIComponent(p.google_place_id)}`;
  }
  if (p.lat != null && p.lng != null) {
    // No place_id: fall back to the documented coords-as-query form. This
    // drops the named search but guarantees the right pin on the map.
    return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
