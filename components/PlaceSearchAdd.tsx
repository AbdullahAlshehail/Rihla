"use client";

// Google-Maps-style search box for adding any place to the trip's catalog.
// As-you-type autocomplete with city bias, click to add, instant enrichment.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CITY_OPTIONS, cityFromKey, type CityOption } from "@/lib/utils";
import { inferKind, instantScore, generateBlurb } from "@/lib/google/inferKind";

const CATEGORY_CHIPS: Array<{ key: string; ar: string; emoji: string }> = [
  { key: "food", ar: "مطاعم", emoji: "🍽" },
  { key: "coffee", ar: "قهاوي", emoji: "☕" },
  { key: "sight", ar: "معالم", emoji: "🏛" },
  { key: "nature", ar: "طبيعة", emoji: "🌿" },
  { key: "sweet", ar: "حلويات", emoji: "🍰" },
  { key: "event", ar: "ترفيه وعروض", emoji: "🎭" },
  { key: "shopping", ar: "تسوّق", emoji: "🛍" },
  { key: "bar", ar: "بارات وروف توب", emoji: "🍸" },
];

type Prediction = {
  place_id: string;
  main_text: string;
  secondary_text: string;
  types: string[];
  rating?: number;
  review_count?: number;
  open_now?: boolean;
  price_level?: number;
  photo_reference?: string;
  icon?: string;
  icon_bg?: string;
};

const TYPE_EMOJI: Record<string, string> = {
  restaurant: "🍽", cafe: "☕", bakery: "🥐", bar: "🥂", night_club: "🪩",
  museum: "🏛", art_gallery: "🖼", tourist_attraction: "📍", landmark: "🗿",
  park: "🌳", garden: "🌷", beach: "🏖", spa: "💆", stadium: "🏟",
  shopping_mall: "🛍", store: "🛒", amusement_park: "🎢", zoo: "🦁",
  aquarium: "🐠", movie_theater: "🎬", lodging: "🏨", food: "🍴",
};

function pickEmoji(types: string[]): string {
  for (const t of types) if (TYPE_EMOJI[t]) return TYPE_EMOJI[t];
  return "📍";
}

type Status =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "results"; items: Prediction[]; cached?: boolean }
  | { phase: "added"; name: string }
  | { phase: "error"; message: string };

function newSessionToken(): string {
  // Crypto-random UUID v4 (fine for Google session billing grouping)
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback (extremely unlikely path in modern browsers)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function PlaceSearchAdd({
  cityKey,
  cityLabel,
  lat,
  lng,
}: {
  cityKey: string;
  cityLabel: string;
  lat?: number | null;
  lng?: number | null;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const [addingId, setAddingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const tokenRef = useRef<string>(newSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  // City scope — auto-detected from trip's destination, user can override.
  // Selecting a city = strict city-only Google search.
  const autoCity = useMemo(() => cityFromKey(cityKey || cityLabel), [cityKey, cityLabel]);
  const [city, setCity] = useState<CityOption | null>(autoCity ?? null);

  // Filter the city dropdown by typed text (matches Arabic name OR English key)
  const filteredCities = useMemo(() => {
    const f = cityFilter.trim().toLowerCase();
    if (!f) return CITY_OPTIONS;
    return CITY_OPTIONS.filter((c) =>
      c.ar.includes(cityFilter.trim()) ||
      c.key.toLowerCase().includes(f) ||
      c.country.toLowerCase().includes(f)
    );
  }, [cityFilter]);

  // Debounced text search (free typing)
  const fetchPredictions = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setStatus({ phase: "idle" });
      return;
    }
    setStatus({ phase: "loading" });
    const params = new URLSearchParams({
      q: query,
      token: tokenRef.current,
    });
    if (city) {
      params.set("lat", String(city.lat));
      params.set("lng", String(city.lng));
      params.set("radius", String(city.radiusKm));
      params.set("country", city.country);
      params.set("strict", "1");
    } else if (lat != null && lng != null) {
      params.set("lat", String(lat));
      params.set("lng", String(lng));
    }
    try {
      const r = await fetch(`/api/places/autocomplete?${params}`);
      const data = await r.json();
      if (data.error || !Array.isArray(data.predictions)) {
        setStatus({ phase: "error", message: data.reason ?? "تعذّر البحث" });
        return;
      }
      setStatus({ phase: "results", items: data.predictions, cached: !!data.cached });
    } catch {
      setStatus({ phase: "error", message: "فشل الاتصال" });
    }
  }, [lat, lng, city]);

  // Category browse — Nearby Search for top places of a given Google type
  const fetchByCategory = useCallback(async (catKey: string) => {
    if (!city) {
      setStatus({ phase: "error", message: "اختر مدينة أولاً" });
      return;
    }
    setStatus({ phase: "loading" });
    const params = new URLSearchParams({
      cat: catKey,
      lat: String(city.lat),
      lng: String(city.lng),
      radius: String(city.radiusKm),
    });
    try {
      const r = await fetch(`/api/places/by-category?${params}`);
      const data = await r.json();
      if (data.error || !Array.isArray(data.predictions)) {
        setStatus({ phase: "error", message: data.error ?? "تعذّر الجلب" });
        return;
      }
      setStatus({ phase: "results", items: data.predictions, cached: !!data.cached });
    } catch {
      setStatus({ phase: "error", message: "فشل الاتصال" });
    }
  }, [city]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (activeCategory) {
      // Category mode — no debounce, fetch immediately
      fetchByCategory(activeCategory);
      return;
    }
    debounceRef.current = setTimeout(() => fetchPredictions(q), 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q, city, activeCategory, fetchPredictions, fetchByCategory]);

  async function addPlace(p: Prediction) {
    setAddingId(p.place_id);
    try {
      const r = await fetch("/api/places/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_place_id: p.place_id,
          city: cityKey,
          city_label: cityLabel,
          sessiontoken: tokenRef.current,
        }),
      });
      const data = await r.json();
      if (data.error) {
        setStatus({ phase: "error", message: data.error });
        return;
      }
      // Reset token after a successful pick — new session for next add
      tokenRef.current = newSessionToken();
      setStatus({ phase: "added", name: data.place?.name ?? p.main_text });
      setQ("");
      setOpen(false);
      router.refresh(); // show the new place in the listing
      setTimeout(() => setStatus({ phase: "idle" }), 2200);
    } catch {
      setStatus({ phase: "error", message: "تعذّرت الإضافة" });
    } finally {
      setAddingId(null);
    }
  }

  const showDropdown = open && (status.phase === "loading" || status.phase === "results" || status.phase === "error");

  return (
    <section className="relative">
      <div className="bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 rounded-2xl p-3">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sky-700 font-bold text-[13px]">🔍 اكتشف وأضف أماكن</span>
          </div>
          <button
            onClick={() => setShowCityPicker((v) => !v)}
            className={`rounded-pill px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 active:scale-95 transition ${
              city
                ? "bg-sea text-white border border-sea shadow-sm"
                : "bg-white text-sky-800 border border-dashed border-sky-400 animate-pulse"
            }`}
          >
            <span className="text-base">{city ? city.flag : "🌍"}</span>
            <span>{city ? city.ar : "اختر مدينة"}</span>
            <span className="text-[9px] opacity-80">▼</span>
          </button>
        </div>
        {city && (
          <p className="text-[10.5px] text-sky-700/80 mb-2 leading-snug">
            ✓ البحث محصور في <b>{city.ar}</b> فقط · نصف قطر ≤ {city.radiusKm}كم
          </p>
        )}

        {showCityPicker && (
          <div className="bg-white border border-line rounded-xl mb-2 overflow-hidden">
            {/* Searchable filter inside the city picker */}
            <div className="p-2 border-b border-line-soft sticky top-0 bg-white z-10">
              <input
                type="text"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                autoFocus
                placeholder="🔎 ابحث عن مدينة (مثلاً: موناكو، طوكيو)..."
                className="w-full bg-stone-50 border border-line rounded-lg px-3 py-2 text-[12.5px] focus:outline-none focus:border-sea text-right"
                dir="auto"
              />
            </div>
            <div className="p-2 max-h-64 overflow-y-auto">
              {!cityFilter && (
                <>
                  <button
                    onClick={() => { setCity(null); setShowCityPicker(false); setCityFilter(""); }}
                    className={`w-full text-right px-3 py-2 rounded-lg text-[12.5px] font-bold flex items-center gap-2 ${
                      !city ? "bg-sea/10 text-sea" : "hover:bg-stone-50"
                    }`}
                  >
                    <span className="text-base">🌍</span>
                    <span>كل المدن (بدون حصر)</span>
                  </button>
                  <div className="border-t border-line-soft my-1" />
                </>
              )}
              {filteredCities.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted text-center">
                  ما لقيت مدينة. جرّب اسم تاني.
                </div>
              ) : (
                filteredCities.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => { setCity(c); setShowCityPicker(false); setCityFilter(""); }}
                    className={`w-full text-right px-3 py-2 rounded-lg text-[12.5px] font-bold flex items-center gap-2 ${
                      city?.key === c.key ? "bg-sea/10 text-sea" : "hover:bg-stone-50"
                    }`}
                  >
                    <span className="text-base">{c.flag}</span>
                    <span>{c.ar}</span>
                    {autoCity?.key === c.key && (
                      <span className="text-[10px] text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded-pill ms-auto">
                        من رحلتك
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        <div className="relative">
          <input
            type="text"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveCategory(null); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder={city ? `ابحث في ${city.ar} فقط...` : "اكتب اسم المكان (مثلاً: Dishoom، The Shard)..."}
            className="w-full bg-white border border-line rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-sea text-right"
            dir="auto"
          />
          {(q || activeCategory) && (
            <button
              onClick={() => { setQ(""); setActiveCategory(null); setStatus({ phase: "idle" }); }}
              aria-label="مسح"
              className="absolute top-1/2 left-2 -translate-y-1/2 w-6 h-6 grid place-items-center text-muted text-sm"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category chips — tap to browse top places of that type in the picked city */}
        <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {CATEGORY_CHIPS.map((c) => {
            const active = activeCategory === c.key;
            return (
              <button
                key={c.key}
                onClick={() => {
                  if (active) {
                    setActiveCategory(null);
                    setStatus({ phase: "idle" });
                  } else {
                    setQ("");
                    setActiveCategory(c.key);
                    setOpen(true);
                  }
                }}
                disabled={!city}
                className={`shrink-0 px-3 py-1.5 rounded-pill text-[12px] font-bold border transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                  active
                    ? "bg-sea text-white border-sea shadow"
                    : "bg-white text-sea border-sky-200 hover:border-sea"
                }`}
              >
                {c.emoji} {c.ar}
              </button>
            );
          })}
        </div>
        {!city && (activeCategory || q.length >= 2) && (
          <div className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            ⚠️ اختر مدينة فوق ليبحث في تصنيف معيّن
          </div>
        )}

        {status.phase === "added" && (
          <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-[12px] text-emerald-900">
            ✓ <b>{status.name}</b> أُضيف لقائمة الأماكن
          </div>
        )}
      </div>

      {showDropdown && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-line rounded-2xl shadow-lg z-30 overflow-hidden">
          {/* Cost reassurance — always show, free is the default */}
          {status.phase === "results" && status.items.length > 0 && (
            <div className="px-3 py-2 bg-emerald-50 border-b border-emerald-200 text-[10.5px] text-emerald-900 flex items-center gap-1.5 justify-between">
              <span>✓ ضمن الحد المجاني الشهري لـ Google</span>
              {status.cached && <span className="font-bold">⚡ من الذاكرة · ٠ تكلفة</span>}
            </div>
          )}
          {status.phase === "loading" && (
            <div className="px-3 py-3 space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-stone-200 shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div className="h-2.5 bg-stone-200 rounded w-2/3" />
                    <div className="h-2 bg-stone-100 rounded w-5/6" />
                    <div className="h-2 bg-stone-100 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {status.phase === "error" && (
            <div className="px-4 py-3 text-[12px] text-danger">⚠️ {status.message}</div>
          )}
          {status.phase === "results" && status.items.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-muted">ما لقيت نتائج. جرّب اسم تاني.</div>
          )}
          {status.phase === "results" && status.items.map((p) => {
            const adding = addingId === p.place_id;
            const reviewsLabel = p.review_count
              ? p.review_count >= 1000
                ? `${(p.review_count / 1000).toFixed(1)}k`
                : p.review_count.toString()
              : null;
            const kind = inferKind(p.types);
            const score = instantScore({
              rating: p.rating,
              reviewCount: p.review_count,
              openNow: p.open_now,
            });
            const scoreColor =
              score >= 85 ? "bg-emerald-500 text-white"
              : score >= 70 ? "bg-amber-500 text-white"
              : "bg-stone-400 text-white";
            const avatarStyle = p.icon_bg ? { backgroundColor: `#${p.icon_bg}` } : undefined;
            return (
              <button
                key={p.place_id}
                onClick={() => addPlace(p)}
                disabled={adding}
                className="w-full text-right px-3 py-3 border-b border-line-soft last:border-b-0 hover:bg-sky-50/30 active:bg-sky-100 disabled:opacity-50 transition-colors flex items-start gap-3 min-h-[72px]"
              >
                <div
                  className="w-12 h-12 rounded-xl shrink-0 grid place-items-center text-2xl text-white shadow-sm border border-white/40"
                  style={avatarStyle ?? { backgroundColor: "#94a3b8" }}
                >
                  {kind?.emoji ?? "📍"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="font-serif font-extrabold text-[13.5px] text-ink leading-tight line-clamp-1">
                      {p.main_text}
                    </div>
                    {p.open_now === true && (
                      <span className="text-[9.5px] font-bold text-ok bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-pill shrink-0">🟢 مفتوح</span>
                    )}
                    {p.open_now === false && (
                      <span className="text-[9.5px] font-bold text-danger bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-pill shrink-0">🔴 مغلق</span>
                    )}
                  </div>
                  {/* Kind chip — Fine Dining / Specialty Coffee / Museum / etc. */}
                  {kind && (
                    <div className="mt-1">
                      <span className="text-[10px] font-bold bg-sea/10 text-sea border border-sky-200 px-1.5 py-0.5 rounded-pill">
                        {kind.emoji} {kind.ar}
                      </span>
                    </div>
                  )}
                  {/* Written summary — generated from public signals, no API cost */}
                  <p className="text-[11px] text-ink/80 leading-snug mt-1 line-clamp-2" dir="auto">
                    {generateBlurb({
                      rating: p.rating,
                      reviewCount: p.review_count,
                      openNow: p.open_now,
                      priceLevel: p.price_level,
                      kind,
                    })}
                  </p>
                  <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-1 text-[11px]">
                    {p.rating != null && (
                      <span className="font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-pill">
                        ⭐ {p.rating.toFixed(1)}
                        {reviewsLabel && <span className="text-muted font-normal"> · {reviewsLabel}</span>}
                      </span>
                    )}
                    {p.price_level != null && p.price_level > 0 && (
                      <span className="text-muted">{"€".repeat(Math.min(4, p.price_level))}</span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-muted truncate mt-1" dir="auto">
                    📍 {p.secondary_text}
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-center gap-1.5 self-center">
                  {/* Instant decision score */}
                  <span
                    className={`w-9 h-9 rounded-full grid place-items-center text-[12px] font-extrabold shadow-sm ${scoreColor}`}
                    title="درجة الجودة (0-100) من تقييم Google والمراجعات"
                  >
                    {score}
                  </span>
                  <span className={`w-9 h-9 rounded-full grid place-items-center text-base font-bold transition ${
                    adding ? "bg-stone-200 text-stone-500 animate-pulse" : "bg-coral text-white shadow-md"
                  }`}>
                    {adding ? "⏳" : "＋"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Click-outside closer */}
      {showDropdown && (
        <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
      )}
    </section>
  );
}
