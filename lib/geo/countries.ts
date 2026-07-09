// 195 UN-recognized countries + a few common territories.
// Flag emoji is computed at render time from the ISO2 code (regional
// indicator symbols) — keeps this file tiny and avoids Unicode escapes.

export type Continent =
  | "asia" | "europe" | "africa"
  | "n_america" | "s_america" | "oceania";

export const CONTINENTS_AR: Record<Continent, string> = {
  asia:      "آسيا",
  europe:    "أوروبا",
  africa:    "أفريقيا",
  n_america: "أمريكا الشمالية",
  s_america: "أمريكا الجنوبية",
  oceania:   "أوقيانوسيا",
};

export const CONTINENT_ORDER: Continent[] = [
  "asia", "europe", "africa", "n_america", "s_america", "oceania",
];

export type Country = {
  code: string;      // ISO 3166-1 alpha-2
  ar: string;
  en: string;
  continent: Continent;
};

// ── The list ───────────────────────────────────────────────────────────
// Ordered alphabetically WITHIN each continent by ISO code so grepping
// is easy. Popular travel destinations verified against Been-app taxonomy.

export const COUNTRIES: Country[] = [
  // ─── Asia (47) ───
  { code: "AE", ar: "الإمارات",       en: "United Arab Emirates", continent: "asia" },
  { code: "AF", ar: "أفغانستان",      en: "Afghanistan",          continent: "asia" },
  { code: "AM", ar: "أرمينيا",        en: "Armenia",              continent: "asia" },
  { code: "AZ", ar: "أذربيجان",       en: "Azerbaijan",           continent: "asia" },
  { code: "BD", ar: "بنغلاديش",       en: "Bangladesh",           continent: "asia" },
  { code: "BH", ar: "البحرين",        en: "Bahrain",              continent: "asia" },
  { code: "BN", ar: "بروناي",         en: "Brunei",               continent: "asia" },
  { code: "BT", ar: "بوتان",          en: "Bhutan",               continent: "asia" },
  { code: "CN", ar: "الصين",          en: "China",                continent: "asia" },
  { code: "GE", ar: "جورجيا",         en: "Georgia",              continent: "asia" },
  { code: "ID", ar: "إندونيسيا",      en: "Indonesia",            continent: "asia" },
  { code: "IN", ar: "الهند",          en: "India",                continent: "asia" },
  { code: "IQ", ar: "العراق",         en: "Iraq",                 continent: "asia" },
  { code: "IR", ar: "إيران",          en: "Iran",                 continent: "asia" },
  { code: "JO", ar: "الأردن",         en: "Jordan",               continent: "asia" },
  { code: "JP", ar: "اليابان",        en: "Japan",                continent: "asia" },
  { code: "KG", ar: "قيرغيزستان",     en: "Kyrgyzstan",           continent: "asia" },
  { code: "KH", ar: "كمبوديا",        en: "Cambodia",             continent: "asia" },
  { code: "KP", ar: "كوريا الشمالية", en: "North Korea",          continent: "asia" },
  { code: "KR", ar: "كوريا الجنوبية", en: "South Korea",          continent: "asia" },
  { code: "KW", ar: "الكويت",         en: "Kuwait",               continent: "asia" },
  { code: "KZ", ar: "كازاخستان",      en: "Kazakhstan",           continent: "asia" },
  { code: "LA", ar: "لاوس",           en: "Laos",                 continent: "asia" },
  { code: "LB", ar: "لبنان",          en: "Lebanon",              continent: "asia" },
  { code: "LK", ar: "سريلانكا",       en: "Sri Lanka",            continent: "asia" },
  { code: "MM", ar: "ميانمار",        en: "Myanmar",              continent: "asia" },
  { code: "MN", ar: "منغوليا",        en: "Mongolia",             continent: "asia" },
  { code: "MV", ar: "المالديف",       en: "Maldives",             continent: "asia" },
  { code: "MY", ar: "ماليزيا",        en: "Malaysia",             continent: "asia" },
  { code: "NP", ar: "نيبال",          en: "Nepal",                continent: "asia" },
  { code: "OM", ar: "عُمان",          en: "Oman",                 continent: "asia" },
  { code: "PH", ar: "الفلبين",        en: "Philippines",          continent: "asia" },
  { code: "PK", ar: "باكستان",        en: "Pakistan",             continent: "asia" },
  { code: "PS", ar: "فلسطين",         en: "Palestine",            continent: "asia" },
  { code: "QA", ar: "قطر",            en: "Qatar",                continent: "asia" },
  { code: "SA", ar: "السعودية",       en: "Saudi Arabia",         continent: "asia" },
  { code: "SG", ar: "سنغافورة",       en: "Singapore",            continent: "asia" },
  { code: "SY", ar: "سوريا",          en: "Syria",                continent: "asia" },
  { code: "TH", ar: "تايلاند",        en: "Thailand",             continent: "asia" },
  { code: "TJ", ar: "طاجيكستان",      en: "Tajikistan",           continent: "asia" },
  { code: "TL", ar: "تيمور الشرقية",  en: "Timor-Leste",          continent: "asia" },
  { code: "TM", ar: "تركمانستان",     en: "Turkmenistan",         continent: "asia" },
  { code: "TR", ar: "تركيا",          en: "Turkey",               continent: "asia" },
  { code: "TW", ar: "تايوان",         en: "Taiwan",               continent: "asia" },
  { code: "UZ", ar: "أوزبكستان",      en: "Uzbekistan",           continent: "asia" },
  { code: "VN", ar: "فيتنام",         en: "Vietnam",              continent: "asia" },
  { code: "YE", ar: "اليمن",          en: "Yemen",                continent: "asia" },

  // ─── Europe (44) ───
  { code: "AD", ar: "أندورا",         en: "Andorra",              continent: "europe" },
  { code: "AL", ar: "ألبانيا",        en: "Albania",              continent: "europe" },
  { code: "AT", ar: "النمسا",         en: "Austria",              continent: "europe" },
  { code: "BA", ar: "البوسنة",        en: "Bosnia & Herzegovina", continent: "europe" },
  { code: "BE", ar: "بلجيكا",         en: "Belgium",              continent: "europe" },
  { code: "BG", ar: "بلغاريا",        en: "Bulgaria",             continent: "europe" },
  { code: "BY", ar: "بيلاروسيا",      en: "Belarus",              continent: "europe" },
  { code: "CH", ar: "سويسرا",         en: "Switzerland",          continent: "europe" },
  { code: "CY", ar: "قبرص",           en: "Cyprus",               continent: "europe" },
  { code: "CZ", ar: "التشيك",         en: "Czechia",              continent: "europe" },
  { code: "DE", ar: "ألمانيا",        en: "Germany",              continent: "europe" },
  { code: "DK", ar: "الدنمارك",       en: "Denmark",              continent: "europe" },
  { code: "EE", ar: "إستونيا",        en: "Estonia",              continent: "europe" },
  { code: "ES", ar: "إسبانيا",        en: "Spain",                continent: "europe" },
  { code: "FI", ar: "فنلندا",         en: "Finland",              continent: "europe" },
  { code: "FR", ar: "فرنسا",          en: "France",               continent: "europe" },
  { code: "GB", ar: "المملكة المتحدة", en: "United Kingdom",       continent: "europe" },
  { code: "GR", ar: "اليونان",        en: "Greece",               continent: "europe" },
  { code: "HR", ar: "كرواتيا",        en: "Croatia",              continent: "europe" },
  { code: "HU", ar: "المجر",          en: "Hungary",              continent: "europe" },
  { code: "IE", ar: "أيرلندا",        en: "Ireland",              continent: "europe" },
  { code: "IS", ar: "آيسلندا",        en: "Iceland",              continent: "europe" },
  { code: "IT", ar: "إيطاليا",        en: "Italy",                continent: "europe" },
  { code: "LI", ar: "ليختنشتاين",     en: "Liechtenstein",        continent: "europe" },
  { code: "LT", ar: "ليتوانيا",       en: "Lithuania",            continent: "europe" },
  { code: "LU", ar: "لوكسمبورغ",      en: "Luxembourg",           continent: "europe" },
  { code: "LV", ar: "لاتفيا",         en: "Latvia",               continent: "europe" },
  { code: "MC", ar: "موناكو",         en: "Monaco",               continent: "europe" },
  { code: "MD", ar: "مولدوفا",        en: "Moldova",              continent: "europe" },
  { code: "ME", ar: "الجبل الأسود",   en: "Montenegro",           continent: "europe" },
  { code: "MK", ar: "مقدونيا",        en: "North Macedonia",      continent: "europe" },
  { code: "MT", ar: "مالطا",          en: "Malta",                continent: "europe" },
  { code: "NL", ar: "هولندا",         en: "Netherlands",          continent: "europe" },
  { code: "NO", ar: "النرويج",        en: "Norway",               continent: "europe" },
  { code: "PL", ar: "بولندا",         en: "Poland",               continent: "europe" },
  { code: "PT", ar: "البرتغال",       en: "Portugal",             continent: "europe" },
  { code: "RO", ar: "رومانيا",        en: "Romania",              continent: "europe" },
  { code: "RS", ar: "صربيا",          en: "Serbia",               continent: "europe" },
  { code: "RU", ar: "روسيا",          en: "Russia",               continent: "europe" },
  { code: "SE", ar: "السويد",         en: "Sweden",               continent: "europe" },
  { code: "SI", ar: "سلوفينيا",       en: "Slovenia",             continent: "europe" },
  { code: "SK", ar: "سلوفاكيا",       en: "Slovakia",             continent: "europe" },
  { code: "SM", ar: "سان مارينو",     en: "San Marino",           continent: "europe" },
  { code: "UA", ar: "أوكرانيا",       en: "Ukraine",              continent: "europe" },
  { code: "VA", ar: "الفاتيكان",      en: "Vatican City",         continent: "europe" },

  // ─── Africa (54) ───
  { code: "AO", ar: "أنغولا",         en: "Angola",               continent: "africa" },
  { code: "BF", ar: "بوركينا فاسو",   en: "Burkina Faso",         continent: "africa" },
  { code: "BI", ar: "بوروندي",        en: "Burundi",              continent: "africa" },
  { code: "BJ", ar: "بنين",           en: "Benin",                continent: "africa" },
  { code: "BW", ar: "بوتسوانا",       en: "Botswana",             continent: "africa" },
  { code: "CD", ar: "الكونغو الديمقراطية", en: "DR Congo",        continent: "africa" },
  { code: "CF", ar: "أفريقيا الوسطى", en: "Central African Republic", continent: "africa" },
  { code: "CG", ar: "الكونغو",        en: "Republic of the Congo", continent: "africa" },
  { code: "CI", ar: "ساحل العاج",     en: "Ivory Coast",          continent: "africa" },
  { code: "CM", ar: "الكاميرون",      en: "Cameroon",             continent: "africa" },
  { code: "CV", ar: "الرأس الأخضر",   en: "Cape Verde",           continent: "africa" },
  { code: "DJ", ar: "جيبوتي",         en: "Djibouti",             continent: "africa" },
  { code: "DZ", ar: "الجزائر",        en: "Algeria",              continent: "africa" },
  { code: "EG", ar: "مصر",            en: "Egypt",                continent: "africa" },
  { code: "ER", ar: "إريتريا",        en: "Eritrea",              continent: "africa" },
  { code: "ET", ar: "إثيوبيا",        en: "Ethiopia",             continent: "africa" },
  { code: "GA", ar: "الغابون",        en: "Gabon",                continent: "africa" },
  { code: "GH", ar: "غانا",           en: "Ghana",                continent: "africa" },
  { code: "GM", ar: "غامبيا",         en: "Gambia",               continent: "africa" },
  { code: "GN", ar: "غينيا",          en: "Guinea",               continent: "africa" },
  { code: "GQ", ar: "غينيا الاستوائية", en: "Equatorial Guinea",  continent: "africa" },
  { code: "GW", ar: "غينيا بيساو",    en: "Guinea-Bissau",        continent: "africa" },
  { code: "KE", ar: "كينيا",          en: "Kenya",                continent: "africa" },
  { code: "KM", ar: "جزر القمر",      en: "Comoros",              continent: "africa" },
  { code: "LR", ar: "ليبيريا",        en: "Liberia",              continent: "africa" },
  { code: "LS", ar: "ليسوتو",         en: "Lesotho",              continent: "africa" },
  { code: "LY", ar: "ليبيا",          en: "Libya",                continent: "africa" },
  { code: "MA", ar: "المغرب",         en: "Morocco",              continent: "africa" },
  { code: "MG", ar: "مدغشقر",         en: "Madagascar",           continent: "africa" },
  { code: "ML", ar: "مالي",           en: "Mali",                 continent: "africa" },
  { code: "MR", ar: "موريتانيا",      en: "Mauritania",           continent: "africa" },
  { code: "MU", ar: "موريشيوس",       en: "Mauritius",            continent: "africa" },
  { code: "MW", ar: "مالاوي",         en: "Malawi",               continent: "africa" },
  { code: "MZ", ar: "موزمبيق",        en: "Mozambique",           continent: "africa" },
  { code: "NA", ar: "ناميبيا",        en: "Namibia",              continent: "africa" },
  { code: "NE", ar: "النيجر",         en: "Niger",                continent: "africa" },
  { code: "NG", ar: "نيجيريا",        en: "Nigeria",              continent: "africa" },
  { code: "RW", ar: "رواندا",         en: "Rwanda",               continent: "africa" },
  { code: "SC", ar: "سيشل",           en: "Seychelles",           continent: "africa" },
  { code: "SD", ar: "السودان",        en: "Sudan",                continent: "africa" },
  { code: "SL", ar: "سيراليون",       en: "Sierra Leone",         continent: "africa" },
  { code: "SN", ar: "السنغال",        en: "Senegal",              continent: "africa" },
  { code: "SO", ar: "الصومال",        en: "Somalia",              continent: "africa" },
  { code: "SS", ar: "جنوب السودان",   en: "South Sudan",          continent: "africa" },
  { code: "ST", ar: "ساو تومي",       en: "São Tomé and Príncipe", continent: "africa" },
  { code: "SZ", ar: "إسواتيني",       en: "Eswatini",             continent: "africa" },
  { code: "TD", ar: "تشاد",           en: "Chad",                 continent: "africa" },
  { code: "TG", ar: "توغو",           en: "Togo",                 continent: "africa" },
  { code: "TN", ar: "تونس",           en: "Tunisia",              continent: "africa" },
  { code: "TZ", ar: "تنزانيا",        en: "Tanzania",             continent: "africa" },
  { code: "UG", ar: "أوغندا",         en: "Uganda",               continent: "africa" },
  { code: "ZA", ar: "جنوب أفريقيا",   en: "South Africa",         continent: "africa" },
  { code: "ZM", ar: "زامبيا",         en: "Zambia",               continent: "africa" },
  { code: "ZW", ar: "زيمبابوي",       en: "Zimbabwe",             continent: "africa" },

  // ─── North America (23) ───
  { code: "AG", ar: "أنتيغوا وباربودا", en: "Antigua and Barbuda", continent: "n_america" },
  { code: "BB", ar: "باربادوس",       en: "Barbados",             continent: "n_america" },
  { code: "BS", ar: "الباهاما",       en: "Bahamas",              continent: "n_america" },
  { code: "BZ", ar: "بليز",           en: "Belize",               continent: "n_america" },
  { code: "CA", ar: "كندا",           en: "Canada",               continent: "n_america" },
  { code: "CR", ar: "كوستاريكا",      en: "Costa Rica",           continent: "n_america" },
  { code: "CU", ar: "كوبا",           en: "Cuba",                 continent: "n_america" },
  { code: "DM", ar: "دومينيكا",       en: "Dominica",             continent: "n_america" },
  { code: "DO", ar: "الدومينيكان",    en: "Dominican Republic",   continent: "n_america" },
  { code: "GD", ar: "غرينادا",        en: "Grenada",              continent: "n_america" },
  { code: "GT", ar: "غواتيمالا",      en: "Guatemala",            continent: "n_america" },
  { code: "HN", ar: "هندوراس",        en: "Honduras",             continent: "n_america" },
  { code: "HT", ar: "هايتي",          en: "Haiti",                continent: "n_america" },
  { code: "JM", ar: "جامايكا",        en: "Jamaica",              continent: "n_america" },
  { code: "KN", ar: "سانت كيتس ونيفيس", en: "Saint Kitts and Nevis", continent: "n_america" },
  { code: "LC", ar: "سانت لوسيا",     en: "Saint Lucia",          continent: "n_america" },
  { code: "MX", ar: "المكسيك",        en: "Mexico",               continent: "n_america" },
  { code: "NI", ar: "نيكاراغوا",      en: "Nicaragua",            continent: "n_america" },
  { code: "PA", ar: "بنما",           en: "Panama",               continent: "n_america" },
  { code: "SV", ar: "السلفادور",      en: "El Salvador",          continent: "n_america" },
  { code: "TT", ar: "ترينيداد وتوباغو", en: "Trinidad and Tobago", continent: "n_america" },
  { code: "US", ar: "الولايات المتحدة", en: "United States",       continent: "n_america" },
  { code: "VC", ar: "سانت فنسنت",     en: "Saint Vincent",        continent: "n_america" },

  // ─── South America (12) ───
  { code: "AR", ar: "الأرجنتين",      en: "Argentina",            continent: "s_america" },
  { code: "BO", ar: "بوليفيا",        en: "Bolivia",              continent: "s_america" },
  { code: "BR", ar: "البرازيل",       en: "Brazil",               continent: "s_america" },
  { code: "CL", ar: "تشيلي",          en: "Chile",                continent: "s_america" },
  { code: "CO", ar: "كولومبيا",       en: "Colombia",             continent: "s_america" },
  { code: "EC", ar: "الإكوادور",      en: "Ecuador",              continent: "s_america" },
  { code: "GY", ar: "غيانا",          en: "Guyana",               continent: "s_america" },
  { code: "PE", ar: "بيرو",           en: "Peru",                 continent: "s_america" },
  { code: "PY", ar: "باراغواي",       en: "Paraguay",             continent: "s_america" },
  { code: "SR", ar: "سورينام",        en: "Suriname",             continent: "s_america" },
  { code: "UY", ar: "أوروغواي",       en: "Uruguay",              continent: "s_america" },
  { code: "VE", ar: "فنزويلا",        en: "Venezuela",            continent: "s_america" },

  // ─── Oceania (14) ───
  { code: "AU", ar: "أستراليا",       en: "Australia",            continent: "oceania" },
  { code: "FJ", ar: "فيجي",           en: "Fiji",                 continent: "oceania" },
  { code: "FM", ar: "ميكرونيسيا",     en: "Micronesia",           continent: "oceania" },
  { code: "KI", ar: "كيريباتي",       en: "Kiribati",             continent: "oceania" },
  { code: "MH", ar: "جزر مارشال",     en: "Marshall Islands",     continent: "oceania" },
  { code: "NR", ar: "ناورو",          en: "Nauru",                continent: "oceania" },
  { code: "NZ", ar: "نيوزيلندا",      en: "New Zealand",          continent: "oceania" },
  { code: "PG", ar: "بابوا غينيا الجديدة", en: "Papua New Guinea", continent: "oceania" },
  { code: "PW", ar: "بالاو",          en: "Palau",                continent: "oceania" },
  { code: "SB", ar: "جزر سليمان",     en: "Solomon Islands",      continent: "oceania" },
  { code: "TO", ar: "تونغا",          en: "Tonga",                continent: "oceania" },
  { code: "TV", ar: "توفالو",         en: "Tuvalu",               continent: "oceania" },
  { code: "VU", ar: "فانواتو",        en: "Vanuatu",              continent: "oceania" },
  { code: "WS", ar: "ساموا",          en: "Samoa",                continent: "oceania" },
];

// Total for the "X/Y%" stat. Rounded to 195 (the UN count) even though
// our list may over/undercount by a few — everyone recognizes 195.
export const TOTAL_COUNTRIES = 195;

// ── Helpers ──────────────────────────────────────────────────────────

/** Flag emoji from ISO2 code — regional indicator pair. */
export function flagOf(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "🏳";
  return String.fromCodePoint(
    0x1F1E6 + (code.charCodeAt(0) - 0x41),
    0x1F1E6 + (code.charCodeAt(1) - 0x41),
  );
}

export function byContinent(): Record<Continent, Country[]> {
  const out = {
    asia: [], europe: [], africa: [],
    n_america: [], s_america: [], oceania: [],
  } as Record<Continent, Country[]>;
  for (const c of COUNTRIES) out[c.continent].push(c);
  for (const key of Object.keys(out) as Continent[]) {
    out[key].sort((a, b) => a.ar.localeCompare(b.ar, "ar"));
  }
  return out;
}

export function findCountry(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

// ── Popular cities per country ─────────────────────────────────────────
// Curated list of the ~5-8 most-traveled cities per country. Used to
// suggest choices when the user opens a country in their passport.
// Countries not listed here still support free-text city entry.
export const POPULAR_CITIES: Record<string, string[]> = {
  // Middle East + Gulf
  SA: ["الرياض", "جدة", "مكة المكرمة", "المدينة المنورة", "الدمام", "الطائف", "أبها", "الخبر"],
  AE: ["دبي", "أبوظبي", "الشارقة", "عجمان", "رأس الخيمة", "الفجيرة"],
  QA: ["الدوحة", "الوكرة", "الخور"],
  BH: ["المنامة", "المحرق", "الرفاع"],
  KW: ["مدينة الكويت", "السالمية", "حولي"],
  OM: ["مسقط", "صلالة", "نزوى", "صور"],
  YE: ["صنعاء", "عدن", "المكلا"],
  JO: ["عمّان", "البتراء", "العقبة", "جرش", "مادبا"],
  LB: ["بيروت", "جبيل", "بعلبك", "طرابلس", "صيدا"],
  EG: ["القاهرة", "الإسكندرية", "شرم الشيخ", "الغردقة", "الأقصر", "أسوان", "دهب", "مرسى علم"],
  IQ: ["بغداد", "البصرة", "أربيل", "الموصل", "كربلاء", "النجف"],
  SY: ["دمشق", "حلب", "اللاذقية"],
  PS: ["القدس", "بيت لحم", "الخليل", "رام الله", "غزة", "نابلس"],
  TR: ["إسطنبول", "أنقرة", "أنطاليا", "بورصة", "إزمير", "طرابزون", "بودروم", "كابادوكيا"],

  // Europe
  FR: ["باريس", "نيس", "ليون", "مرسيليا", "بوردو", "كان", "ستراسبورغ", "تولوز"],
  IT: ["روما", "ميلانو", "البندقية", "فلورنسا", "نابولي", "بيزا", "فيرونا", "سيينا"],
  ES: ["مدريد", "برشلونة", "إشبيلية", "فالنسيا", "غرناطة", "مالقا", "بلباو"],
  GB: ["لندن", "مانشستر", "إدنبرة", "ليفربول", "أكسفورد", "كامبريدج", "غلاسكو"],
  DE: ["برلين", "ميونيخ", "هامبورغ", "فرانكفورت", "كولونيا", "دريسدن"],
  NL: ["أمستردام", "روتردام", "لاهاي", "أوتريخت"],
  CH: ["زيورخ", "جنيف", "برن", "لوسيرن", "إنترلاكن", "بازل"],
  AT: ["فيينا", "سالزبورغ", "إنسبروك", "غراتس"],
  GR: ["أثينا", "سانتوريني", "ميكونوس", "كريت", "رودس", "ثيسالونيكي"],
  PT: ["لشبونة", "بورتو", "فارو", "مدينة كويمبرا"],
  SE: ["ستوكهولم", "جوتنبرغ", "مالمو"],
  NO: ["أوسلو", "بيرغن", "ترومسو"],
  DK: ["كوبنهاغن", "أرهوس"],
  FI: ["هلسنكي", "روفانييمي"],
  IE: ["دبلن", "كورك", "جالواي"],
  BE: ["بروكسل", "بروج", "أنتويرب", "غنت"],
  CZ: ["براغ", "بيلسن"],
  HR: ["دوبروفنيك", "زغرب", "سبليت", "زادار"],
  HU: ["بودابست"],
  PL: ["وارسو", "كراكوف", "غدانسك"],
  IS: ["ريكيافيك"],
  MC: ["مونت كارلو"],

  // North Africa
  MA: ["مراكش", "الدار البيضاء", "فاس", "الرباط", "طنجة", "أغادير", "شفشاون"],
  TN: ["تونس", "الحمامات", "سوسة", "جربة"],
  DZ: ["الجزائر العاصمة", "وهران", "قسنطينة"],
  LY: ["طرابلس", "بنغازي"],
  SD: ["الخرطوم"],

  // Sub-Saharan Africa
  ZA: ["كيب تاون", "جوهانسبرغ", "ديربان", "بريتوريا"],
  KE: ["نيروبي", "مومباسا", "ماساي مارا"],
  TZ: ["زنجبار", "دار السلام", "أروشا"],
  ET: ["أديس أبابا"],
  RW: ["كيغالي"],
  MU: ["بورت لويس"],
  SC: ["فيكتوريا", "ماهي"],

  // Americas
  US: ["نيويورك", "لوس أنجلوس", "سان فرانسيسكو", "ميامي", "لاس فيغاس", "أورلاندو", "شيكاغو", "هيوستن", "سياتل", "هاواي", "بوسطن", "واشنطن"],
  CA: ["تورونتو", "فانكوفر", "مونتريال", "أوتاوا", "كالغاري", "كيبيك"],
  MX: ["مكسيكو سيتي", "كانكون", "بلايا ديل كارمن", "توليم", "قوادالاخارا"],
  BR: ["ريو دي جانيرو", "ساو باولو", "سلفادور", "برازيليا"],
  AR: ["بوينس آيرس", "منديزا", "بيلوش"],
  CL: ["سانتياغو", "فالبارايسو", "أتاكاما"],
  CU: ["هافانا", "فاراديرو"],
  DO: ["سانتو دومينغو", "بونتا كانا"],
  JM: ["كينغستون", "مونتيغو باي"],
  BS: ["ناسو"],
  PE: ["ليما", "كوسكو", "ماتشو بيتشو"],
  CO: ["بوغوتا", "قرطاجنة", "ميديلين"],

  // Asia (East + South + SE)
  JP: ["طوكيو", "أوساكا", "كيوتو", "هيروشيما", "نارا", "هوكايدو", "أوكيناوا", "ناغويا"],
  KR: ["سيول", "بوسان", "جيجو", "إنشون"],
  CN: ["بكين", "شنغهاي", "هونغ كونغ", "شيان", "قوانغتشو", "تشنغدو", "تشونغتشينغ"],
  TW: ["تايبيه", "تاينان", "كاوسيونغ"],
  TH: ["بانكوك", "فوكيت", "تشيانغ ماي", "كرابي", "باتايا", "كوه ساموي"],
  VN: ["هانوي", "هوشي منه", "دا نانغ", "هوي آن", "هالونغ"],
  SG: ["سنغافورة"],
  MY: ["كوالالمبور", "لانكاوي", "بينانغ", "ملقا", "كوتا كينابالو"],
  ID: ["بالي", "جاكرتا", "يوجياكارتا", "لومبوك"],
  PH: ["مانيلا", "سيبو", "بالاوان", "بوراكاي"],
  IN: ["مومباي", "دلهي", "بنغالور", "أغرا", "جايبور", "غوا", "كيرالا", "كولكاتا"],
  MV: ["مالي", "أتول ماله الجنوبي"],
  LK: ["كولومبو", "كاندي", "غالي"],
  NP: ["كاتماندو", "بوخارا"],
  KH: ["سيم ريب", "بنوم بنه"],
  UZ: ["طشقند", "سمرقند", "بخارى", "خيوة"],
  KZ: ["ألماتي", "أستانا"],
  GE: ["تبليسي", "باتومي"],
  AM: ["يريفان"],
  AZ: ["باكو"],

  // Oceania
  AU: ["سيدني", "ملبورن", "بريزبن", "بيرث", "قولد كوست", "كيرنز"],
  NZ: ["أوكلاند", "كوينزتاون", "ولنغتون", "روتوروا"],
  FJ: ["سوفا", "نادي"],

  // Russia
  RU: ["موسكو", "سانت بطرسبرغ", "كازان", "سوتشي"],
};

