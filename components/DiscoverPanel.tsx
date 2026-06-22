"use client";

// "اكتشف" tab — search + browse + scored catalogue for the trip's region.
// Reuses existing PlaceSearchAdd + PlaceCard components. Scoring computed
// client-side from user history (fast, no extra Google calls).

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ItineraryDay, ItineraryItem, Place, Trip } from "@/lib/supabase/database.types";
import PlaceCard, { type PlaceCardAddedInfo } from "@/components/PlaceCard";
import { allOfferings } from "@/lib/discover/offerings";
import PlaceSearchAdd from "@/components/PlaceSearchAdd";
import AutoWarmup from "@/components/AutoWarmup";
import DiscoverFilterBar from "@/components/DiscoverFilterBar";
import dynamic from "next/dynamic";

// Heavy detail sheet — lazy-loaded so it never ships with the discover-tab
// chunk. Used by the inline place cards.
const PlaceDetailSheet = dynamic(() => import("@/components/PlaceDetailSheet"), {
  ssr: false,
});
import { computeSmartScore } from "@/lib/scoring/smartScore";
import type { UserTaste } from "@/lib/scoring/userTaste";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import { haversineKm } from "@/lib/utils";
import {
  applyFilters,
  type DiscoverFilterId,
} from "@/lib/discover/filters";

// Initial cards rendered + page size on "load more". With 200+ places this
// keeps the first paint under ~150ms even on mid-tier phones.
const PAGE_SIZE = 24;

export default function DiscoverPanel({
  trip,
  catalogue,
  savedSet,
  hiddenSet = new Set(),
  userRatings,
  userVerdicts,
  userTaste,
  days = [],
  items = [],
}: {
  trip: Trip;
  catalogue: Place[];
  savedSet: Set<string>;
  hiddenSet?: Set<string>;
  userRatings: Map<string, { stars: number | null; verdict: "love" | "meh" | "skip" | null }>;
  userVerdicts?: Map<string, "love" | "meh" | "skip">; // kept for forward-compat
  userTaste: UserTaste | null;
  /** Pass trip's days + items so QuickAddPicker can suggest empty slots */
  days?: ItineraryDay[];
  items?: ItineraryItem[];
}) {
  void userVerdicts;

  const [activeFilters, setActiveFilters] = useState<Set<DiscoverFilterId>>(new Set());
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /** When set, PlaceDetailSheet renders as a modal over whichever view the
   *  user is in — opened by the map's "تفاصيل" CTA. */
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  /** Saved IDs (server-truth) are passed in via prop; we keep a local diff so
   *  toggling save from the detail sheet feels instant without a refresh. */
  const [savedDelta, setSavedDelta] = useState<Map<string, boolean>>(new Map());
  /** Once-per-mount auto-detect of the closest city to user location. */
  const cityAutoSetRef = useRef(false);

  // Highlight a card briefly when navigated to from elsewhere (currently
  // only used by the legacy inline-map flow; harmless when unused).
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`place-card-${highlightId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);
  // Defer filter state so toggling chips never blocks the UI thread
  const deferredFilters = useDeferredValue(activeFilters);

  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);

  // Page-level snackbar shown after a successful quick-add
  const [toast, setToast] = useState<PlaceCardAddedInfo | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const hotelLoc = useMemo(
    () => (trip.hotel_lat != null && trip.hotel_lng != null
      ? { lat: trip.hotel_lat, lng: trip.hotel_lng } : null),
    [trip.hotel_lat, trip.hotel_lng],
  );

  // ── Geolocation — "اعرض لي الأقرب" ─────────────────────────────────────────
  const geo = useGeoLocation();
  const userLoc = useMemo(
    () => (geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng } : null),
    [geo.coords],
  );

  // Compute smart scores once, memoised — keyed on the FULL catalogue so the
  // expensive scoring runs once even when filters change.
  const scored = useMemo(() => {
    const tripPrefs = (trip.preferences as { categories?: string[] } | null)?.categories;
    return catalogue
      .map((p) => {
        const r = userRatings.get(p.id);
        const { score, reasonAr } = computeSmartScore(p, {
          hotelLocation: hotelLoc,
          userLocation: userLoc,
          budgetStyle: trip.budget_style,
          userSaved: savedSet.has(p.id),
          userRating: r?.stars ?? null,
          userVerdict: r?.verdict ?? null,
          preferredCategories: tripPrefs,
          userTaste,
        });
        return { p, score, reasonAr, saved: savedSet.has(p.id) };
      })
      .sort((a, b) => b.score - a.score);
  }, [catalogue, savedSet, userRatings, hotelLoc, userLoc, trip.budget_style, trip.preferences, userTaste]);

  // Stable Place[] slice — both filter bar and applyFilters need this; computing
  // it once avoids two passes.
  const placeList = useMemo(() => scored.map((s) => s.p), [scored]);

  // Same slice, but narrowed to the active city — this is what the filter bar
  // counts against so chip badges show the city-scoped totals (otherwise
  // "Cafe (600)" appears next to Monaco that only has 29 cafes).
  const cityScopedPlaces = useMemo(() => {
    if (!activeCity) return placeList;
    return placeList.filter((p) => (p.city_label ?? p.city) === activeCity);
  }, [placeList, activeCity]);

  // Auto-detect the closest city to user location — runs ONCE when location
  // arrives, only if the user hasn't already picked a city. Within 30 km the
  // detected city is auto-selected; further out we don't guess.
  useEffect(() => {
    if (cityAutoSetRef.current || activeCity || !userLoc || placeList.length === 0) return;
    let closest: string | null = null;
    let minKm = Infinity;
    const seen = new Set<string>();
    for (const p of placeList) {
      const label = (p.city_label ?? p.city ?? "").trim();
      if (!label || seen.has(label) || p.lat == null || p.lng == null) continue;
      seen.add(label);
      const km = haversineKm(userLoc, { lat: p.lat, lng: p.lng });
      if (km < minKm) { minKm = km; closest = label; }
    }
    if (closest && minKm < 30) {
      setActiveCity(closest);
    }
    cityAutoSetRef.current = true;
  }, [userLoc, activeCity, placeList]);

  // Memoize the offerings per place across the catalogue. allOfferings does
  // tag parsing + hour windowing + meal inference — running it once per place
  // (rather than once per render inside every PlaceCard) saves 100ms+ on
  // catalogues of 200+ places.
  const offeringsCache = useMemo(() => {
    const map = new Map<string, ReturnType<typeof allOfferings>>();
    for (const p of placeList) map.set(p.id, allOfferings(p));
    return map;
  }, [placeList]);

  // Apply user-selected filters on top of the scored list. Use the deferred
  // filter set so rapid chip toggles stay snappy.
  const mountNowRef = useRef<Date | null>(null);
  if (mountNowRef.current === null) mountNowRef.current = new Date();
  const filterCtx = useMemo(
    () => ({ savedSet, now: mountNowRef.current!, hotel: hotelLoc }),
    [savedSet, hotelLoc],
  );
  const visible = useMemo(() => {
    let pool = scored;
    if (activeCity) {
      pool = pool.filter((s) => (s.p.city_label ?? s.p.city) === activeCity);
    }
    // Hide places the user dismissed — unless they explicitly asked to see
    // them via the "🙈 المخفية" toggle.
    pool = showHidden
      ? pool.filter((s) => hiddenSet.has(s.p.id))
      : pool.filter((s) => !hiddenSet.has(s.p.id));
    if (deferredFilters.size > 0) {
      const kept = new Set(applyFilters(pool.map((s) => s.p), deferredFilters, filterCtx).map((p) => p.id));
      pool = pool.filter((s) => kept.has(s.p.id));
    }
    // PROXIMITY-FIRST when geo is granted AND the user is within 50km of any
    // result (i.e., they're actually in the trip city). Tie-break by score
    // so quality still wins between two places at similar distance.
    if (userLoc && pool.length > 0) {
      const nearestKm = Math.min(
        ...pool
          .filter((s) => s.p.lat != null && s.p.lng != null)
          .map((s) => haversineKm(userLoc, { lat: s.p.lat!, lng: s.p.lng! })),
      );
      if (nearestKm < 50) {
        return [...pool].sort((a, b) => {
          const dA = a.p.lat != null && a.p.lng != null
            ? haversineKm(userLoc, { lat: a.p.lat, lng: a.p.lng })
            : Infinity;
          const dB = b.p.lat != null && b.p.lng != null
            ? haversineKm(userLoc, { lat: b.p.lat, lng: b.p.lng })
            : Infinity;
          // Bucket distance into 0.5km bands so within a band, score still wins
          const bandA = Math.floor(dA * 2);
          const bandB = Math.floor(dB * 2);
          if (bandA !== bandB) return bandA - bandB;
          return b.score - a.score;
        });
      }
    }
    return pool;
  }, [scored, deferredFilters, filterCtx, activeCity, showHidden, hiddenSet, userLoc]);

  // Reset the page window when the filtered set changes
  useEffect(() => { setPageLimit(PAGE_SIZE); }, [deferredFilters, activeCity]);

  // IntersectionObserver auto-loads the next page when the user scrolls
  // near the bottom — no "load more" button to tap.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const visibleLen = visible.length;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPageLimit((n) => Math.min(n + PAGE_SIZE, visibleLen));
        }
      },
      { rootMargin: "400px" }, // start loading before sentinel is fully visible
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible.length]);

  const pageItems = useMemo(() => visible.slice(0, pageLimit), [visible, pageLimit]);

  return (
    <div className="space-y-3">
      {/* Snackbar — confirms add + offers a jump to the plan */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[60] w-[92%] max-w-sm" style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}>
          <div role="status" aria-live="polite" className="bg-emerald-900 text-white rounded-2xl shadow-xl px-3.5 py-2.5 flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-2">
            <span className="text-xl">✓</span>
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-bold leading-tight line-clamp-1">{toast.placeName}</div>
              <div className="text-[11px] text-emerald-100 mt-0.5">
                مضاف لـ {toast.dayLabel} · {toast.phaseEmoji} {toast.phaseLabel}
              </div>
            </div>
            <a
              href={`/trips/${trip.id}`}
              className="bg-white text-emerald-900 text-[11px] font-extrabold px-2.5 py-1 rounded-pill shrink-0"
            >
              افتح الخطة ←
            </a>
            <button
              onClick={() => setToast(null)}
              aria-label="إغلاق"
              className="w-11 h-11 grid place-items-center text-emerald-200 hover:text-white text-base shrink-0 -mr-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Search & add (city picker + categories built-in) */}
      <PlaceSearchAdd
        cityKey={trip.destination_city ?? ""}
        cityLabel={trip.destination_city ?? ""}
        lat={trip.hotel_lat ?? null}
        lng={trip.hotel_lng ?? null}
      />

      {/* AutoWarmup status (silent if blocked) */}
      <AutoWarmup tripId={trip.id} />

      {/* Geolocation banner — opt-in. Shows when user hasn't enabled, and
          turns into a confirmation chip when granted. Zero API cost. */}
      <div className="mt-2">
        {geo.status === "granted" && geo.coords ? (
          <div className="flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-3 py-2 text-[11.5px]">
            <div className="flex items-center gap-2">
              <span className="text-base">📍</span>
              <span className="font-extrabold">موقعك مفعّل · الاقتراحات تعتمد على المسافة</span>
            </div>
            <button
              onClick={geo.clear}
              className="text-emerald-700 underline font-bold active:scale-95"
              title="ألغِ تتبع الموقع"
            >
              إلغاء
            </button>
          </div>
        ) : geo.status === "denied" ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-3 py-2 text-[11.5px]">
            ⚠️ السماح بالموقع مرفوض. فعّله من شريط العنوان في المتصفّح لاقتراحات أدق.
          </div>
        ) : geo.status === "unsupported" ? null : (
          <button
            onClick={geo.request}
            disabled={geo.status === "asking"}
            className="w-full bg-gradient-to-r from-sea/10 to-emerald-50 border border-sea/30 text-sea rounded-xl px-3 py-2.5 flex items-center justify-between min-h-[44px] active:scale-[0.99] transition disabled:opacity-60"
          >
            <span className="text-[12px] font-extrabold flex items-center gap-2">
              <span className="text-base">📍</span>
              <span>{geo.status === "asking" ? "يحدّد موقعك..." : "شارك موقعك للاقتراحات الأقرب"}</span>
            </span>
            <span className="text-[10.5px] font-bold opacity-70">مجاناً ٠٪ تكلفة</span>
          </button>
        )}
      </div>

      {/* Smart filter bar — sticky under the search */}
      {scored.length > 0 && (
        <DiscoverFilterBar
          places={cityScopedPlaces}
          allPlaces={placeList}
          active={activeFilters}
          onChange={setActiveFilters}
          ctx={filterCtx}
          activeCity={activeCity}
          onCityChange={setActiveCity}
        />
      )}

      {/* Quick link to the full-screen map. Opens a dedicated route with
          richer filtering + controls (separate from this scrolling list). */}
      {scored.length > 0 && (
        <a
          href={`/trips/${trip.id}/map`}
          className="mt-2 mb-3 inline-flex items-center justify-between gap-2 bg-stone-900 text-white rounded-2xl p-3 shadow-md active:scale-[0.98] transition"
        >
          <div className="flex items-center gap-2">
            <span className="text-xl">🗺</span>
            <div>
              <div className="font-bold text-[13.5px]">افتح الخريطة</div>
              <div className="text-[11px] opacity-85">شف {visible.length} مكان على خريطة كاملة</div>
            </div>
          </div>
          <span className="font-bold text-lg">←</span>
        </a>
      )}

      {/* Scored place cards (list view) — full-screen map lives at
          /trips/[tripId]/map (see the link above). */}
      {scored.length === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-center">
          <p className="text-muted text-sm">
            ما في أماكن بعد. ابحث بالأعلى أو اضغط أي تصنيف.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-center">
          <div className="text-4xl mb-2">🔍</div>
          <p className="text-muted text-sm mb-3">
            ما في مكان يطابق الفلاتر المختارة.
          </p>
          <button
            onClick={() => setActiveFilters(new Set())}
            className="bg-coral text-white font-bold text-[12.5px] px-4 py-2 rounded-pill active:scale-95"
          >
            ✕ مسح الفلاتر
          </button>
        </div>
      ) : (
        <>
          {/* Hidden-places toggle — only render when the user has actually
              hidden anything; otherwise the chip is noise. */}
          {hiddenSet.size > 0 && (
            <button
              onClick={() => setShowHidden((v) => !v)}
              className={`text-[12px] font-bold px-3 py-2 rounded-pill border transition active:scale-95 min-h-[40px] inline-flex items-center gap-1.5 ${
                showHidden
                  ? "bg-stone-800 text-white border-stone-800 shadow"
                  : "bg-white text-stone-700 border-stone-300 hover:border-stone-500"
              }`}
              aria-pressed={showHidden}
            >
              🙈
              <span>{showHidden ? "أرجع المخفي للوضع الافتراضي" : `أظهر المخفية (${hiddenSet.size})`}</span>
            </button>
          )}
          <div className="space-y-3">
            {pageItems.map(({ p, score, reasonAr, saved }) => (
              <div
                key={p.id}
                id={`place-card-${p.id}`}
                className={highlightId === p.id ? "ring-4 ring-coral/40 rounded-3xl transition-shadow" : ""}
              >
                <PlaceCard
                  place={p}
                  tripId={trip.id}
                  score={score}
                  reasonAr={reasonAr}
                  initiallySaved={saved}
                  initiallyHidden={hiddenSet.has(p.id)}
                  hotel={hotelLoc ? { ...hotelLoc, name: trip.hotel_name ?? "فندقك" } : null}
                  userLocation={userLoc}
                  days={days}
                  items={items}
                  onAdded={setToast}
                  precomputedOfferings={offeringsCache.get(p.id)}
                  catalogue={placeList}
                />
              </div>
            ))}
          </div>
          {visible.length > pageLimit && (
            <div ref={sentinelRef} className="py-6 text-center text-[12px] text-muted">
              <div className="inline-flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-stone-300 border-t-coral animate-spin" />
                <span>تحميل المزيد… ({pageLimit} من {visible.length})</span>
              </div>
            </div>
          )}
          {visible.length > 0 && visible.length === pageLimit && pageLimit > PAGE_SIZE && (
            <div className="py-4 text-center text-[11px] text-muted">
              ✓ عرضت كل النتائج ({visible.length})
            </div>
          )}
        </>
      )}

      {/* Detail modal — opens over the map (or list) when user taps "تفاصيل"
          on a marker popup. Closing returns them to whichever view they had. */}
      {detailPlace && (
        <PlaceDetailSheet
          place={detailPlace}
          hotel={hotelLoc ? { ...hotelLoc, name: trip.hotel_name ?? "فندقك" } : null}
          onClose={() => setDetailPlace(null)}
          onSave={async () => {
            const isSaved = savedDelta.get(detailPlace.id) ?? savedSet.has(detailPlace.id);
            // optimistic flip + rollback on error
            setSavedDelta((m) => new Map(m).set(detailPlace.id, !isSaved));
            try {
              const r = await fetch(`/api/trips/${trip.id}/places`, {
                method: isSaved ? "DELETE" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ place_id: detailPlace.id }),
              });
              if (!r.ok) setSavedDelta((m) => new Map(m).set(detailPlace.id, isSaved));
            } catch {
              setSavedDelta((m) => new Map(m).set(detailPlace.id, isSaved));
            }
          }}
          saved={savedDelta.get(detailPlace.id) ?? savedSet.has(detailPlace.id)}
          onAddToPlan={() => {
            setDetailPlace(null);
            // Reuse the trip page's existing add-to-plan flow
            window.location.href = `/trips/${trip.id}?add=${detailPlace.id}`;
          }}
          catalogue={placeList}
        />
      )}
    </div>
  );
}
