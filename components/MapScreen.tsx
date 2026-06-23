"use client";

// Full-screen interactive map for one trip. Reuses DiscoverMap for rendering
// (markers, clustering, pins) but lays out controls and filters around it for
// a dedicated map experience.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Place, Trip, ItineraryDay } from "@/lib/supabase/database.types";
import type { PlanItemRow } from "@/app/trips/[tripId]/map/page";
import {
  applyFilters, countPerFilter,
  type DiscoverFilterId, type FilterContext,
} from "@/lib/discover/filters";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import { haversineKm } from "@/lib/utils";
import MapBottomCarousel, { type SortMode } from "@/components/MapBottomCarousel";
import { computeSmartScore } from "@/lib/scoring/smartScore";

const DiscoverMap = dynamic(() => import("@/components/DiscoverMap"), {
  ssr: false,
  loading: () => (
    // Skeleton instead of spinner — instant premium feel. Mimics the final
    // layout: map area + 3 carousel ghost cards at the bottom.
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-stone-100 via-stone-50 to-stone-200 animate-pulse" />
      <div className="absolute inset-x-3 bottom-3 flex gap-2 overflow-hidden pointer-events-none">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-[160px] h-[210px] shrink-0 bg-white/70 rounded-2xl animate-pulse"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  ),
});
const PlaceDetailSheet = dynamic(() => import("@/components/PlaceDetailSheet"), {
  ssr: false,
  loading: () => (
    // Full-sheet skeleton — mimics the final layout so the transition feels
    // continuous. No spinner — premium apps don't show spinners on sheets.
    <div className="fixed inset-0 z-[1100] bg-black/40 flex items-end" role="status" aria-live="polite">
      <div className="bg-sand w-full max-w-2xl mx-auto rounded-t-3xl h-[80vh] p-5 space-y-3 shadow-2xl">
        <div className="w-12 h-1 bg-stone-300 rounded-full mx-auto" />
        <div className="aspect-[16/9] bg-stone-200 rounded-2xl animate-pulse" />
        <div className="h-7 w-2/3 bg-stone-200 rounded animate-pulse" />
        <div className="h-4 w-1/3 bg-stone-200 rounded animate-pulse" />
        <div className="space-y-2 pt-3">
          <div className="h-3.5 w-full bg-stone-200 rounded animate-pulse" />
          <div className="h-3.5 w-5/6 bg-stone-200 rounded animate-pulse" />
        </div>
      </div>
    </div>
  ),
});
// Lazy — only loaded when the user taps "+ من رابط".
const AddPlaceFromUrlSheet = dynamic(() => import("@/components/AddPlaceFromUrlSheet"), {
  ssr: false,
});

// ─── Map-focused filter chips ────────────────────────────────────────────
// Curated, map-friendly subset of DiscoverFilterBar's catalog. The full
// 53-chip taxonomy lives behind "⚙ فلاتر أكثر".
type Chip = { id: DiscoverFilterId; ar: string; emoji: string };

const CATEGORY_CHIPS: Chip[] = [
  { id: "cat_food",   ar: "مطاعم",        emoji: "🍽" },
  { id: "cat_coffee", ar: "قهاوي",        emoji: "☕" },
  { id: "cat_sweet",  ar: "حلويات",       emoji: "🍰" },
  { id: "cat_sight",  ar: "معالم",        emoji: "🏛" },
  { id: "cat_nature", ar: "طبيعة",        emoji: "🌿" },
  { id: "cat_event",  ar: "ترفيه",        emoji: "🎭" },
  { id: "cat_bar",    ar: "بارات وروف",   emoji: "🍸" },
];

// The primary visible filter row per UX spec.
// Order matters — first chip on RTL is rightmost = first visible.
const PRIMARY_FILTER_CHIPS: Chip[] = [
  // 🔥 ترند is rendered separately (it has its own scan logic).
  { id: "popular",   ar: "مشهور",  emoji: "⭐" },
  { id: "near_user", ar: "قريب",   emoji: "📍" },
  { id: "open_now",  ar: "مفتوح",  emoji: "🟢" },
  { id: "cat_food",  ar: "مطاعم",  emoji: "🍽" },
  { id: "cat_coffee",ar: "قهاوي",  emoji: "☕" },
];

const QUICK_CHIPS: Chip[] = [
  { id: "open_now",     ar: "مفتوح الآن",    emoji: "🟢" },
  { id: "near_hotel",   ar: "قريب من فندقك", emoji: "🏨" },
  { id: "rating_4_5",   ar: "★ ٤.٥+",        emoji: "⭐" },
  { id: "hidden_gem",   ar: "جوهرة مخفية",   emoji: "💎" },
  { id: "luxury",       ar: "فاخر",           emoji: "💰" },
  { id: "budget",       ar: "اقتصادي",       emoji: "💵" },
  { id: "saved",        ar: "محفوظ",         emoji: "💝" },
];

// Standalone trending chip — has its own prominent section at the top of
// the filter sheet. Always tappable (no opacity gating) — when count=0 it
// triggers a scan; otherwise it toggles the filter.
const TRENDING_CHIP: Chip = { id: "trending", ar: "ترند الآن", emoji: "🔥" };

const ADVANCED_QUALITY: Chip[] = [
  { id: "michelin",         ar: "ميشلان",       emoji: "⭐" },
  { id: "fine_dining",      ar: "فاين داينينق", emoji: "🎩" },
  { id: "specialty_coffee", ar: "قهوة مختصة",   emoji: "☕" },
  { id: "editor_pick",      ar: "اختيار محرّر", emoji: "✨" },
  { id: "highly_rated",     ar: "★ ٤.٨+",       emoji: "🌟" },
  { id: "new_spot",         ar: "جديد",         emoji: "🆕" },
];

// ─── Main component ─────────────────────────────────────────────────────

export default function MapScreen({
  trip,
  places,
  initialSavedSet,
  tripCities,
  extraRegionCities,
  regionAr,
  expandedToRegion,
  initialTab,
  tripDays,
  planItems,
}: {
  trip: Trip;
  places: Place[];
  initialSavedSet: Set<string>;
  tripCities: string[];
  extraRegionCities: Array<{ key: string; label: string }>;
  regionAr: string | null;
  expandedToRegion: boolean;
  /** Initial tab from ?tab=plan|discover query — defaults to discover. */
  initialTab: "discover" | "plan";
  /** All days for this trip (sorted ascending). Drives the day dropdown
   *  when the plan tab is active. */
  tripDays: ItineraryDay[];
  /** Itinerary items with their places joined. The plan tab filters to the
   *  selected day and renders numbered markers + a simple list. */
  planItems: PlanItemRow[];
}) {
  const [tab, setTab] = useState<"discover" | "plan">(initialTab);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(() => {
    // Pick today's day if it's in the trip, else the first day, else null.
    if (tripDays.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const todays = tripDays.find((d) => d.day_date === today);
    return (todays ?? tripDays[0])?.id ?? null;
  });
  const [activeFilters, setActiveFilters] = useState<Set<DiscoverFilterId>>(new Set());
  // Default to the trip's primary city so filters scope correctly from the
  // very first render — before GPS arrives (which can take seconds) and
  // before the user touches the dropdown. The "🌍 كل المنطقة" option is
  // still one tap away in the dropdown if they want region-wide view.
  const [activeCity, setActiveCity] = useState<string | null>(
    tripCities[0] ?? null,
  );
  // View mode for the Discover tab — map (default) or list (Airbnb-style
  // scrollable list of place cards). Same filters apply to both.
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [addUrlOpen, setAddUrlOpen] = useState(false);
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  const [savedDelta, setSavedDelta] = useState<Map<string, boolean>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("near");
  /** Increment to ask DiscoverMap to flyTo user/hotel — replaces the
   *  bottom-left floating button so the map gets a cleaner bottom edge. */
  const [recenterTick, setRecenterTick] = useState(0);
  /** Increment to ask DiscoverMap to fit bounds around ALL loaded places —
   *  drives the "🌍 كل المنطقة" header button. */
  const [fitAllTick, setFitAllTick] = useState(0);
  /** Increment on EVERY explicit place tap (card or marker). Ensures the map
   *  pans even when the user re-taps the same card (selectedId unchanged). */
  const [focusTick, setFocusTick] = useState(0);
  const cityAutoSetRef = useRef(false);
  const router = useRouter();

  // Stable handlers — without these, DiscoverMap's cluster effect re-binds
  // marker click closures on every parent render (audit fix 2026-06-16).
  const handleSelect = useCallback((p: Place) => {
    setSelectedId(p.id);
    setFocusTick((t) => t + 1);
  }, []);
  const handleSelectFromCarousel = useCallback((p: Place) => {
    setSelectedId(p.id);
    setFocusTick((t) => t + 1);
  }, []);
  const handleOpenDetail = useCallback((p: Place) => setDetailPlace(p), []);
  const handleCityChange = useCallback((c: string | null) => setActiveCity(c), []);
  const handleSortChange = useCallback((m: SortMode) => {
    setSortMode(m);
    setSelectedId(null);
  }, []);

  // Live saved set = initial server snapshot ⊕ local optimistic toggles
  const savedSet = useMemo(() => {
    const out = new Set(initialSavedSet);
    savedDelta.forEach((on, id) => { if (on) out.add(id); else out.delete(id); });
    return out;
  }, [initialSavedSet, savedDelta]);

  const geo = useGeoLocation();
  const userLoc = useMemo(
    () => (geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng } : null),
    [geo.coords],
  );
  const hotelLoc = useMemo(
    () => (trip.hotel_lat != null && trip.hotel_lng != null
      ? { lat: trip.hotel_lat, lng: trip.hotel_lng } : null),
    [trip.hotel_lat, trip.hotel_lng],
  );

  // ── Popular set — top 100 by rating × log(reviews) in current city scope.
  // Free + instant: no AI / network call. Pre-computed here so each predicate
  // call just does a Set.has() lookup.
  const popularSet = useMemo(() => {
    const inScope = activeCity
      ? places.filter((p) => (p.city_label ?? p.city) === activeCity)
      : places;
    const scored = inScope
      .filter((p) => p.rating != null && (p.review_count ?? 0) > 0)
      .map((p) => ({
        id: p.id,
        score: (p.rating ?? 0) * Math.log10((p.review_count ?? 0) + 1),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
    return new Set(scored.map((x) => x.id));
  }, [places, activeCity]);

  const filterCtx = useMemo<FilterContext>(
    () => ({ savedSet: initialSavedSet, now: new Date(), hotel: hotelLoc, user: userLoc, popularSet }),
    [initialSavedSet, hotelLoc, userLoc, popularSet],
  );

  // Apply filters
  const filtered = useMemo(
    () => applyFilters(places, activeFilters, filterCtx),
    [places, activeFilters, filterCtx],
  );
  const cityScoped = useMemo(() => {
    if (!activeCity) return filtered;
    return filtered.filter((p) => (p.city_label ?? p.city) === activeCity);
  }, [filtered, activeCity]);

  // Apply the user's sort preference. Default "near" sorts by haversine from
  // user (or hotel fallback). "rating" by Google rating descending. "score"
  // by our SmartScore so editorial + taste signals lift gems above raw
  // crowd-favourites — the explicit "better than Google Maps" lever.
  const sorted = useMemo(() => {
    const anchor = userLoc ?? hotelLoc;
    const slice = [...cityScoped];

    // When the 🔥 filter is on the user's intent is "show me what's viral,
    // most-viral first" — override sortMode so the carousel orders by score.
    if (activeFilters.has("trending")) {
      return slice.sort((a, b) => (b.trending_score ?? 0) - (a.trending_score ?? 0)
        || (b.rating ?? 0) - (a.rating ?? 0));
    }

    if (sortMode === "near" && anchor) {
      return slice.sort((a, b) => {
        const da = a.lat != null && a.lng != null ? haversineKm(anchor, { lat: a.lat, lng: a.lng }) : Infinity;
        const db = b.lat != null && b.lng != null ? haversineKm(anchor, { lat: b.lat, lng: b.lng }) : Infinity;
        return da - db;
      });
    }
    if (sortMode === "rating") {
      return slice.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.review_count ?? 0) - (a.review_count ?? 0));
    }
    // score
    return slice
      .map((p) => {
        const { score } = computeSmartScore(p, {
          hotelLocation: hotelLoc,
          userLocation: userLoc,
          budgetStyle: trip.budget_style,
          userSaved: initialSavedSet.has(p.id),
          userRating: null,
          userVerdict: null,
        });
        return { p, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }, [cityScoped, sortMode, userLoc, hotelLoc, initialSavedSet, trip.budget_style, activeFilters]);

  // Cities for the floating pills overlay (driven by DiscoverMap)
  const cities = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      const label = (p.city_label ?? p.city ?? "").trim();
      if (!label) continue;
      m.set(label, (m.get(label) ?? 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({ label, count }));
  }, [places]);

  // Warm the dynamic chunk for PlaceDetailSheet on mount — that way the
  // first "عرض التفاصيل" tap is instant instead of fetching ~25 KB then.
  useEffect(() => {
    import("@/components/PlaceDetailSheet").catch(() => {});
  }, []);

  // Auto-pick closest city to user location (once). Walks ALL loaded places
  // and picks whichever city's nearest place is < 30 km from the user.
  useEffect(() => {
    if (cityAutoSetRef.current || activeCity || !userLoc || places.length === 0) return;
    let closest: string | null = null;
    let minKm = Infinity;
    const seen = new Set<string>();
    for (const p of places) {
      const label = (p.city_label ?? p.city ?? "").trim();
      if (!label || seen.has(label) || p.lat == null || p.lng == null) continue;
      seen.add(label);
      const km = haversineKm(userLoc, { lat: p.lat, lng: p.lng });
      if (km < minKm) { minKm = km; closest = label; }
    }
    if (closest && minKm < 30) setActiveCity(closest);
    cityAutoSetRef.current = true;
  }, [userLoc, activeCity, places]);

  // ── Out-of-plan location detector ─────────────────────────────────────
  // If geolocation puts the user far from EVERY loaded place (i.e. they're
  // visiting a region city that's not in their trip), auto-expand to the
  // full region so they see the places where they ACTUALLY are.
  const userOutOfPlan = useMemo(() => {
    if (!userLoc || expandedToRegion || places.length === 0) return null;
    let minKm = Infinity;
    for (const p of places) {
      if (p.lat == null || p.lng == null) continue;
      const km = haversineKm(userLoc, { lat: p.lat, lng: p.lng });
      if (km < minKm) minKm = km;
    }
    // 18 km is roughly "different city in the same region" — Nice ↔ Monaco
    // is ~12 km, Nice ↔ Cannes ~25 km. Tight enough to fire when the user
    // actually crossed a city boundary, loose enough not to false-positive.
    return minKm > 18 ? { distKm: minKm } : null;
  }, [userLoc, expandedToRegion, places]);

  // Auto-expand region when the user is outside their plan. Replaces (not
  // pushes) the URL so the back button still goes to the trip overview.
  // Only fires once because `expandedToRegion` flips to true after the route
  // change, which disables the userOutOfPlan signal.
  const autoExpandFiredRef = useRef(false);
  useEffect(() => {
    if (!userOutOfPlan || expandedToRegion || autoExpandFiredRef.current) return;
    autoExpandFiredRef.current = true;
    router.replace(`/trips/${trip.id}/map?expand=region${tab === "plan" ? "&tab=plan" : ""}`);
  }, [userOutOfPlan, expandedToRegion, router, trip.id, tab]);

  // Counts shown on each chip (drives badge + 0-state hide)
  const allIds = useMemo(
    () => [...CATEGORY_CHIPS, ...QUICK_CHIPS, ...ADVANCED_QUALITY].map((c) => c.id),
    [],
  );
  const counts = useMemo(
    () => countPerFilter(activeCity ? places.filter((p) => (p.city_label ?? p.city) === activeCity) : places,
      activeFilters, filterCtx, allIds),
    [places, activeFilters, filterCtx, allIds, activeCity],
  );

  function toggle(id: DiscoverFilterId) {
    setActiveFilters((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const advancedActive = Array.from(activeFilters).filter((id) =>
    ADVANCED_QUALITY.find((c) => c.id === id),
  ).length;

  // ── Trending breakdown (TikTok / Instagram) for the promoted 🔥 row ──
  // Re-computed when the city scope changes. Same `>= 50` cutoff as the
  // filter predicate so the count matches what the user actually sees.
  const trendingStats = useMemo(() => {
    const inScope = activeCity
      ? places.filter((p) => (p.city_label ?? p.city) === activeCity)
      : places;
    let total = 0, tiktok = 0, instagram = 0, both = 0;
    for (const p of inScope) {
      if ((p.trending_score ?? 0) < 50) continue;
      total++;
      if (p.trending_source === "tiktok") tiktok++;
      else if (p.trending_source === "instagram") instagram++;
      else if (p.trending_source === "both") both++;
    }
    return { total, tiktok, instagram, both };
  }, [places, activeCity]);

  const showTrendingRow = trendingStats.total > 0;
  const trendingActive = activeFilters.has("trending");

  // Manual "اجلب الترند" — scans the currently-selected city (or the
  // stalest one in the user's plan) via /api/admin/trending-scan. Cron
  // handles the autopilot path; this is the human-in-the-loop button.
  const [scanState, setScanState] = useState<"idle" | "loading" | "error">("idle");
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // Header offset = base controls (56) + chip row (44). No more dedicated
  // trending row — the inline 🔥 chip lives in the chip row itself, and
  // scan progress shows as a floating toast (overlay, doesn't reflow layout).
  //
  // Layout: 56 top bar + 40 tab strip + 44 (chips OR day picker) = 140 px
  const headerOffsetPx = 140 + (scanMsg ? 18 : 0);

  // ── Plan-tab data ─────────────────────────────────────────────────────
  const planItemsForDay = useMemo(() => {
    if (!selectedDayId) return [];
    return planItems
      .filter((it) => it.day_id === selectedDayId)
      .sort((a, b) => a.position - b.position);
  }, [planItems, selectedDayId]);

  // numberedPlaces: place_id → 1-based position for the selected day.
  const numberedPlaces = useMemo(() => {
    if (tab !== "plan") return null;
    const m = new Map<string, number>();
    planItemsForDay.forEach((it, idx) => m.set(it.place_id, idx + 1));
    return m;
  }, [tab, planItemsForDay]);

  // What the map renders: filtered catalogue in discover, day's items in plan.
  const mapPlaces = useMemo(() => {
    if (tab === "plan") return planItemsForDay.map((it) => it.places);
    return cityScoped;
  }, [tab, cityScoped, planItemsForDay]);

  // For carousel/list: same as mapPlaces in plan mode, sorted in discover.
  const totalPlanCount = planItems.length;
  const triggerScan = useCallback(async () => {
    if (scanState === "loading") return;
    setScanState("loading");
    setScanMsg(null);
    try {
      const body: Record<string, unknown> = activeCity
        ? { city_label: activeCity }
        : { all_trip_cities: true };
      const r = await fetch("/api/admin/trending-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error ?? `http_${r.status}`);
      setScanMsg(
        json.empty
          ? `ما في مرشحين كافيين في ${json.city ?? "هذه المدينة"}`
          : `✓ ${json.city}: ${json.written} ترند · $${(json.costUsd ?? 0).toFixed(3)}`,
      );
      setScanState("idle");
      // Auto-activate the trending filter so the user sees the fresh viral
      // results immediately — the whole point of having scanned.
      if (!json.empty && json.written > 0) {
        setActiveFilters((s) => new Set(s).add("trending"));
      }
      router.refresh();
    } catch (e) {
      setScanState("error");
      setScanMsg(e instanceof Error ? e.message : "خطأ");
    }
  }, [activeCity, scanState, router]);

  // Auto-dismiss scan toast after 5s so it doesn't clutter the screen
  useEffect(() => {
    if (!scanMsg) return;
    const t = setTimeout(() => setScanMsg(null), 5000);
    return () => clearTimeout(t);
  }, [scanMsg]);

  return (
    <main className="fixed inset-0 bg-stone-100 overflow-hidden">
      {/* ─── Top control bar (back + count + clear) ──────────────────── */}
      <div
        className="absolute top-0 inset-x-0 z-[900] bg-white/95 backdrop-blur-md border-b border-line"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Link
            href={`/trips/${trip.id}`}
            className="inline-flex items-center gap-1 bg-white border border-line text-sea text-[12px] font-bold px-2.5 min-h-[40px] rounded-pill shadow-sm active:scale-95 transition"
          >
            <span>←</span>
            <span className="line-clamp-1 max-w-[90px]">{trip.name}</span>
          </Link>

          <span className="ms-auto inline-flex items-center bg-stone-100 text-stone-800 font-bold text-[11.5px] px-2.5 min-h-[32px] rounded-pill">
            🗺 {sorted.length}
          </span>

          {/* موقعي / الفندق — compact circular button. */}
          {(userLoc || hotelLoc) && (
            <button
              onClick={() => setRecenterTick((t) => t + 1)}
              title={userLoc ? "ركّز على موقعي" : "ركّز على فندقي"}
              aria-label={userLoc ? "ركّز الخريطة على موقعي" : "ركّز الخريطة على فندقي"}
              className="inline-flex items-center justify-center bg-white border border-line text-stone-800 font-bold text-[14px] w-10 h-10 rounded-pill shadow-sm active:scale-95 transition"
            >
              {userLoc ? "📍" : "🏨"}
            </button>
          )}

          {/* 🌍 كل المنطقة — fit map bounds around ALL loaded places so the
              user can see the whole region instead of just where they are. */}
          {mapPlaces.length > 1 && tab === "discover" && viewMode === "map" && (
            <button
              onClick={() => setFitAllTick((t) => t + 1)}
              title="عرض كل المنطقة"
              aria-label="اعرض كل المدن على الخريطة"
              className="inline-flex items-center justify-center bg-white border border-line text-stone-800 font-bold text-[14px] w-10 h-10 rounded-pill shadow-sm active:scale-95 transition"
            >
              🌍
            </button>
          )}

          {/* 🗺 ↔ 📋 View toggle — Airbnb / Booking style. Discover tab only;
              irrelevant on the Plan tab. */}
          {tab === "discover" && (
            <button
              onClick={() => setViewMode((v) => (v === "map" ? "list" : "map"))}
              title={viewMode === "map" ? "عرض كقائمة" : "عرض كخريطة"}
              aria-label={viewMode === "map" ? "بدّل لعرض القائمة" : "بدّل لعرض الخريطة"}
              className="inline-flex items-center justify-center bg-sea text-white font-extrabold text-[12px] px-3 min-h-[40px] gap-1 rounded-pill shadow-btn-sea active:translate-y-px active:shadow-btn-press transition-all duration-150"
            >
              <span className="text-[14px]">{viewMode === "map" ? "📋" : "🗺"}</span>
              <span>{viewMode === "map" ? "قائمة" : "خريطة"}</span>
            </button>
          )}

          {/* + من رابط — paste a Google Maps URL and auto-extract details. */}
          <button
            onClick={() => setAddUrlOpen(true)}
            title="أضف مكاناً من رابط Google Maps"
            aria-label="أضف مكاناً من رابط خرائط جوجل"
            className="inline-flex items-center justify-center bg-coral text-white font-bold text-[18px] w-10 h-10 rounded-pill shadow-md active:scale-95 transition"
          >
            +
          </button>

          {/* 🔥 إدارة الترند — opens /profile/trends in a new tab so the user
              can scan ANY city / category combination. */}
          <Link
            href="/profile/trends"
            title="إدارة الترند"
            aria-label="افتح إدارة الترند"
            className="inline-flex items-center justify-center bg-gradient-to-l from-pink-500 to-orange-500 text-white font-bold text-[15px] w-10 h-10 rounded-pill shadow-md active:scale-95 transition"
          >
            🔥
          </Link>

          {/* ⚙ فلاتر — moved here so it never overlaps the carousel. Badge
              shows active count for one-glance status. */}
          <button
            onClick={() => setFilterSheetOpen(true)}
            title="افتح الفلاتر"
            aria-label={`افتح الفلاتر${activeFilters.size > 0 ? ` (${activeFilters.size} مفعّل)` : ""}`}
            className="relative inline-flex items-center justify-center bg-stone-900 text-white font-bold text-[14px] w-10 h-10 rounded-pill shadow-md active:scale-95 transition"
          >
            <span>⚙</span>
            {(activeFilters.size > 0) && (
              <span className="absolute -top-1 -right-1 bg-coral text-white text-[10px] font-extrabold min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full border-2 border-white">
                {activeFilters.size}
              </span>
            )}
          </button>

          {activeFilters.size > 0 && tab === "discover" && (
            <button
              onClick={() => setActiveFilters(new Set())}
              aria-label="مسح كل الفلاتر المفعّلة"
              className="inline-flex items-center bg-coral/10 text-coral border border-coral/30 font-bold text-[11.5px] px-2.5 min-h-[32px] rounded-pill active:scale-95"
            >
              ✕
            </button>
          )}
        </div>

        {/* ─── Tab switcher: Discover / خطتي ──────────────────────────── */}
        <div className="px-3 pb-1.5">
          <div className="bg-stone-100 rounded-pill p-1 inline-flex gap-1 w-full">
            <button
              type="button"
              onClick={() => setTab("discover")}
              aria-pressed={tab === "discover"}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[36px] rounded-pill text-[12.5px] font-extrabold transition active:scale-95 ${
                tab === "discover"
                  ? "bg-white text-sea shadow"
                  : "text-stone-600"
              }`}
            >
              <span>🧭</span><span>اكتشف</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("plan")}
              aria-pressed={tab === "plan"}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[36px] rounded-pill text-[12.5px] font-extrabold transition active:scale-95 ${
                tab === "plan"
                  ? "bg-white text-sea shadow"
                  : "text-stone-600"
              }`}
            >
              <span>📋</span><span>خطتي</span>
              {totalPlanCount > 0 && (
                <span className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-pill ${
                  tab === "plan" ? "bg-coral text-white" : "bg-stone-300 text-stone-700"
                }`}>{totalPlanCount}</span>
              )}
            </button>
          </div>
        </div>

        {/* ─── Day dropdown (plan tab only) ───────────────────────────── */}
        {tab === "plan" && tripDays.length > 0 && (
          <div className="px-3 pb-2">
            <select
              value={selectedDayId ?? ""}
              onChange={(e) => setSelectedDayId(e.target.value || null)}
              aria-label="اختر اليوم"
              className="w-full min-h-[40px] px-3 rounded-pill bg-white border-2 border-sea/30 text-sea font-extrabold text-[12.5px] shadow-sm focus:outline-none focus:border-sea"
            >
              {tripDays.map((d, i) => {
                const count = planItems.filter((it) => it.day_id === d.id).length;
                const date = new Date(d.day_date);
                const label = date.toLocaleDateString("ar-SA", {
                  weekday: "long", day: "numeric", month: "long",
                });
                return (
                  <option key={d.id} value={d.id}>
                    اليوم {i + 1} · {label} ({count})
                  </option>
                );
              })}
            </select>
          </div>
        )}

        {/* Discover-only — combined row: TripCityPicker + chips */}
        {tab === "discover" && <div className="px-3 pb-2">
          <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1 items-center">
            <TripCityPicker
              tripCities={tripCities}
              extraRegionCities={extraRegionCities}
              activeCity={activeCity}
              onChange={handleCityChange}
              cityCounts={cities}
              regionAr={regionAr}
              expandedToRegion={expandedToRegion}
              tripId={trip.id}
            />
            <span className="self-center h-5 w-px bg-stone-300 mx-1 shrink-0" />
            {/* 🔥 ترند — discovery + filter + scan trigger, all in one chip.
                • Has data + idle: tap → toggle filter.
                • No data + idle: tap → start scan (no full-row blocker).
                • Scanning: shows in-place spinner, still tappable to toggle.
                Auto-activates on successful scan so user sees results. */}
            <button
              onClick={() => {
                if (trendingStats.total === 0 && scanState !== "loading") {
                  triggerScan();
                } else if (trendingStats.total > 0) {
                  toggle("trending");
                }
              }}
              aria-pressed={trendingActive}
              aria-label={
                scanState === "loading" ? "جارٍ البحث عن الترند"
                  : trendingStats.total > 0 ? `فلتر ترند (${trendingStats.total} مكان)`
                  : "فلتر ترند — اضغط للجلب"
              }
              className={`shrink-0 inline-flex items-center gap-1 px-3 min-h-[40px] rounded-pill text-[12px] font-extrabold border-2 shadow-md transition active:scale-95 ${
                trendingActive
                  ? "bg-gradient-to-l from-pink-500 to-orange-500 text-white border-rose-600 ring-2 ring-rose-200"
                  : trendingStats.total > 0
                    ? "bg-gradient-to-l from-pink-50 to-orange-50 text-rose-700 border-rose-400"
                    : "bg-gradient-to-l from-pink-100 to-orange-100 text-rose-700 border-rose-400 animate-[pulse_2.5s_ease-in-out_infinite]"
              }`}
            >
              {scanState === "loading" ? (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-rose-200 border-t-rose-600 animate-spin" />
              ) : (
                <span className="text-[14px]">🔥</span>
              )}
              <span>ترند</span>
              <span className={`text-[10px] tabular-nums font-extrabold px-1 rounded-pill ${
                trendingActive
                  ? "bg-white/25"
                  : trendingStats.total > 0
                    ? "bg-rose-200/70 text-rose-900"
                    : "bg-rose-300/60 text-rose-900"
              }`}>
                {scanState === "loading" ? "…" : trendingStats.total > 0 ? trendingStats.total : "+"}
              </span>
            </button>
            {/* Primary filter chips — active uses vertical gradient + colored
                shadow + subtle ring for a "pressed pill" feel. */}
            {PRIMARY_FILTER_CHIPS.map((c) => {
              const on = activeFilters.has(c.id);
              const n = counts[c.id] ?? 0;
              return (
                <button
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`shrink-0 inline-flex items-center gap-1 px-2.5 min-h-[40px] rounded-pill text-[11.5px] font-bold border transition-all duration-150 active:scale-95 ${
                    on
                      ? "bg-gradient-to-b from-sea to-sea-600 text-white border-sea-700 shadow-btn-sea ring-1 ring-sea-700/20"
                      : "bg-white text-sea border-sky-200 hover:border-sea/40 hover:bg-sky-50/50"
                  }`}
                >
                  <span>{c.emoji}</span>
                  <span>{c.ar}</span>
                  {n > 0 && <span className={`text-[9px] tabular-nums ${on ? "opacity-95" : "opacity-60"}`}>{n}</span>}
                </button>
              );
            })}
            {/* المزيد — opens the full filter sheet (cuisines, vibes, meals, …) */}
            <button
              onClick={() => setFilterSheetOpen(true)}
              aria-label="مزيد من الفلاتر"
              className="shrink-0 inline-flex items-center gap-1 px-3 min-h-[40px] rounded-pill text-[11.5px] font-extrabold border-2 border-dashed border-stone-400 text-stone-700 bg-white active:scale-95 transition"
            >
              <span>⚙</span>
              <span>المزيد</span>
            </button>
          </div>
        </div>}
      </div>

      {/* ─── Scan toast — floating, non-blocking. Auto-dismisses after 5s. */}
      {scanMsg && (
        <div
          className="absolute z-[950] left-1/2 -translate-x-1/2 max-w-[90vw]"
          style={{ top: `calc(env(safe-area-inset-top) + ${headerOffsetPx + 6}px)` }}
          role="status"
          aria-live="polite"
        >
          <div className={`px-3.5 py-2 rounded-pill shadow-2xl font-extrabold text-[12px] border-2 ${
            scanState === "error"
              ? "bg-rose-600 text-white border-rose-700"
              : "bg-emerald-600 text-white border-emerald-700"
          }`}>
            {scanMsg}
          </div>
        </div>
      )}

      {/* ─── "أنت في X" banner — geolocation puts user outside their plan.
          Tap → ?expand=region so all region cities load. Sits below the
          header so it doesn't clash with controls. */}
      {userOutOfPlan && regionAr && (
        <Link
          href={`/trips/${trip.id}/map?expand=region`}
          prefetch={false}
          className="absolute z-[940] left-1/2 -translate-x-1/2 max-w-[90vw] px-3.5 py-2 rounded-pill bg-white border-2 border-sky-400 shadow-2xl text-[11.5px] font-extrabold text-sky-800 inline-flex items-center gap-1.5 active:scale-95 transition"
          style={{ top: `calc(env(safe-area-inset-top) + ${headerOffsetPx + 6}px)` }}
          aria-label="موقعك خارج خطتك — تَوسَّع لكامل المنطقة"
        >
          <span>📍</span>
          <span>موقعك خارج خطتك ·</span>
          <span className="text-rose-600">استكشف {regionAr}</span>
          <span className="opacity-60">↗</span>
        </Link>
      )}

      {/* ─── Body ───
          Discover + Map: DiscoverMap (markers) + bottom carousel.
          Discover + List: vertical PlaceListView (Airbnb/Booking style).
          Plan: DiscoverMap + numbered markers + PlanInlineList. */}
      <div className="absolute inset-0" style={{ top: `calc(env(safe-area-inset-top) + ${headerOffsetPx}px)` }}>
        {tab === "discover" && viewMode === "list" ? (
          <PlaceListView
            places={sorted}
            userLocation={userLoc}
            hotelLocation={hotelLoc}
            onOpenDetail={handleOpenDetail}
            savedSet={savedSet}
            activeCity={activeCity}
            hasActiveFilters={activeFilters.size > 0}
            onClearFilters={() => setActiveFilters(new Set())}
          />
        ) : (
          <DiscoverMap
            fullHeight
            hidePopup
            selectedId={selectedId}
            onSelect={handleSelect}
            recenterTrigger={recenterTick}
            fitAllTrigger={fitAllTick}
            focusTrigger={focusTick}
            places={mapPlaces}
            totalCount={mapPlaces.length}
            showingAll
            userLocation={userLoc}
            hotelLocation={hotelLoc}
            cities={cities}
            activeCity={activeCity}
            onCityChange={handleCityChange}
            onOpenDetail={handleOpenDetail}
            numberedPlaces={numberedPlaces}
          />
        )}
      </div>

      {/* ─── Bottom strip ───
          Discover + Map: horizontal carousel.
          Discover + List: hidden (list IS the surface).
          Plan: numbered items with delete + reorder. */}
      {tab === "discover" && viewMode === "map" && (
        <MapBottomCarousel
          places={sorted}
          selectedId={selectedId}
          userLocation={userLoc}
          hotelLocation={hotelLoc}
          sortMode={sortMode}
          onSortChange={handleSortChange}
          onSelect={handleSelectFromCarousel}
          onOpenDetail={handleOpenDetail}
          savedSet={savedSet}
          hasActiveFilters={activeFilters.size > 0}
          onClearFilters={() => setActiveFilters(new Set())}
        />
      )}
      {tab === "plan" && (
        <PlanInlineList
          tripId={trip.id}
          items={planItemsForDay}
          selectedId={selectedId}
          userLocation={userLoc}
          hotelLocation={hotelLoc}
          onSelect={handleSelectFromCarousel}
          onOpenDetail={handleOpenDetail}
          onChanged={() => router.refresh()}
        />
      )}

      {/* ⚙ فلاتر button moved to the top bar — keeps the map area clean
          and stops the FAB from covering the carousel's right edge. */}

      {/* ─── Filter sheet ─── */}
      {filterSheetOpen && (
        <MapFilterSheet
          counts={counts}
          active={activeFilters}
          onToggle={toggle}
          onClear={() => setActiveFilters(new Set())}
          onClose={() => setFilterSheetOpen(false)}
          onTriggerScan={triggerScan}
          scanLoading={scanState === "loading"}
        />
      )}

      {/* ─── Add place from URL sheet ─── */}
      {addUrlOpen && (
        <AddPlaceFromUrlSheet
          tripId={trip.id}
          userLocation={userLoc}
          hotelLocation={hotelLoc}
          onClose={() => setAddUrlOpen(false)}
          onSaved={(p) => {
            // Optimistically reflect the newly-saved place's heart on the
            // map carousel without waiting for a router.refresh round-trip.
            setSavedDelta((m) => new Map(m).set(p.id, true));
            router.refresh();
          }}
        />
      )}

      {/* ─── Location-source indicator ───
          Small pill above the carousel makes it explicit which anchor the
          map is using for distances/reasons. Tapping geo prompts permission
          if it was denied earlier. */}
      <LocationSourceBadge
        userLoc={userLoc}
        hotelLoc={hotelLoc}
        geoStatus={geo.status}
        onRequest={geo.request}
      />

      {/* ─── Detail modal — opens over the map ─── */}
      {detailPlace && (
        <PlaceDetailSheet
          place={detailPlace}
          hotel={hotelLoc ? { ...hotelLoc, name: trip.hotel_name ?? "فندقك" } : null}
          onClose={() => {
            setDetailPlace(null);
            // Re-focus the map on the place so the user sees their pin
            // exactly where they left off after dismissing the modal.
            setFocusTick((t) => t + 1);
          }}
          onSave={async () => {
            const isSaved = savedDelta.get(detailPlace.id) ?? initialSavedSet.has(detailPlace.id);
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
          saved={savedDelta.get(detailPlace.id) ?? initialSavedSet.has(detailPlace.id)}
          onAddToPlan={() => {
            setDetailPlace(null);
            window.location.href = `/trips/${trip.id}?add=${detailPlace.id}`;
          }}
          catalogue={places}
        />
      )}
    </main>
  );
}

// ─── Trip city picker (dropdown) ────────────────────────────────────────
// Replaces the old pill-row. Shows the user's plan cities as a clean menu
// with counts; offers extra region cities as "+ استكشف" expansions (which
// navigate to ?expand=region to widen the server-side query).
// ─── Place list view ────────────────────────────────────────────────────
// Vertical Airbnb-style scroll. Same filtered+sorted places the carousel
// would show, just laid out as a scannable list. Used when the user taps
// "📋 قائمة" in the Discover tab header.
function PlaceListView({
  places, userLocation, hotelLocation, onOpenDetail, savedSet,
  activeCity, hasActiveFilters, onClearFilters,
}: {
  places: Place[];
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  onOpenDetail: (p: Place) => void;
  savedSet: Set<string>;
  activeCity: string | null;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  const anchor = userLocation ?? hotelLocation;

  if (places.length === 0) {
    return (
      <div className="absolute inset-0 overflow-y-auto p-4">
        <div className="bg-white rounded-2xl border border-line p-6 text-center shadow-md">
          <div className="text-4xl mb-2">🔍</div>
          <p className="text-[13.5px] font-serif font-extrabold text-ink mb-1">
            {hasActiveFilters ? "ما لقينا أماكن بهالفلاتر" : `ما في أماكن في ${activeCity ?? "المنطقة"}`}
          </p>
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="mt-3 text-coral font-extrabold text-[12.5px] min-h-[40px] px-5 rounded-pill bg-coral/10 active:scale-95 transition"
            >
              ✕ امسح الفلاتر
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="px-3 pt-3 pb-24 space-y-2.5">
        <div className="text-[11.5px] font-bold text-stone-600 px-1">
          {places.length} مكان{activeCity ? ` في ${activeCity}` : " في المنطقة"}
        </div>
        {places.map((p) => {
          const photo = p.photo_url;
          const distKm = anchor && p.lat != null && p.lng != null
            ? haversineKm(anchor, { lat: p.lat, lng: p.lng })
            : null;
          const distLabel = distKm != null
            ? distKm < 1.5 ? `🚶 ${Math.max(1, Math.round(distKm * 12))}د`
              : `${distKm.toFixed(1)} كم`
            : null;
          const trending = (p.trending_score ?? 0) >= 50;
          const saved = savedSet.has(p.id);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenDetail(p)}
              className="w-full text-right group bg-white rounded-2xl border border-line overflow-hidden shadow-sm active:scale-[0.99] transition flex items-stretch gap-3"
            >
              <div className="relative shrink-0 w-24 h-24 bg-stone-100 overflow-hidden">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo}
                    alt={p.name}
                    className="w-full h-full object-cover group-active:brightness-90 transition"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-3xl">📍</div>
                )}
                {trending && (
                  <span className="absolute top-1 right-1 bg-gradient-to-l from-pink-500 to-orange-500 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded-pill shadow-sm">
                    🔥
                  </span>
                )}
                {saved && (
                  <span className="absolute bottom-1 left-1 bg-rose-500 text-white w-5 h-5 grid place-items-center rounded-full text-[10px] shadow-md">
                    ❤
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0 py-2 pl-3">
                <h3 className="font-extrabold text-[13.5px] text-ink line-clamp-1 tracking-tight">{p.name}</h3>
                <div className="text-[11.5px] text-stone-600 font-bold mt-0.5 flex items-center gap-2 flex-wrap">
                  {p.rating != null && (
                    <span className="text-amber-700">
                      ⭐ {p.rating.toFixed(1)}
                      {p.review_count != null && (
                        <span className="text-stone-400 font-normal"> ({p.review_count >= 1000 ? `${(p.review_count / 1000).toFixed(1)}k` : p.review_count})</span>
                      )}
                    </span>
                  )}
                  {distLabel && <span className="text-stone-700">{distLabel}</span>}
                  {p.price_level != null && p.price_level > 0 && (
                    <span className="text-stone-700">{"€".repeat(Math.min(4, p.price_level))}</span>
                  )}
                </div>
                <div className="text-[10.5px] text-stone-500 mt-1">
                  {p.city_label ?? p.city}
                  {p.category && <> · {p.category === "food" ? "🍽" : p.category === "coffee" ? "☕" : p.category === "sight" ? "🏛" : p.category === "nature" ? "🌿" : p.category === "sweet" ? "🍰" : p.category === "event" ? "🎭" : p.category === "bar" ? "🍸" : "📍"}</>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Plan inline list ───────────────────────────────────────────────────
// Replaces the discover carousel when tab=plan. Shows the selected day's
// items as numbered cards with: photo, name, distance, open status, and
// delete + reorder controls. Calls the existing itinerary API for mutations.
function PlanInlineList({
  tripId, items, selectedId, userLocation, hotelLocation,
  onSelect, onOpenDetail, onChanged,
}: {
  tripId: string;
  items: PlanItemRow[];
  selectedId: string | null;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  onSelect: (p: Place) => void;
  onOpenDetail: (p: Place) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const anchor = userLocation ?? hotelLocation;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll the selected card into view
  useEffect(() => {
    if (!selectedId) return;
    const el = document.getElementById(`plancard-${selectedId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedId]);

  async function remove(itemId: string) {
    if (!confirm("احذف هذا المكان من خطتك؟")) return;
    setBusy(itemId);
    try {
      await fetch(`/api/trips/${tripId}/itinerary/${itemId}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function move(itemId: string, direction: -1 | 1) {
    const idx = items.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const a = items[idx];
    const b = items[targetIdx];
    setBusy(itemId);
    try {
      // Swap positions via two PATCH calls
      await Promise.all([
        fetch(`/api/trips/${tripId}/itinerary/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: b.position }),
        }),
        fetch(`/api/trips/${tripId}/itinerary/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: a.position }),
        }),
      ]);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <div
        className="absolute inset-x-0 bottom-0 z-[750] pb-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="mx-3 bg-gradient-to-br from-card to-sand border border-line rounded-3xl p-6 text-center shadow-sm">
          <div className="text-5xl mb-2 animate-float">🗺️</div>
          <p className="font-serif font-extrabold text-ink text-[15px] mb-1">يومك فاضي… وش رأيك نعمّره؟</p>
          <p className="text-muted text-[12px] mb-4 leading-relaxed">اختر «اكتشف» فوق وأضف أماكن بضغطة</p>
          <p className="text-[10.5px] text-stone-500">↑ بدّل من الـ tabs أعلى</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[750] pb-2"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
    >
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-visible scrollbar-thin px-3"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex gap-2 w-max items-stretch py-1">
          {items.map((it, idx) => {
            const p = it.places;
            const isSelected = selectedId === p.id;
            const distKm = anchor && p.lat != null && p.lng != null
              ? haversineKm(anchor, { lat: p.lat, lng: p.lng })
              : null;
            const distLabel = distKm != null
              ? distKm < 1.5 ? `🚶 ${Math.max(1, Math.round(distKm * 12))}د`
                : `${distKm.toFixed(1)} كم`
              : null;
            return (
              <div
                key={it.id}
                id={`plancard-${p.id}`}
                style={{ scrollSnapAlign: "start" }}
                className={`shrink-0 w-[230px] bg-white rounded-2xl overflow-hidden transition border ${
                  isSelected
                    ? "border-2 border-coral shadow-xl scale-[1.02]"
                    : "border-stone-200 shadow-md"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  className="block w-full text-right active:scale-[0.97] transition"
                >
                  <div className="flex items-stretch gap-2 p-2">
                    {/* Sequence number badge */}
                    <div className="shrink-0 w-9 h-9 rounded-full bg-sea text-white font-extrabold text-[14px] grid place-items-center shadow">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-extrabold text-[12.5px] line-clamp-1 text-ink">{p.name}</h4>
                      <div className="text-[11px] text-stone-600 font-bold mt-0.5 flex items-center gap-2">
                        {p.rating != null && (
                          <span className="text-amber-700">⭐ {p.rating.toFixed(1)}</span>
                        )}
                        {distLabel && <span>{distLabel}</span>}
                        {p.cost_estimate != null && (
                          <span className="text-stone-700">~{Math.round(p.cost_estimate)} {p.cost_currency ?? "€"}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
                <div className="px-2 pb-2 grid grid-cols-4 gap-1.5">
                  <button
                    onClick={() => move(it.id, -1)}
                    disabled={idx === 0 || busy === it.id}
                    aria-label="حرّك للأعلى"
                    className="min-h-[40px] rounded-xl bg-stone-100 text-stone-700 font-extrabold text-[14px] active:scale-95 disabled:opacity-40"
                  >↑</button>
                  <button
                    onClick={() => move(it.id, 1)}
                    disabled={idx === items.length - 1 || busy === it.id}
                    aria-label="حرّك للأسفل"
                    className="min-h-[40px] rounded-xl bg-stone-100 text-stone-700 font-extrabold text-[14px] active:scale-95 disabled:opacity-40"
                  >↓</button>
                  <button
                    onClick={() => onOpenDetail(p)}
                    aria-label="افتح التفاصيل"
                    className="min-h-[40px] rounded-xl bg-sea text-white font-extrabold text-[11px] active:scale-95"
                  >تفاصيل</button>
                  <button
                    onClick={() => remove(it.id)}
                    disabled={busy === it.id}
                    aria-label="احذف من خطتي"
                    className="min-h-[40px] rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-extrabold text-[14px] active:scale-95 disabled:opacity-50"
                  >🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Trip city picker (dropdown) ────────────────────────────────────────
function TripCityPicker({
  tripCities, extraRegionCities, activeCity, onChange,
  cityCounts, regionAr, expandedToRegion, tripId,
}: {
  tripCities: string[];
  extraRegionCities: Array<{ key: string; label: string }>;
  activeCity: string | null;
  onChange: (next: string | null) => void;
  cityCounts: Array<{ label: string; count: number }>;
  regionAr: string | null;
  expandedToRegion: boolean;
  tripId: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click — small UX nicety on mobile when the user taps
  // the map after opening the menu.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDoc);
    window.addEventListener("touchstart", onDoc);
    return () => {
      window.removeEventListener("mousedown", onDoc);
      window.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  const countFor = (label: string) =>
    cityCounts.find((c) => c.label === label)?.count ?? 0;

  const allCount = tripCities.reduce((s, c) => s + countFor(c), 0);
  const label = activeCity ?? (expandedToRegion ? "كل المنطقة" : "كل خطتي");
  const labelCount = activeCity ? countFor(activeCity) : allCount;

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="اختر المدينة"
        className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-pill text-[12px] font-bold border bg-stone-900 text-white border-stone-900 shadow active:scale-95 transition"
      >
        <span>📍</span>
        <span className="line-clamp-1 max-w-[110px]">{label}</span>
        <span className="text-[9.5px] opacity-80">{labelCount}</span>
        <span className="text-[10px] opacity-70">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="مدن خطتك"
          className="absolute z-[1000] top-full right-0 mt-1 bg-white border border-line rounded-2xl shadow-2xl min-w-[220px] max-h-[60vh] overflow-y-auto overscroll-contain"
        >
          {/* "كل خطتي" — meta-option for the union */}
          <button
            type="button"
            role="option"
            aria-selected={activeCity == null}
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-right px-3 py-2.5 min-h-[44px] flex items-center justify-between border-b border-line-soft text-[12.5px] font-extrabold ${
              activeCity == null ? "bg-coral/10 text-coral" : "text-stone-800"
            }`}
          >
            <span>{expandedToRegion ? "كل المنطقة" : "كل خطتي"}</span>
            <span className="text-[10px] opacity-70">{allCount}</span>
          </button>

          {/* Trip cities (the user's plan) */}
          {tripCities.length > 0 && (
            <>
              <div className="text-[9.5px] font-extrabold text-stone-500 px-3 pt-2 pb-1 uppercase tracking-wider">
                في خطتك
              </div>
              {tripCities.map((c) => {
                const on = activeCity === c;
                return (
                  <button
                    key={`trip-${c}`}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => { onChange(on ? null : c); setOpen(false); }}
                    className={`w-full text-right px-3 py-2 min-h-[40px] flex items-center justify-between text-[12.5px] font-bold ${
                      on ? "bg-coral/10 text-coral" : "text-stone-800 hover:bg-stone-50"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span>📍</span><span>{c}</span>
                    </span>
                    <span className="text-[10px] opacity-70">{countFor(c)}</span>
                  </button>
                );
              })}
            </>
          )}

          {/* When expanded (default), ANY loaded city is selectable as a
              filter. We list cities that aren't already in the user's plan
              under "في المنطقة" so they can browse Nice / Cannes / Monaco /
              Antibes / Menton freely. Non-expanded mode keeps the legacy
              "+ استكشف" links to opt-in. */}
          {expandedToRegion && (() => {
            const tripSet = new Set(tripCities);
            const otherCities = cityCounts
              .filter((c) => !tripSet.has(c.label) && c.count > 0)
              .slice(0, 12); // cap so the menu doesn't get unwieldy
            if (otherCities.length === 0) return null;
            return (
              <>
                <div className="text-[9.5px] font-extrabold text-stone-500 px-3 pt-2 pb-1 uppercase tracking-wider">
                  في المنطقة
                </div>
                {otherCities.map((c) => {
                  const on = activeCity === c.label;
                  return (
                    <button
                      key={`region-${c.label}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => { onChange(on ? null : c.label); setOpen(false); }}
                      className={`w-full text-right px-3 py-2 min-h-[40px] flex items-center justify-between text-[12.5px] font-bold ${
                        on ? "bg-coral/10 text-coral" : "text-stone-800 hover:bg-stone-50"
                      }`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <span>📍</span><span>{c.label}</span>
                      </span>
                      <span className="text-[10px] opacity-70">{c.count}</span>
                    </button>
                  );
                })}
              </>
            );
          })()}

          {/* Legacy "+ استكشف" — only when NOT yet expanded (i.e. user
              explicitly visited ?expand=plan and wants to widen back). */}
          {!expandedToRegion && extraRegionCities.length > 0 && regionAr && (
            <>
              <div className="text-[9.5px] font-extrabold text-stone-500 px-3 pt-2 pb-1 uppercase tracking-wider">
                استكشف {regionAr}
              </div>
              {extraRegionCities.map((c) => (
                <Link
                  key={`extra-${c.key}`}
                  href={`/trips/${tripId}/map?expand=region`}
                  prefetch={false}
                  className="w-full text-right px-3 py-2 min-h-[40px] flex items-center justify-between text-[12.5px] font-bold text-stone-700 hover:bg-stone-50"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-stone-400">+</span>
                    <span>{c.label}</span>
                  </span>
                  <span className="text-[10px] opacity-70">↗</span>
                </Link>
              ))}
            </>
          )}

          {/* Escape link back to plan-only mode */}
          {expandedToRegion && (
            <Link
              href={`/trips/${tripId}/map?expand=plan`}
              prefetch={false}
              className="block w-full text-right px-3 py-2.5 min-h-[44px] text-[12px] font-bold text-coral border-t border-line-soft hover:bg-coral/5"
            >
              ← اقصرها على خطتي
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Location-source indicator ──────────────────────────────────────────
// Tiny pill above the carousel telling the user WHICH anchor the map's
// "near", "distance", and "why this place?" numbers are based on. Three
// states:
//   • Live GPS  → "📍 موقعك" (subtle, green)
//   • Hotel     → "🏨 موقع فندقك" (tappable hint to enable GPS)
//   • Neither   → nothing (we have nothing to anchor against)
function LocationSourceBadge({
  userLoc, hotelLoc, geoStatus, onRequest,
}: {
  userLoc: { lat: number; lng: number } | null;
  hotelLoc: { lat: number; lng: number } | null;
  geoStatus: "idle" | "asking" | "granted" | "denied" | "unsupported" | "error";
  onRequest: () => void;
}) {
  if (!userLoc && !hotelLoc) return null;

  if (userLoc) {
    return (
      <div
        className="absolute right-3 z-[760] inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold text-[10.5px] px-2 py-0.5 rounded-pill shadow-sm pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 270px)" }}
      >
        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />
        <span>📍 موقعك</span>
      </div>
    );
  }

  // Hotel anchor — tappable when geo isn't denied (so we can prompt).
  const canPrompt = geoStatus === "idle" || geoStatus === "error";
  const button = (
    <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-900 font-bold text-[10.5px] px-2 py-0.5 rounded-pill shadow-sm">
      <span>🏨 من فندقك</span>
      {canPrompt && <span className="opacity-70">· فعّل موقعك</span>}
    </span>
  );

  return (
    <div
      className="absolute right-3 z-[760]"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 270px)" }}
    >
      {canPrompt ? (
        <button
          type="button"
          onClick={onRequest}
          aria-label="فعّل تحديد موقعك للحصول على اقتراحات أدق"
          className="active:scale-95"
        >
          {button}
        </button>
      ) : button}
    </div>
  );
}

// ─── Filter sheet ───────────────────────────────────────────────────────

function MapFilterSheet({
  counts, active, onToggle, onClear, onClose, onTriggerScan, scanLoading,
}: {
  counts: Record<string, number>;
  active: Set<DiscoverFilterId>;
  onToggle: (id: DiscoverFilterId) => void;
  onClear: () => void;
  onClose: () => void;
  /** Called when the user taps the prominent trending chip while no
   *  trending data exists yet for the current scope. */
  onTriggerScan?: () => void;
  scanLoading?: boolean;
}) {
  const total = active.size;
  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/45 grid items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-sand rounded-t-3xl shadow-2xl border-t border-line max-h-[88vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="sticky top-0 bg-sand/95 backdrop-blur-sm border-b border-line-soft px-5 py-3 flex items-center justify-between z-10">
          <h2 className="font-serif font-extrabold text-lg text-ink inline-flex items-center gap-2">
            <span>⚙</span><span>فلاتر</span>
            {total > 0 && (
              <span className="bg-coral text-white text-[11px] font-extrabold px-2 py-0.5 rounded-pill">{total}</span>
            )}
          </h2>
          <div className="flex gap-2">
            {total > 0 && (
              <button
                onClick={onClear}
                className="bg-white border border-coral/30 text-coral font-bold text-[11.5px] px-3 min-h-[40px] rounded-pill active:scale-95"
              >
                ✕ مسح
              </button>
            )}
            <button
              onClick={onClose}
              className="bg-coral text-white font-bold text-[12px] px-4 min-h-[40px] rounded-pill active:scale-95"
            >
              ✓ تطبيق
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* 🔥 Trending — prominent section at the TOP so the user always
              finds it. Single chip, always tappable; clicking with zero
              data triggers the scan flow upstream. */}
          <section>
            <h3 className="text-[12.5px] font-extrabold text-ink mb-2">🔥 الترند · تيك توك / انستقرام</h3>
            <button
              onClick={() => {
                const hasData = (counts[TRENDING_CHIP.id] ?? 0) > 0;
                if (hasData) {
                  onToggle(TRENDING_CHIP.id);
                } else if (onTriggerScan && !scanLoading) {
                  onTriggerScan();
                  onClose();   // close the sheet so the user sees the scan toast
                }
              }}
              disabled={scanLoading}
              aria-pressed={active.has(TRENDING_CHIP.id)}
              className={`w-full inline-flex items-center justify-between gap-2 px-4 min-h-[48px] rounded-pill border-2 shadow-md font-extrabold text-[13px] active:scale-[0.98] transition disabled:opacity-60 ${
                active.has(TRENDING_CHIP.id)
                  ? "bg-gradient-to-l from-pink-500 to-orange-500 text-white border-rose-600 ring-2 ring-rose-200"
                  : "bg-gradient-to-l from-pink-50 to-orange-50 text-rose-700 border-rose-400"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-[16px]">{scanLoading ? "⏳" : "🔥"}</span>
                <span>{TRENDING_CHIP.ar}</span>
              </span>
              <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded-pill ${
                active.has(TRENDING_CHIP.id) ? "bg-white/25" : "bg-rose-200/70 text-rose-900"
              }`}>
                {(counts[TRENDING_CHIP.id] ?? 0) > 0
                  ? `${counts[TRENDING_CHIP.id]} مكان`
                  : scanLoading ? "جارٍ البحث…" : "اضغط للجلب"}
              </span>
            </button>
          </section>
          <Section title="🍽 الفئة" chips={CATEGORY_CHIPS} counts={counts} active={active} onToggle={onToggle} accent="sea" />
          <Section title="✨ سريع" chips={QUICK_CHIPS} counts={counts} active={active} onToggle={onToggle} accent="coral" />
          <Section title="⭐ جودة متقدّمة" chips={ADVANCED_QUALITY} counts={counts} active={active} onToggle={onToggle} accent="amber" />
        </div>
      </div>
    </div>
  );
}

function Section({
  title, chips, counts, active, onToggle, accent,
}: {
  title: string;
  chips: Chip[];
  counts: Record<string, number>;
  active: Set<DiscoverFilterId>;
  onToggle: (id: DiscoverFilterId) => void;
  accent: "sea" | "coral" | "amber";
}) {
  const styles = {
    sea:    { on: "bg-sea text-white border-sea",          off: "bg-white text-sea border-sky-200" },
    coral:  { on: "bg-coral text-white border-coral",      off: "bg-white text-coral border-coral/30" },
    amber:  { on: "bg-amber-500 text-white border-amber-500", off: "bg-white text-amber-800 border-amber-200" },
  }[accent];
  return (
    <section>
      <h3 className="text-[12.5px] font-extrabold text-ink mb-2">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const on = active.has(c.id);
          const n = counts[c.id] ?? 0;
          const disabled = !on && n === 0;
          return (
            <button
              key={c.id}
              onClick={() => onToggle(c.id)}
              disabled={disabled}
              className={`inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-pill text-[12.5px] font-bold border shadow-sm transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${on ? styles.on : styles.off}`}
            >
              <span>{c.emoji}</span>
              <span>{c.ar}</span>
              <span className={`text-[9.5px] ${on ? "opacity-95" : "opacity-60"}`}>{n}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
