"use client";

// جواز سفري — passport landing tab.
// Levels: world map + continents → countries of continent → country sheet.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import {
  CheckCircle2, Target, Circle, X as XIcon, Plus,
  Globe, TrendingUp, MapPinned, ChevronRight,
} from "lucide-react";
import {
  CONTINENTS_AR, CONTINENT_ORDER, TOTAL_COUNTRIES,
  POPULAR_CITIES, byContinent, findCountry, flagOf,
  type Continent, type Country,
} from "@/lib/geo/countries";
import { normalizeCityKey } from "@/lib/geo/cityCountry";
import type { DerivedCity } from "@/lib/places/myPlaces";
import type { PassportRow } from "@/app/passport/page";

type Status = "visited" | "wishlist" | null;
type CityEntry = { key: string; label: string; status: "visited" | "wishlist" };
type PassportState = { countries: Map<string, "visited" | "wishlist">; cities: Map<string, CityEntry[]> };
type View = { name: "continents" } | { name: "countries"; continent: Continent };

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO alpha-2 → ISO numeric (ids used by world-atlas topojson)
const A2N: Record<string, string> = {
  AF: "004", AL: "008", DZ: "012", AD: "020", AO: "024", AG: "028", AR: "032", AM: "051", AU: "036", AT: "040", AZ: "031", BS: "044",
  BH: "048", BD: "050", BB: "052", BY: "112", BE: "056", BZ: "084", BJ: "204", BT: "064", BO: "068", BA: "070", BW: "072", BR: "076",
  BN: "096", BG: "100", BF: "854", BI: "108", CV: "132", KH: "116", CM: "120", CA: "124", CF: "140", TD: "148", CL: "152", CN: "156",
  CO: "170", KM: "174", CG: "178", CD: "180", CR: "188", CI: "384", HR: "191", CU: "192", CY: "196", CZ: "203", DK: "208", DJ: "262",
  DM: "212", DO: "214", EC: "218", EG: "818", SV: "222", GQ: "226", ER: "232", EE: "233", SZ: "748", ET: "231", FJ: "242", FI: "246",
  FR: "250", GA: "266", GM: "270", GE: "268", DE: "276", GH: "288", GR: "300", GD: "308", GT: "320", GN: "324", GW: "624", GY: "328",
  HT: "332", HN: "340", HU: "348", IS: "352", IN: "356", ID: "360", IR: "364", IQ: "368", IE: "372", IL: "376", IT: "380", JM: "388",
  JP: "392", JO: "400", KZ: "398", KE: "404", KI: "296", KP: "408", KR: "410", KW: "414", KG: "417", LA: "418", LV: "428", LB: "422",
  LS: "426", LR: "430", LY: "434", LI: "438", LT: "440", LU: "442", MG: "450", MW: "454", MY: "458", MV: "462", ML: "466", MT: "470",
  MH: "584", MR: "478", MU: "480", MX: "484", FM: "583", MD: "498", MC: "492", MN: "496", ME: "499", MA: "504", MZ: "508", MM: "104",
  NA: "516", NR: "520", NP: "524", NL: "528", NZ: "554", NI: "558", NE: "562", NG: "566", MK: "807", NO: "578", OM: "512", PK: "586",
  PW: "585", PA: "591", PG: "598", PY: "600", PE: "604", PH: "608", PL: "616", PT: "620", QA: "634", RO: "642", RU: "643", RW: "646",
  KN: "659", LC: "662", VC: "670", WS: "882", SM: "674", ST: "678", SA: "682", SN: "686", RS: "688", SC: "690", SL: "694", SG: "702",
  SK: "703", SI: "705", SB: "090", SO: "706", ZA: "710", SS: "728", ES: "724", LK: "144", SD: "729", SR: "740", SE: "752", CH: "756",
  SY: "760", TJ: "762", TZ: "834", TH: "764", TL: "626", TG: "768", TO: "776", TT: "780", TN: "788", TR: "792", TM: "795", TV: "798",
  UG: "800", UA: "804", AE: "784", GB: "826", US: "840", UY: "858", UZ: "860", VU: "548", VA: "336", VE: "862", VN: "704", YE: "887",
  ZM: "894", ZW: "716", PS: "275", TW: "158",
};

const CONTINENT_ICON: Record<Continent, string> = {
  asia: "🌏", europe: "🏛", africa: "🌍", n_america: "🗽", s_america: "🌎", oceania: "🏝",
};

function buildState(rows: PassportRow[]): PassportState {
  const countries = new Map<string, "visited" | "wishlist">();
  const cities = new Map<string, CityEntry[]>();
  for (const r of rows) {
    if (r.entity_type === "country") {
      countries.set(r.entity_key, r.status);
    } else {
      const cc = r.entity_key.split(":")[0];
      const arr = cities.get(cc) ?? [];
      arr.push({ key: r.entity_key, label: r.city_label ?? r.entity_key.split(":")[1], status: r.status });
      cities.set(cc, arr);
    }
  }
  return { countries, cities };
}

export default function PassportScreen({ initialRows, derived }: {
  initialRows: PassportRow[];
  // Canonical check-in-derived visited countries/cities (see myPlaces.ts
  // computeVisitedRollup) — a check-in ALWAYS counts as visited here.
  derived: { countries: string[]; cities: DerivedCity[] };
}) {
  const [state, setState] = useState<PassportState>(() => buildState(initialRows));
  const [view, setView] = useState<View>({ name: "continents" });
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [filter, setFilter] = useState<"all" | "visited" | "wishlist">("all");
  const [openCountry, setOpenCountry] = useState<Country | null>(null);

  const byCont = useMemo(() => byContinent(), []);

  // Effective country status = explicit toggles ∪ check-in-derived visited
  // ∪ countries with a «زرتها» city. Visited from real presence always wins
  // over wishlist; the map, stats, and rows ALL read this one map.
  const effective = useMemo(() => {
    const m = new Map(state.countries);
    for (const code of derived.countries) m.set(code.toUpperCase(), "visited");
    for (const [cc, arr] of state.cities) {
      if (arr.some((c) => c.status === "visited")) m.set(cc.toUpperCase(), "visited");
    }
    return m;
  }, [state, derived.countries]);

  const stats = useMemo(() => {
    const visitedCodes = Array.from(effective.entries())
      .filter(([, s]) => s === "visited")
      .map(([code]) => code);
    const continentsVisited = new Set(visitedCodes.map((code) => findCountry(code)?.continent).filter(Boolean));
    // Distinct VISITED cities: explicit «زرتها» city entries ∪ check-in
    // cities, deduped by country+canonical key (same roll-up as أماكني).
    const cityIdents = new Set<string>();
    for (const [cc, arr] of state.cities) {
      for (const c of arr) {
        if (c.status !== "visited") continue;
        const key = normalizeCityKey(c.label) ?? normalizeCityKey(c.key.split(":").slice(1).join(":")) ?? c.key;
        cityIdents.add(`${cc.toUpperCase()}:${key}`);
      }
    }
    for (const c of derived.cities) cityIdents.add(`${c.country.toUpperCase()}:${c.key}`);
    return {
      countriesVisited: visitedCodes.length,
      continents: continentsVisited.size,
      cities: cityIdents.size,
      pct: Math.round((visitedCodes.length / TOTAL_COUNTRIES) * 100),
    };
  }, [state.cities, effective, derived.cities]);

  // world-atlas numeric id → status, for map fills
  const statusByNum = useMemo(() => {
    const m = new Map<string, "visited" | "wishlist">();
    for (const [code, s] of effective) {
      const n = A2N[code];
      if (n) m.set(n, s);
    }
    return m;
  }, [effective]);

  const goCountries = useCallback((continent: Continent) => {
    setDir("fwd");
    setFilter("all");
    setView({ name: "countries", continent });
  }, []);

  const goBack = useCallback(() => {
    setDir("back");
    setView({ name: "continents" });
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);

  // ── Optimistic API helpers ──────────────────────────────────────────
  const toggleCountry = useCallback(async (code: string, next: Status) => {
    const prev = state.countries.get(code) ?? null;
    setState((s) => {
      const countries = new Map(s.countries);
      const cities = new Map(s.cities);
      if (next === null) {
        countries.delete(code);
        cities.delete(code); // cascade delete matches server behavior
      } else {
        countries.set(code, next);
      }
      return { countries, cities };
    });
    try {
      const r = await fetch("/api/passport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, status: next }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch {
      setState((s) => {
        const countries = new Map(s.countries);
        if (prev == null) countries.delete(code);
        else countries.set(code, prev);
        return { ...s, countries };
      });
    }
  }, [state]);

  const addCity = useCallback(async (country: string, city: string, status: "visited" | "wishlist" = "visited") => {
    const trimmed = city.trim();
    if (!trimmed) return;
    // same slug the server computes so optimistic state matches
    const slug = trimmed.toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "");
    const key = `${country}:${slug}`;
    setState((s) => {
      const arr = s.cities.get(country) ?? [];
      if (arr.find((c) => c.key === key)) return s;
      const cities = new Map(s.cities);
      cities.set(country, [...arr, { key, label: trimmed, status }]);
      return { ...s, cities };
    });
    try {
      await fetch("/api/passport/cities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, city: trimmed, status }),
      });
    } catch { /* user can retry */ }
  }, []);

  const removeCity = useCallback(async (country: string, cityLabel: string) => {
    setState((s) => {
      const arr = s.cities.get(country) ?? [];
      const cities = new Map(s.cities);
      cities.set(country, arr.filter((c) => c.label !== cityLabel));
      return { ...s, cities };
    });
    try {
      await fetch("/api/passport/cities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country, city: cityLabel }),
      });
    } catch { /* silent */ }
  }, []);

  const activeList = view.name === "countries" ? byCont[view.continent] : [];

  return (
    <main className="min-h-screen bg-sand pb-24">
      <style>{`
        @keyframes rihlaPushIn{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
        @keyframes rihlaPopIn{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
        .rihla-push{animation:rihlaPushIn .3s cubic-bezier(.32,.72,.36,1) both}
        .rihla-pop{animation:rihlaPopIn .3s cubic-bezier(.32,.72,.36,1) both}
      `}</style>

      <header
        className="sticky top-0 z-40 bg-card/95 backdrop-blur-md border-b border-line"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {view.name === "continents" ? (
          <div className="max-w-2xl mx-auto flex items-center gap-2 px-4 min-h-[52px]">
            <Globe size={22} className="text-sea" aria-hidden="true" />
            <h1 className="font-extrabold text-ink text-[18px] tracking-tight">جواز سفري</h1>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto flex items-center gap-1.5 px-1.5 min-h-[52px]">
            <button
              type="button"
              onClick={goBack}
              aria-label="رجوع للقارات"
              className="w-11 h-11 inline-flex items-center justify-center rounded-full active:bg-sand transition"
            >
              <ChevronRight size={22} className="text-sea" aria-hidden="true" />
            </button>
            <span className="text-[20px] leading-none" aria-hidden="true">{CONTINENT_ICON[view.continent]}</span>
            <h1 className="font-extrabold text-ink text-[17px] tracking-tight">{CONTINENTS_AR[view.continent]}</h1>
            <span className="ms-auto me-4 text-[11px] font-bold text-muted tabular-nums">
              {activeList.filter((c) => effective.get(c.code) === "visited").length} / {activeList.length}
            </span>
          </div>
        )}
      </header>

      {view.name === "continents" ? (
        <div key="continents" className={`max-w-2xl mx-auto px-4 pt-4 ${dir === "back" ? "rihla-pop" : ""}`}>
          {/* Been-style hero — one giant number carries the story */}
          <section className="text-center py-6">
            <div className="font-extrabold text-ink text-[76px] leading-none tabular-nums tracking-tight">
              {stats.pct}<span className="text-[40px] text-muted">%</span>
            </div>
            <p className="text-[13px] text-muted font-bold mt-2">من العالم</p>
          </section>

          {/* World map — the visual centerpiece */}
          <div className="rounded-3xl border border-line bg-[#f5ede0] overflow-hidden py-3 shadow-sm" aria-hidden="true">
            <ComposableMap
              projection="geoNaturalEarth1"
              projectionConfig={{ scale: 155, center: [10, 8] }}
              width={800}
              height={400}
              style={{ width: "100%", height: "auto", maxHeight: 260, pointerEvents: "none", display: "block", margin: "0 auto" }}
            >
              <Geographies geography={GEO_URL}>
                {({ geographies }: { geographies: Array<{ rsmKey: string; id: string }> }) =>
                  geographies
                    .filter((geo) => String(geo.id) !== "010" && String(geo.id) !== "376") // skip Antarctica + Israel
                    .map((geo) => {
                      const st = statusByNum.get(String(geo.id));
                      const fill = st === "visited" ? "#0c4a63" : st === "wishlist" ? "#e0654a" : "#e3d7c3";
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          fill={fill}
                          stroke="rgba(0,0,0,0.10)"
                          strokeWidth={0.5}
                          tabIndex={-1}
                          style={{ default: { outline: "none" }, hover: { outline: "none", fill }, pressed: { outline: "none", fill } }}
                        />
                      );
                    })}
              </Geographies>
            </ComposableMap>
          </div>

          {/* Compact stats row — Been-style split cells */}
          <div className="grid grid-cols-3 mt-3 bg-card border border-line rounded-2xl overflow-hidden">
            <StatCell number={stats.countriesVisited} label="دولة" />
            <StatCell number={stats.continents} label="قارة" divider />
            <StatCell number={stats.cities} label="مدينة" divider />
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-5 mt-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted">
              <span className="w-2.5 h-2.5 rounded-full bg-sea inline-block" /> زرتها
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted">
              <span className="w-2.5 h-2.5 rounded-full bg-coral inline-block" /> أروح لها
            </span>
          </div>

          <div className="flex items-baseline justify-between mt-7 mb-3 px-0.5">
            <h2 className="text-[13.5px] font-extrabold text-ink">القارات</h2>
            <span className="text-[10.5px] text-muted">اضغط قارة لاستعراض دولها</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {CONTINENT_ORDER.map((cont) => (
              <ContinentCard key={cont} cont={cont} list={byCont[cont]} countries={effective} onOpen={() => goCountries(cont)} />
            ))}
          </div>
        </div>
      ) : (
        <div key={view.continent} className="max-w-2xl mx-auto px-4 pt-3 rihla-push">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>الكل</FilterChip>
            <FilterChip on={filter === "visited"} onClick={() => setFilter("visited")} tone="ok">
              <CheckCircle2 size={14} aria-hidden="true" /><span>زرتها</span>
            </FilterChip>
            <FilterChip on={filter === "wishlist"} onClick={() => setFilter("wishlist")} tone="wish">
              <Target size={14} aria-hidden="true" /><span>أروح لها</span>
            </FilterChip>
          </div>

          <div className="space-y-1.5 mt-2.5">
            {activeList
              .filter((c) => filter === "all" || effective.get(c.code) === filter)
              .map((c) => {
                const countryStatus = effective.get(c.code) ?? null;
                const savedCities = state.cities.get(c.code) ?? [];
                return (
                  <CountryRow
                    key={c.code}
                    country={c}
                    status={countryStatus}
                    savedCities={savedCities}
                    popular={POPULAR_CITIES[c.code] ?? []}
                    onOpen={() => setOpenCountry(c)}
                    onQuickToggle={() => toggleCountry(c.code, countryStatus === "visited" ? null : "visited")}
                    onCityToggle={(cityName) => {
                      const already = savedCities.find((x) => x.label === cityName);
                      if (already) removeCity(c.code, cityName);
                      else addCity(c.code, cityName, countryStatus ?? "visited");
                    }}
                  />
                );
              })}
            {filter !== "all" && activeList.every((c) => effective.get(c.code) !== filter) && (
              <p className="text-center text-[12.5px] text-muted py-10">ما في دول بهذا التصنيف هنا بعد</p>
            )}
          </div>
        </div>
      )}

      {openCountry && (
        <CountrySheet
          country={openCountry}
          status={effective.get(openCountry.code) ?? null}
          cities={state.cities.get(openCountry.code) ?? []}
          onClose={() => setOpenCountry(null)}
          onToggle={(next) => toggleCountry(openCountry.code, next)}
          onAddCity={(city, status) => addCity(openCountry.code, city, status)}
          onRemoveCity={(city) => removeCity(openCountry.code, city)}
        />
      )}
    </main>
  );
}

// ─── Stat cell — Been-style compact single number ─────────────────────
function StatCell({ number, label, divider }: { number: number; label: string; divider?: boolean }) {
  return (
    <div className={`py-3 text-center ${divider ? "border-s border-line" : ""}`}>
      <div className="font-extrabold text-ink text-[22px] tabular-nums leading-none">{number}</div>
      <div className="text-[10.5px] text-muted font-bold mt-1">{label}</div>
    </div>
  );
}

// ─── Continent card ─────────────────────────────────────────────────────
function ContinentCard({ cont, list, countries, onOpen }: {
  cont: Continent; list: Country[]; countries: Map<string, "visited" | "wishlist">; onOpen: () => void;
}) {
  const visited = list.filter((c) => countries.get(c.code) === "visited").length;
  const wish = list.filter((c) => countries.get(c.code) === "wishlist").length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="bg-card border border-line rounded-2xl p-3.5 text-right active:scale-[0.97] hover:border-sea/40 transition flex flex-col min-h-[112px]"
    >
      <div className="flex items-center justify-between w-full">
        <span className="text-[24px] leading-none" aria-hidden="true">{CONTINENT_ICON[cont]}</span>
        <ChevronRight size={15} className="text-muted/60 rotate-180" aria-hidden="true" />
      </div>
      <div className="w-full mt-auto pt-3">
        <div className="font-extrabold text-ink text-[14px]">{CONTINENTS_AR[cont]}</div>
        <div className="text-[10.5px] text-muted font-bold mt-0.5 tabular-nums">
          {visited} / {list.length} زرت
          {wish > 0 && <span className="text-coral-600"> · {wish} أروح</span>}
        </div>
        <div className="h-1.5 bg-sand rounded-full overflow-hidden mt-2 flex">
          <span className="bg-sea h-full" style={{ width: `${(visited / list.length) * 100}%` }} />
          <span className="bg-coral/70 h-full" style={{ width: `${(wish / list.length) * 100}%` }} />
        </div>
      </div>
    </button>
  );
}

// ─── Filter chip ────────────────────────────────────────────────────────
function FilterChip({ on, onClick, tone, children }: {
  on: boolean; onClick: () => void; tone?: "ok" | "wish"; children: React.ReactNode;
}) {
  const onBg = tone === "ok" ? "bg-ok text-white border-ok"
    : tone === "wish" ? "bg-coral text-white border-coral"
      : "bg-ink text-sand border-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`shrink-0 inline-flex items-center gap-1 px-3.5 min-h-[44px] rounded-pill text-[12px] font-bold border shadow-sm active:scale-95 transition ${
        on ? onBg : "bg-card text-ink border-line"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Country row — Been pattern: quick-toggle + inline city chips ─────
function CountryRow({
  country, status, savedCities, popular, onOpen, onQuickToggle, onCityToggle,
}: {
  country: Country;
  status: Status;
  savedCities: CityEntry[];
  popular: string[];
  onOpen: () => void;
  onQuickToggle: () => void;
  onCityToggle: (cityName: string) => void;
}) {
  const isVisited = status === "visited";
  // Build the chip list: user's saved cities first, then popular cities not saved yet.
  const savedLabels = new Set(savedCities.map((c) => c.label));
  const suggested = popular.filter((p) => !savedLabels.has(p));
  const hasChips = savedCities.length > 0 || suggested.length > 0;

  return (
    <div className="w-full rounded-2xl bg-card border border-line hover:border-sea/40 transition overflow-hidden">
      {/* Top row: quick-toggle + flag + name + chevron */}
      <div className="flex items-center gap-2 px-3 min-h-[56px]">
        <button
          type="button"
          onClick={onQuickToggle}
          aria-pressed={isVisited}
          aria-label={isVisited ? `ألغِ زيارة ${country.ar}` : `علّم ${country.ar} كزرتها`}
          className={`w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full active:scale-90 transition ${
            isVisited ? "bg-sea text-white" : "bg-sand text-muted border border-line"
          }`}
        >
          <CheckCircle2 size={20} aria-hidden="true" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-right flex items-center gap-2.5 py-2 active:opacity-70 transition"
        >
          <span className="text-[24px] leading-none shrink-0" aria-hidden="true">{flagOf(country.code)}</span>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-ink text-[13.5px] line-clamp-1">{country.ar}</div>
            {savedCities.length > 0 && (
              <div className="text-[10px] text-muted font-bold">{savedCities.length} مدينة مضافة</div>
            )}
          </div>
          {status === "wishlist" && (
            <span className="inline-flex items-center gap-1 bg-coral/10 text-coral-600 border border-coral/30 rounded-pill px-2 py-0.5 text-[10px] font-extrabold">
              <Target size={11} aria-hidden="true" /> أروح
            </span>
          )}
          <ChevronRight size={14} aria-hidden="true" className="text-muted/60 rotate-180 shrink-0" />
        </button>
      </div>

      {/* City chips — horizontal scroll of saved + popular cities */}
      {hasChips && (
        <div
          className="px-3 pb-2.5 pt-0.5 flex gap-1.5 overflow-x-auto scrollbar-thin"
          style={{ scrollSnapType: "x proximity" }}
          role="list"
          aria-label={`مدن ${country.ar}`}
        >
          {savedCities.map((city) => (
            <button
              key={city.key}
              type="button"
              role="listitem"
              onClick={() => onCityToggle(city.label)}
              aria-pressed={true}
              aria-label={`احذف ${city.label}`}
              style={{ scrollSnapAlign: "start" }}
              className={`shrink-0 inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-pill text-[11.5px] font-bold border active:scale-95 transition ${
                city.status === "visited"
                  ? "bg-sea text-white border-sea"
                  : "bg-coral text-white border-coral"
              }`}
            >
              <CheckCircle2 size={12} aria-hidden="true" strokeWidth={2.5} />
              <span>{city.label}</span>
            </button>
          ))}
          {suggested.map((cityName) => (
            <button
              key={`pop-${cityName}`}
              type="button"
              role="listitem"
              onClick={() => onCityToggle(cityName)}
              aria-pressed={false}
              aria-label={`أضف ${cityName}`}
              style={{ scrollSnapAlign: "start" }}
              className="shrink-0 inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-pill text-[11.5px] font-bold border bg-card text-ink border-line hover:border-sea/40 active:scale-95 transition"
            >
              <Plus size={12} className="text-sea" aria-hidden="true" strokeWidth={2.5} />
              <span>{cityName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Country detail sheet ───────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "visited" as const, tone: "bg-ok text-white border-ok shadow", icon: CheckCircle2, label: "زرتها" },
  { value: "wishlist" as const, tone: "bg-coral text-white border-coral shadow", icon: Target, label: "أروح لها" },
  { value: null, tone: "bg-ink text-sand border-ink shadow", icon: Circle, label: "لا شيء" },
];

function CountrySheet({ country, status, cities, onClose, onToggle, onAddCity, onRemoveCity }: {
  country: Country;
  status: Status;
  cities: CityEntry[];
  onClose: () => void;
  onToggle: (next: Status) => void;
  onAddCity: (city: string, status: "visited" | "wishlist") => void;
  onRemoveCity: (city: string) => void;
}) {
  const [cityInput, setCityInput] = useState("");
  const popular = POPULAR_CITIES[country.code] ?? [];

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function submit() {
    const v = cityInput.trim();
    if (!v) return;
    onAddCity(v, status ?? "visited");
    setCityInput("");
  }

  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/45 flex items-end sm:items-center justify-center animate-backdrop-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`تعديل ${country.ar}`}
    >
      <div
        className="bg-sand w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[92dvh] overflow-y-auto animate-sheet-up"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="w-9 h-[5px] bg-ink/30 rounded-full mx-auto mt-3 mb-3" />

        <div className="px-5 pb-4 text-center">
          <div className="text-[52px] leading-none" aria-hidden="true">{flagOf(country.code)}</div>
          <h2 className="font-extrabold text-ink text-[20px] mt-2">{country.ar}</h2>
          <p className="text-[11px] text-muted mt-0.5">{country.en} · {CONTINENTS_AR[country.continent]}</p>
        </div>

        <div className="px-5 grid grid-cols-3 gap-2">
          {STATUS_OPTIONS.map((opt) => {
            const active = status === opt.value;
            const Icon = opt.icon;
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={active}
                onClick={() => onToggle(active && opt.value !== null ? null : opt.value)}
                className={`inline-flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-xl border-2 font-extrabold text-[11.5px] active:scale-95 transition ${
                  active ? opt.tone : "bg-card text-ink border-line"
                }`}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {status && popular.length > 0 && (
          <section className="mx-5 mt-4 bg-card border border-line rounded-2xl p-4">
            <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2.5 inline-flex items-center gap-1.5">
              <TrendingUp size={14} aria-hidden="true" /><span>أشهر المدن</span>
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {popular.map((name) => {
                const added = cities.some((c) => c.label === name);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={added}
                    onClick={() => (added ? onRemoveCity(name) : onAddCity(name, status))}
                    className={`inline-flex items-center gap-1 min-h-[44px] px-3 rounded-pill text-[12px] font-bold border active:scale-95 transition ${
                      added ? "bg-sea text-white border-sea" : "bg-card text-ink border-line"
                    }`}
                  >
                    {added
                      ? <CheckCircle2 size={13} aria-hidden="true" />
                      : <Plus size={13} className="text-sea" aria-hidden="true" />}
                    <span>{name}</span>
                    {!added && <span className="text-[10px] text-muted">إضافة</span>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {status && (
          <section className="mx-5 mt-4 bg-card border border-line rounded-2xl p-4">
            <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2.5 inline-flex items-center gap-1.5">
              <MapPinned size={14} aria-hidden="true" /><span>مدنك في {country.ar}</span>
            </h3>
            {cities.length === 0 ? (
              <p className="text-[12px] text-muted mb-3">ما أضفت مدن بعد — اختر من الأشهر أو اكتب مدينتك ↓</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {cities.map((c) => (
                  <span
                    key={c.key}
                    className={`inline-flex items-center gap-1 rounded-pill ps-2.5 pe-1 min-h-[36px] text-[11.5px] font-bold border ${
                      c.status === "visited"
                        ? "bg-ok/10 text-ok border-ok/30"
                        : "bg-coral/10 text-coral-600 border-coral/30"
                    }`}
                  >
                    <span>{c.label}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveCity(c.label)}
                      aria-label={`احذف ${c.label}`}
                      className="w-11 h-11 -my-2 inline-flex items-center justify-center rounded-full opacity-60 hover:opacity-100 active:scale-90 transition"
                    >
                      <XIcon size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
              <input
                value={cityInput}
                enterKeyHint="done"
                onFocus={(e) => {
                  const el = e.currentTarget;
                  // iOS keyboard slides over fixed sheets — nudge the input
                  // into view after the keyboard finishes animating (~350ms).
                  setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 350);
                }}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder="أضِف مدينة… (مثل: نيس)"
                className="flex-1 min-w-0 min-h-[44px] px-3 rounded-xl bg-card border border-line text-ink text-[14px] outline-none focus:border-sea"
              />
              <button
                type="submit"
                disabled={!cityInput.trim()}
                aria-label="أضِف المدينة"
                className="w-11 min-w-[44px] h-11 rounded-xl bg-sea text-white font-extrabold inline-flex items-center justify-center shadow-btn-sea active:translate-y-px active:shadow-btn-press transition-all duration-150 disabled:opacity-40 disabled:shadow-none"
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </form>
          </section>
        )}

        <div className="px-5 pt-5">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[48px] rounded-xl bg-card border border-line text-ink font-extrabold text-[13.5px] active:scale-95 transition"
          >
            تم
          </button>
        </div>
      </div>
    </div>
  );
}
