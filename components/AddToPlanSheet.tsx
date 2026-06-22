"use client";

// Bottom sheet for "+ أضف لـ [مرحلة]" — shows local catalog suggestions
// AND offers Google Maps search inline when the user types something the
// catalogue doesn't have. One sheet, both flows, no tab switching.

import { useState, useMemo, useEffect, useRef } from "react";
import type { Place, Slot } from "@/lib/supabase/database.types";
import { decide } from "@/lib/decision/engine";
import { instantScore, scoreVerdict } from "@/lib/google/inferKind";
import { getCategoryDisplay, getKindDisplay } from "@/lib/highlights";
import { cityFromKey, type CityOption } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";
import DiscoverFilterBar from "@/components/DiscoverFilterBar";
import { applyFilters, type DiscoverFilterId, type FilterContext } from "@/lib/discover/filters";

type GooglePrediction = {
  place_id: string;
  main_text: string;
  secondary_text: string;
  types: string[];
  rating?: number;
  review_count?: number;
  open_now?: boolean;
  price_level?: number;
  photo_reference?: string;
};

function newSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type PhaseDef = {
  key: string;
  ar: string;
  emoji: string;
  slots: Slot[];
  preferredCategory?: Place["category"][];
};

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

export default function AddToPlanSheet({
  open,
  onClose,
  phase,
  catalogue,
  usedPlaceIds,
  hotelLocation,
  tripId,
  cityKey,
  cityLabel,
  savedSet = new Set(),
  onAdd,
  onAddFromGoogle,
  isBusy,
}: {
  open: boolean;
  onClose: () => void;
  phase: PhaseDef | null;
  catalogue: Place[];
  usedPlaceIds: Set<string>;
  hotelLocation: { lat: number; lng: number } | null;
  tripId: string;
  cityKey: string;
  cityLabel: string;
  savedSet?: Set<string>;
  onAdd: (place: Place) => void | Promise<void>;
  onAddFromGoogle: (googlePlaceId: string, displayName: string) => void | Promise<void>;
  isBusy: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<DiscoverFilterId>>(new Set());
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [googleResults, setGoogleResults] = useState<GooglePrediction[]>([]);
  const [googlePhase, setGooglePhase] = useState<"idle"|"loading"|"done"|"empty"|"error">("idle");
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [addingFromGoogle, setAddingFromGoogle] = useState<string | null>(null);
  const tokenRef = useRef<string>(newSessionToken());
  const city: CityOption | null = useMemo(() => cityFromKey(cityKey || cityLabel) ?? null, [cityKey, cityLabel]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      setShowAll(false);
      setActiveFilters(new Set());
      setActiveCity(null);
      setGoogleResults([]);
      setGooglePhase("idle");
      setGoogleError(null);
      tokenRef.current = newSessionToken();
    }
  }, [open]);

  // Filter context for DiscoverFilterBar — pinned to mount so chip results
  // don't flicker as the user types.
  const mountNowRef = useRef<Date | null>(null);
  if (mountNowRef.current === null) mountNowRef.current = new Date();
  const filterCtx: FilterContext = useMemo(
    () => ({ savedSet, now: mountNowRef.current!, hotel: hotelLocation }),
    [savedSet, hotelLocation],
  );

  // Reset Google results when filter changes
  useEffect(() => {
    setGoogleResults([]);
    setGooglePhase("idle");
  }, [filter]);

  async function searchGoogle() {
    if (!filter.trim() || filter.trim().length < 2) return;
    setGooglePhase("loading");
    setGoogleError(null);
    const params = new URLSearchParams({ q: filter.trim(), token: tokenRef.current });
    if (city) {
      params.set("lat", String(city.lat));
      params.set("lng", String(city.lng));
      params.set("radius", String(city.radiusKm));
      params.set("country", city.country);
      params.set("strict", "1");
    }
    try {
      const r = await fetch(`/api/places/autocomplete?${params}`);
      const data = await r.json();
      if (data.error || !Array.isArray(data.predictions)) {
        setGooglePhase("error");
        setGoogleError(data.reason ?? "تعذّر البحث");
        return;
      }
      const list = data.predictions as GooglePrediction[];
      setGoogleResults(list);
      setGooglePhase(list.length === 0 ? "empty" : "done");
    } catch {
      setGooglePhase("error");
      setGoogleError("فشل الاتصال");
    }
  }

  async function handleGoogleTap(p: GooglePrediction) {
    setAddingFromGoogle(p.place_id);
    try {
      await onAddFromGoogle(p.place_id, p.main_text);
    } finally {
      setAddingFromGoogle(null);
    }
  }

  const ranked = useMemo(() => {
    if (!phase) return [];
    const now = new Date();
    // Eligible = not already in plan
    let pool = catalogue.filter((p) => !usedPlaceIds.has(p.id));
    // City scope — single-select, exclusive.
    if (activeCity) {
      pool = pool.filter((p) => (p.city_label ?? p.city) === activeCity);
    }
    // By default narrow to the phase's preferred categories — only if no
    // explicit category chip is active (those override the phase scoping).
    const hasCategoryChip = Array.from(activeFilters).some((id) => id.startsWith("cat_"));
    if (!showAll && !hasCategoryChip && phase.preferredCategory && phase.preferredCategory.length > 0) {
      pool = pool.filter((p) => phase.preferredCategory!.includes(p.category));
    }
    // Apply Discover-style filter chips (categories/quality/meal/vibe).
    if (activeFilters.size > 0) {
      pool = applyFilters(pool, activeFilters, filterCtx);
    }
    // Apply text filter (Arabic name OR English name OR city_label)
    const f = filter.trim().toLowerCase();
    if (f.length > 0) {
      pool = pool.filter((p) =>
        p.name.toLowerCase().includes(f) ||
        (p.city_label ?? "").toLowerCase().includes(f) ||
        (p.kind ?? "").toLowerCase().includes(f),
      );
    }
    // Rank by decision confidence
    return pool
      .map((p) => ({
        place: p,
        decision: decide(p, {
          now,
          currentLocation: null,
          hotelLocation,
          preferenceMode: null,
        }),
      }))
      .sort((a, b) => b.decision.confidence - a.decision.confidence)
      .slice(0, 30);
  }, [phase, catalogue, usedPlaceIds, showAll, filter, hotelLocation, activeFilters, filterCtx, activeCity]);

  // Eligible pool (before chips) — feeds the DiscoverFilterBar so chip counts
  // reflect the candidates the user is actually choosing from.
  const eligibleForChips = useMemo(() => {
    if (!phase) return [] as Place[];
    return catalogue.filter((p) => !usedPlaceIds.has(p.id));
  }, [catalogue, usedPlaceIds, phase]);

  if (!open || !phase) return null;

  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-sand w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88dvh] overscroll-contain flex flex-col animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-sand pt-3 pb-2 px-4 border-b border-line rounded-t-3xl">
          <div className="w-12 h-1.5 bg-ink/20 rounded-full mx-auto mb-2" />
          <div className="flex items-center justify-between">
            <h2 className="font-serif font-extrabold text-base">
              {phase.emoji} أضف لـ {phase.ar}
            </h2>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-11 h-11 grid place-items-center bg-white border border-line rounded-full font-bold text-lg"
            >
              ✕
            </button>
          </div>

          {/* Search input — local catalog first, Google on demand */}
          <div className="mt-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`ابحث... ${city ? `(محليّاً أو في ${city.ar})` : "في كتالوج رحلتك"}`}
              className="w-full bg-white border border-line rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-sea text-right"
              dir="auto"
            />
          </div>

          {/* Toggle: phase categories only vs all — hidden when a category
              chip is active, since the chip overrides the phase scoping. */}
          {phase.preferredCategory && phase.preferredCategory.length > 0 &&
            !Array.from(activeFilters).some((id) => id.startsWith("cat_")) && (
            <div className="mt-2 flex items-center gap-2 text-[11px]">
              <button
                onClick={() => setShowAll(false)}
                className={`px-2.5 py-1 rounded-pill font-bold border ${
                  !showAll ? "bg-sea text-white border-sea" : "bg-white text-sea border-line"
                }`}
              >
                مناسب لـ {phase.ar}
              </button>
              <button
                onClick={() => setShowAll(true)}
                className={`px-2.5 py-1 rounded-pill font-bold border ${
                  showAll ? "bg-sea text-white border-sea" : "bg-white text-sea border-line"
                }`}
              >
                كل الأماكن
              </button>
            </div>
          )}

          {/* Full Discover-style filter bar */}
          <div className="mt-2">
            <DiscoverFilterBar
              places={eligibleForChips}
              active={activeFilters}
              onChange={setActiveFilters}
              ctx={filterCtx}
              activeCity={activeCity}
              onCityChange={setActiveCity}
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {ranked.length === 0 && googleResults.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-muted text-sm leading-relaxed">
                {filter.trim().length >= 2
                  ? `ما لقيت "${filter.trim()}" في كتالوج رحلتك.`
                  : activeFilters.size > 0
                  ? "ما في مكان يطابق الفلاتر المختارة."
                  : "اكتب اسم المكان للبحث."}
              </p>
              {activeFilters.size > 0 && (
                <button
                  onClick={() => setActiveFilters(new Set())}
                  className="mt-3 bg-coral text-white font-bold text-[12.5px] px-4 py-2 rounded-pill active:scale-95"
                >
                  ✕ مسح الفلاتر
                </button>
              )}
            </div>
          ) : (
            <>
              {ranked.map(({ place, decision }) => {
                const cat = getCategoryDisplay(place.category);
                const kind = getKindDisplay(place.kind);
                const score = instantScore({ rating: place.rating, reviewCount: place.review_count });
                const verdict = scoreVerdict(score, place.category);
                return (
                  <button
                    key={place.id}
                    onClick={() => onAdd(place)}
                    disabled={isBusy}
                    className="w-full text-right bg-white rounded-xl border border-line p-3 flex items-center gap-3 active:bg-stone-50 disabled:opacity-50 transition"
                  >
                    <div className={`w-12 h-12 rounded-xl shrink-0 overflow-hidden grid place-items-center text-xl ${
                      place.photo_url ? "bg-stone-200" : "bg-stone-100"
                    }`}>
                      {place.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoAtWidth(place.photo_url, 240) ?? undefined} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        cat.emoji
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13px] text-ink leading-tight line-clamp-1">{place.name}</div>
                      <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                        <span className={`${cat.bg} ${cat.fg} text-[10px] font-extrabold px-1.5 py-0.5 rounded-pill`}>
                          {cat.emoji} {cat.ar}
                        </span>
                        {kind && (
                          <span className="bg-sea/10 text-sea text-[9.5px] font-bold px-1.5 py-0.5 rounded-pill">
                            {kind.emoji} {kind.ar}
                          </span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-muted mt-1 flex flex-wrap items-center gap-x-2">
                        {place.rating != null && (<span>★ {place.rating.toFixed(1)}</span>)}
                        {place.city_label && (<span>📍 {place.city_label}</span>)}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-center gap-1"
                      title={decision.ar}
                    >
                      <div className={`${verdict.gradientBg} ${verdict.textColor} px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1`}>
                        <span className="text-[9.5px] font-extrabold leading-none">{verdict.ar}</span>
                        <span className="opacity-50 text-[8px]">·</span>
                        <span className="text-[10px] font-bold leading-none">{score}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {/* ─── Google search section (always rendered when filter is meaningful) ── */}
          {filter.trim().length >= 2 && googlePhase !== "loading" && googleResults.length === 0 && (
            <button
              onClick={searchGoogle}
              disabled={isBusy}
              className="w-full mt-2 bg-gradient-to-br from-sky-500 to-sea text-white font-bold text-[12.5px] py-3 rounded-xl shadow active:scale-[0.98] disabled:opacity-50 transition"
            >
              🔍 ابحث في Google Maps عن &quot;{filter.trim()}&quot;
              {city && <span className="opacity-90 font-normal"> في {city.flag} {city.ar}</span>}
            </button>
          )}

          {googlePhase === "loading" && (
            <div className="mt-2 space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-start gap-3 animate-pulse bg-white border border-line rounded-xl p-3">
                  <div className="w-12 h-12 rounded-xl bg-stone-200 shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div className="h-2.5 bg-stone-200 rounded w-2/3" />
                    <div className="h-2 bg-stone-100 rounded w-5/6" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {googlePhase === "error" && (
            <div className="mt-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-[12px] text-rose-900">
              ⚠️ {googleError}
              <button onClick={searchGoogle} className="block w-full mt-1.5 bg-sea text-white text-[11px] font-bold py-1.5 rounded-lg">
                إعادة المحاولة
              </button>
            </div>
          )}

          {googlePhase === "empty" && (
            <div className="mt-2 text-center py-4 text-[12px] text-muted">
              ما لقى Google أماكن لـ &quot;{filter.trim()}&quot; في {city?.ar ?? "هذا النطاق"}.
            </div>
          )}

          {googleResults.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between">
                <span>🌐 من Google Maps</span>
                <span className="text-[10px] text-emerald-700/70">اضغط لإضافة</span>
              </div>
              {googleResults.map((g) => {
                const score = instantScore({ rating: g.rating, reviewCount: g.review_count, openNow: g.open_now });
                const verdict = scoreVerdict(score, phase?.preferredCategory?.[0]);
                const reviewsLabel = g.review_count
                  ? g.review_count >= 1000 ? `${(g.review_count / 1000).toFixed(1)}k` : `${g.review_count}`
                  : null;
                const adding = addingFromGoogle === g.place_id;
                return (
                  <button
                    key={g.place_id}
                    onClick={() => handleGoogleTap(g)}
                    disabled={adding || isBusy}
                    className="w-full text-right bg-white rounded-xl border border-emerald-200 p-3 flex items-center gap-3 active:bg-emerald-50 disabled:opacity-50 transition"
                  >
                    <div className="w-12 h-12 rounded-xl bg-emerald-100 grid place-items-center text-xl shrink-0">
                      🌐
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="font-bold text-[13px] text-ink leading-tight line-clamp-1">{g.main_text}</div>
                        {g.open_now === true && (
                          <span className="text-[9px] font-bold text-ok bg-emerald-50 border border-emerald-200 px-1.5 rounded-pill">🟢 مفتوح</span>
                        )}
                        {g.open_now === false && (
                          <span className="text-[9px] font-bold text-danger bg-rose-50 border border-rose-200 px-1.5 rounded-pill">🔴 مغلق</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2">
                        {g.rating != null && (
                          <span className="font-bold text-amber-700">
                            ⭐ {g.rating.toFixed(1)}
                            {reviewsLabel && <span className="font-normal text-muted"> · {reviewsLabel}</span>}
                          </span>
                        )}
                        {g.price_level != null && g.price_level > 0 && (
                          <span className="text-muted">{"€".repeat(Math.min(4, g.price_level))}</span>
                        )}
                      </div>
                      <div className="text-[10.5px] text-muted truncate mt-0.5" dir="auto">
                        {g.secondary_text}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-center gap-1">
                      {adding ? (
                        <span className="bg-stone-300 text-white w-9 h-9 rounded-full grid place-items-center text-[12px] font-extrabold animate-pulse">⏳</span>
                      ) : (
                        <div className={`${verdict.gradientBg} ${verdict.textColor} px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1`}>
                          <span className="text-[9.5px] font-extrabold leading-none">{verdict.ar}</span>
                          <span className="opacity-50 text-[8px]">·</span>
                          <span className="text-[10px] font-bold leading-none">{score}</span>
                        </div>
                      )}
                      <span className="text-[8.5px] text-muted font-bold">
                        {adding ? "يضيف" : "أضف"}
                      </span>
                    </div>
                  </button>
                );
              })}
              <p className="text-[10px] text-muted text-center mt-1">
                ✓ ضمن الحد المجاني الشهري لـ Google
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
