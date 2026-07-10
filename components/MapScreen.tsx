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
  applyFilters, countPerFilter, isTrendingNow,
  type DiscoverFilterId, type FilterContext,
} from "@/lib/discover/filters";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import { haversineKm } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";
import MapBottomCarousel, { type SortMode, CAT_EMOJI, CAT_GRADIENT, SORT_LABELS, SortIcon } from "@/components/MapBottomCarousel";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import type { UserTaste } from "@/lib/scoring/userTaste";
import type { CategoryFocus } from "@/lib/trending/scan";
import {
  ChevronRight,
  MapPin,
  Hotel,
  Map as MapIcon,
  List as ListIcon,
  SlidersHorizontal,
  X as XIcon,
  Trash2,
  Loader2,
  GripVertical,
  Search as SearchIcon,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const DiscoverMap = dynamic(() => import("@/components/DiscoverMap"), {
  ssr: false,
  loading: () => (
    // Skeleton instead of spinner — instant premium feel. Mimics the final
    // layout: map area + 3 carousel ghost cards at the bottom.
    <div className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-sand via-card to-line animate-pulse" />
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
        <div className="w-12 h-1 bg-line rounded-full mx-auto" />
        <div className="aspect-[16/9] skeleton-shimmer rounded-2xl" />
        <div className="h-7 w-2/3 skeleton-shimmer rounded" />
        <div className="h-4 w-1/3 skeleton-shimmer rounded" />
        <div className="space-y-2 pt-3">
          <div className="h-3.5 w-full bg-line rounded animate-pulse" />
          <div className="h-3.5 w-5/6 bg-line rounded animate-pulse" />
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

// ─── Row C chips (design_handoff_rihla_app §1 الخريطة) ───────────────────
// Category chips → divider → quick filters → cuisine chips (only when
// مطاعم is active). Order matters — first chip on RTL is rightmost.
const ROW_C_CATEGORIES: Chip[] = [
  { id: "cat_food",   ar: "مطاعم", emoji: "🍽" },
  { id: "cat_coffee", ar: "قهوة",  emoji: "☕" },
  { id: "cat_sight",  ar: "معالم", emoji: "🏛" },
  { id: "cat_nature", ar: "طبيعة", emoji: "🌿" },
  { id: "cat_sweet",  ar: "حلا",   emoji: "🍰" },
  { id: "cat_event",  ar: "ترفيه", emoji: "🎭" },
  { id: "cat_bar",    ar: "بارات", emoji: "🍸" },
];

const ROW_C_QUICK: Chip[] = [
  { id: "popular",    ar: "رائج",        emoji: "🔥" },
  { id: "rating_4_5", ar: "تقييم ٤.٥+",  emoji: "★" },
  { id: "near_user",  ar: "قريب مني",    emoji: "📍" },
  { id: "open_now",   ar: "مفتوح الآن",  emoji: "🕐" },
];

// Riviera-appropriate cuisine subset — shown only while مطاعم is active.
const ROW_C_CUISINES: Chip[] = [
  { id: "cuisine_french",   ar: "فرنسي",  emoji: "" },
  { id: "cuisine_italian",  ar: "إيطالي", emoji: "" },
  { id: "cuisine_japanese", ar: "ياباني", emoji: "" },
  { id: "cuisine_seafood",  ar: "بحري",   emoji: "" },
  { id: "cuisine_pizza",    ar: "بيتزا",  emoji: "" },
  { id: "cuisine_lebanese", ar: "لبناني", emoji: "" },
];

// Shared chip look — 36px visual per prototype (dense filter row), glass
// inactive / solid sea active. Theme-aware: every color is a token.
const chipCls = (on: boolean) =>
  `shrink-0 inline-flex items-center gap-1 h-9 px-[14px] rounded-[20px] text-[12.5px] font-semibold whitespace-nowrap border transition active:scale-95 ${
    on
      ? "bg-sea text-white border-transparent shadow-[0_4px_12px_var(--elev)]"
      : "bg-[var(--glass)] backdrop-blur-md text-chipink border-line shadow-[0_4px_12px_var(--elev)]"
  }`;

// ١ ٢ ٣ — Arabic-Indic numerals for the day-selector badges.
const arNum = (n: number) => new Intl.NumberFormat("ar-SA").format(n);

const QUICK_CHIPS: Chip[] = [
  { id: "open_now",     ar: "مفتوح الآن",    emoji: "🟢" },
  { id: "near_hotel",   ar: "قريب من فندقك", emoji: "🏨" },
  { id: "rating_4_5",   ar: "★ ٤.٥+",        emoji: "⭐" },
  { id: "hidden_gem",   ar: "جوهرة مخفية",   emoji: "💎" },
  { id: "new_open",     ar: "جديد",          emoji: "🆕" },
  { id: "luxury",       ar: "فاخر",           emoji: "💰" },
  { id: "budget",       ar: "اقتصادي",       emoji: "💵" },
  { id: "saved",        ar: "محفوظ",         emoji: "💝" },
];

// Focus chips shown inside the trending section — answers "الترند يبحث
// عن ايش؟". Compact horizontal-scroll matches app chip language and fits
// iPhone SE 375px. Order: neutral "all" first, then most-tapped categories.
const FOCUS_CHIPS: Array<{ key: CategoryFocus; ar: string; emoji: string }> = [
  { key: "all",     ar: "الكل",     emoji: "✨" },
  { key: "coffee",  ar: "قهاوي",    emoji: "☕" },
  { key: "food",    ar: "مطاعم",    emoji: "🍽" },
  { key: "sweet",   ar: "حلويات",   emoji: "🍰" },
  { key: "sight",   ar: "معالم",    emoji: "🏛" },
  { key: "nature",  ar: "طبيعة",    emoji: "🌿" },
  { key: "brunch",  ar: "برانش",    emoji: "🥐" },
  { key: "bar",     ar: "بار",      emoji: "🍸" },
];

// Standalone trending chip — has its own prominent section at the top of
// the filter sheet. Always tappable (no opacity gating) — when count=0 it
// triggers a scan; otherwise it toggles the filter.
const TRENDING_CHIP: Chip = { id: "trending", ar: "ترند الآن", emoji: "🔥" };

// Scan focus → category chip. After a FOCUSED scan we auto-activate the
// matching category chip alongside 🔥 so the results view honors the focus
// (trend rows are append-only — other categories' old scores never clear).
// brunch/breakfast are kind-hints inside food; "all" maps to nothing.
const FOCUS_TO_CATEGORY_CHIP: Partial<Record<CategoryFocus, DiscoverFilterId>> = {
  food: "cat_food",
  coffee: "cat_coffee",
  brunch: "cat_food",
  breakfast: "cat_food",
  sight: "cat_sight",
  nature: "cat_nature",
  sweet: "cat_sweet",
  event: "cat_event",
  bar: "cat_bar",
};

const ADVANCED_QUALITY: Chip[] = [
  { id: "michelin",         ar: "ميشلان",       emoji: "⭐" },
  { id: "fine_dining",      ar: "فاين داينينق", emoji: "🎩" },
  { id: "specialty_coffee", ar: "قهوة مختصة",   emoji: "☕" },
  { id: "editor_pick",      ar: "اختيار محرّر", emoji: "✨" },
  { id: "highly_rated",     ar: "★ ٤.٨+",       emoji: "🌟" },
  // "new_spot" (heuristic) intentionally hidden — replaced by the hard
  // `new_open` signal (earliest_review_at) in QUICK_CHIPS above.
];

// ─── Free-text search normalization ─────────────────────────────────────
// Case + diacritic-insensitive so "Café" matches "cafe" and "قهوة مختصّة"
// matches "قهوه مختصه". Covers Latin accents and Arabic tashkeel/hamza/taa
// marbuta variants — catalogue names mix French + Arabic freely.
function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")        // Latin diacritics (é → e)
    .replace(/[\u064b-\u0652\u0670\u0640]/g, "") // Arabic tashkeel + tatweel
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627") // hamza variants → bare alef
    .replace(/\u0649/g, "\u064a")             // alef maqsura → yaa
    .replace(/\u0629/g, "\u0647")             // taa marbuta → haa
    .trim();
}

// ─── Sheet focus management ──────────────────────────────────────────────
// Shared by the filter sheet + the delete-confirm sheet. Mirrors
// PlaceDetailSheet's window-keydown Escape pattern and adds the rest of the
// modal a11y contract: focus moves INTO the sheet on open, Tab cycles inside
// it, and the trigger element regains focus on close (WCAG 2.4.3).
// Attach the returned ref + tabIndex={-1} to the sheet container.
// onClose lives in a ref so the mount-only effect never re-runs when callers
// pass inline closures.
function useSheetFocusTrap(onClose: () => void) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const focusables = Array.from(el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((n) => n.offsetParent !== null); // skip display:none nodes
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        // Wrap backwards off the first focusable (or the container itself).
        if (active === first || active === el) { e.preventDefault(); last.focus(); }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Hand focus back to whatever opened the sheet (⚙ button / حذف).
      prev?.focus();
    };
  }, []);
  return sheetRef;
}
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
  initialView,
  tripDays,
  planItems,
  userRatings,
  userVerdicts,
  userTaste,
  isAdmin = false,
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
  /** Initial discover-tab view from ?view=list|map — defaults to map. */
  initialView: "map" | "list";
  /** All days for this trip (sorted ascending). Drives the day dropdown
   *  when the plan tab is active. */
  tripDays: ItineraryDay[];
  /** Itinerary items with their places joined. The plan tab filters to the
   *  selected day and renders numbered markers + a simple list. */
  planItems: PlanItemRow[];
  /** place_id → stars (1..5) from user_place_ratings — feeds the SmartScore
   *  sort so places the user rated well rank above crowd-favourites. */
  userRatings: Record<string, number>;
  /** place_id → verdict from user_place_ratings ("love" lifts, "skip" sinks). */
  userVerdicts: Record<string, "love" | "meh" | "skip">;
  /** Taste profile inferred from the user's full history (itinerary + saves
   *  + ratings). Null-safe — EMPTY_TASTE has affinityCount 0 and is inert. */
  userTaste: UserTaste | null;
  /** True when the signed-in user may trigger PAID trending scans. Non-admins
   *  still see the ترند segment + already-scanned results (scores live on the
   *  place rows) — only the scan/refresh ACTIONS are hidden. */
  isAdmin?: boolean;
}) {
  // Merged discover+plan into one map view. `planOnly` filters the map to
  // the day's plan items when the user wants focus; otherwise discover pins
  // + numbered plan pins share the same view.
  const [planOnly, setPlanOnly] = useState(initialTab === "plan");
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
  const [viewMode, setViewMode] = useState<"map" | "list">(initialView);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  // ── Free-text search over the already-loaded catalogue ──
  // Pure client-side filter (no network). Persistent glass field in header
  // Row A (design_handoff_rihla_app) — no more toggled row.
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
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
  /** Increment when activeCity changes so the map snaps to the new city's
   *  bounds. Prevents the "list says موناكو, map still shows مونتون" mismatch
   *  the user just hit. */
  const [cityChangeTick, setCityChangeTick] = useState(0);
  // Watch activeCity — bump the tick on every change (including → null).
  useEffect(() => {
    setCityChangeTick((t) => t + 1);
  }, [activeCity]);
  /** Increment on EVERY explicit place tap (card or marker). Ensures the map
   *  pans even when the user re-taps the same card (selectedId unchanged). */
  const [focusTick, setFocusTick] = useState(0);
  const cityAutoSetRef = useRef(false);
  // Set once the user EXPLICITLY picks a city — auto-pick must never
  // override a manual selection.
  const cityTouchedRef = useRef(false);
  const router = useRouter();

  // Stable handlers — without these, DiscoverMap's cluster effect re-binds
  // marker click closures on every parent render (audit fix 2026-06-16).
  const handleSelect = useCallback((p: Place) => {
    setSelectedId(p.id);
    setFocusTick((t) => t + 1);
    // Warm the sheet hero photo now so tapping "التفاصيل" opens instantly
    // instead of showing a blank hero while the image starts loading.
    const src = p.photo_urls?.[0] ?? p.photo_url;
    if (src && typeof window !== "undefined") {
      new window.Image().src = src;
    }
  }, []);
  const handleOpenDetail = useCallback((p: Place) => setDetailPlace(p), []);
  const handleCityChange = useCallback((c: string | null) => {
    cityTouchedRef.current = true;
    setActiveCity(c);
    // When user picks "كل المنطقة" (null), zoom the map to fit every city.
    // Previously the standalone 🌍 button owned this; now the dropdown is
    // the sole entry point, so it must trigger the fit-all itself.
    if (c == null) setFitAllTick((t) => t + 1);
  }, []);
  const handleSortChange = useCallback((m: SortMode) => {
    setSortMode(m);
    setSelectedId(null);
  }, []);
  // Stable identity for the carousel's "clear filters" CTA — was an inline
  // arrow that broke MapBottomCarousel's memo on every parent render.
  // Also resets the search query — a 0-result state can come from either.
  const handleClearFilters = useCallback(() => {
    setActiveFilters(new Set());
    setSearchQuery("");
  }, []);

  // ── Header height → map offset ──
  // The 3-row header's height varies (scope, day cards, wrap) so we MEASURE
  // it instead of hand-computing. ResizeObserver keeps the map body + toasts
  // aligned when Row C swaps between chip row and day selector.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerOffsetPx, setHeaderOffsetPx] = useState(158); // SSR fallback
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderOffsetPx(Math.round(el.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
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
  // Hoist the hotel-for-sheet object so PlaceDetailSheet's internal memos
  // don't invalidate on every parent re-render (object literal identity).
  const hotelForSheet = useMemo(
    () => (hotelLoc ? { ...hotelLoc, name: trip.hotel_name ?? "فندقك" } : null),
    [hotelLoc, trip.hotel_name],
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

  // Bucket "now" into 1-minute slots so filters like `open_now` stay accurate
  // during long sessions without invalidating the memo every render. The
  // previous `new Date()` was frozen until another dep moved — a user who sat
  // on the map across a closing-time boundary would see stale "مفتوح" data.
  const [nowMinuteBucket, setNowMinuteBucket] = useState(
    () => Math.floor(Date.now() / 60_000),
  );
  useEffect(() => {
    const t = setInterval(
      () => setNowMinuteBucket(Math.floor(Date.now() / 60_000)),
      30_000,
    );
    return () => clearInterval(t);
  }, []);
  const filterNow = useMemo(
    () => new Date(nowMinuteBucket * 60_000),
    [nowMinuteBucket],
  );

  const filterCtx = useMemo<FilterContext>(
    // savedSet is the live merged set (server snapshot ⊕ optimistic toggles).
    // Using `initialSavedSet` here was a bug: the "محفوظ" chip count + the
    // filter predicate were frozen to server state, so optimistic save/unsave
    // didn't reflect in counts or in the SmartScore reorder until refresh.
    () => ({ savedSet, now: filterNow, hotel: hotelLoc, user: userLoc, popularSet }),
    [savedSet, filterNow, hotelLoc, userLoc, popularSet],
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

  // Free-text search — applied after filters + city scope (same pipeline the
  // chips use) so pins, carousel and list all reflect matches live. Every
  // whitespace-separated token must match SOMEWHERE in name/kind/city/tags/
  // highlights (AND semantics — "بيتزا نيس" narrows, not widens).
  const searchTokens = useMemo(
    () => normalizeSearch(searchQuery).split(/\s+/).filter(Boolean),
    [searchQuery],
  );
  const searched = useMemo(() => {
    if (searchTokens.length === 0) return cityScoped;
    return cityScoped.filter((p) => {
      const hay = normalizeSearch([
        p.name,
        p.kind ?? "",
        p.city_label ?? p.city ?? "",
        ...(p.tags ?? []),
        ...(p.highlights ?? []),
      ].join(" "));
      return searchTokens.every((t) => hay.includes(t));
    });
  }, [cityScoped, searchTokens]);

  // Apply the user's sort preference. Default "near" sorts by haversine from
  // user (or hotel fallback). "rating" by Google rating descending. "score"
  // by our SmartScore so editorial + taste signals lift gems above raw
  // crowd-favourites — the explicit "better than Google Maps" lever.
  const sorted = useMemo(() => {
    const anchor = userLoc ?? hotelLoc;
    const slice = [...searched];

    // When the 🔥 filter is on the user's intent is "show me what's viral,
    // most-viral first" — override sortMode so the carousel orders by score.
    if (activeFilters.has("trending")) {
      return slice.sort((a, b) => (b.trending_score ?? 0) - (a.trending_score ?? 0)
        || (b.rating ?? 0) - (a.rating ?? 0));
    }

    if (sortMode === "near") {
      // No anchor (GPS denied + no hotel) — the chip promised "قريب" but
      // there's no reference point. Fall back to rating so the ranking is
      // at least honest instead of showing raw DB order (audit fix).
      if (!anchor) {
        return slice.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      }
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
          now: filterNow,
          hotelLocation: hotelLoc,
          userLocation: userLoc,
          budgetStyle: trip.budget_style,
          userSaved: savedSet.has(p.id),
          // Real user history — was hardcoded null, which meant the flagship
          // map surface ignored the user's own ratings/verdicts entirely.
          userRating: userRatings[p.id] ?? null,
          userVerdict: userVerdicts[p.id] ?? null,
          userTaste,
        });
        return { p, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }, [searched, sortMode, userLoc, hotelLoc, savedSet, trip.budget_style, activeFilters, filterNow, userRatings, userVerdicts, userTaste]);

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

  // Warm the dynamic chunk for PlaceDetailSheet — deferred until the browser
  // is idle so it doesn't race the map tiles + first carousel photos for
  // bandwidth on 4G. The warmup still completes well before the user can tap
  // "عرض التفاصيل", so first-tap latency stays instant.
  useEffect(() => {
    type Idle = (cb: () => void) => number;
    const win = window as Window & {
      requestIdleCallback?: Idle;
      cancelIdleCallback?: (h: number) => void;
    };
    const rIC: Idle = win.requestIdleCallback ?? ((cb) => window.setTimeout(cb, 1500));
    const id = rIC(() => { import("@/components/PlaceDetailSheet").catch(() => {}); });
    return () => {
      if (win.cancelIdleCallback) win.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, []);

  // Auto-pick closest city to user location (once). Walks ALL loaded places
  // and picks whichever city's nearest place is < 30 km from the user.
  // Guard is cityTouchedRef (manual pick), NOT activeCity — activeCity
  // defaults to tripCities[0] so the old `|| activeCity` guard always
  // bailed and this was dead code (geo audit fix).
  useEffect(() => {
    if (cityAutoSetRef.current || cityTouchedRef.current || !userLoc || places.length === 0) return;
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
    if (closest && minKm < 30 && closest !== activeCity) setActiveCity(closest);
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
    router.replace(`/trips/${trip.id}/map?expand=region${planOnly ? "&tab=plan" : ""}`);
  }, [userOutOfPlan, expandedToRegion, router, trip.id, planOnly]);

  // Counts shown on each chip (drives badge + 0-state hide)
  // Only compute the full catalogue id list when the filter sheet is open.
  // When closed, only the Row C chips need counts — avoids extra
  // full-catalogue filter passes on every minute-tick + GPS update.
  const cuisineRowVisible = activeFilters.has("cat_food");
  const allIds = useMemo(
    () => (filterSheetOpen
      ? [TRENDING_CHIP, ...CATEGORY_CHIPS, ...QUICK_CHIPS, ...ADVANCED_QUALITY].map((c) => c.id)
      : [...ROW_C_CATEGORIES, ...ROW_C_QUICK, ...(cuisineRowVisible ? ROW_C_CUISINES : [])].map((c) => c.id)),
    [filterSheetOpen, cuisineRowVisible],
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

  // ── Trending breakdown (TikTok / Instagram) for the promoted 🔥 row ──
  // Re-computed when the city scope changes. Same isTrendingNow gate as the
  // filter predicate so the count matches what the user actually sees.
  const trendingStats = useMemo(() => {
    const inScope = activeCity
      ? places.filter((p) => (p.city_label ?? p.city) === activeCity)
      : places;
    let total = 0, tiktok = 0, instagram = 0, both = 0;
    for (const p of inScope) {
      if (!isTrendingNow(p, filterNow)) continue;
      total++;
      if (p.trending_source === "tiktok") tiktok++;
      else if (p.trending_source === "instagram") instagram++;
      else if (p.trending_source === "both") both++;
    }
    return { total, tiktok, instagram, both };
  }, [places, activeCity, filterNow]);

  const trendingActive = activeFilters.has("trending");

  // Manual "اجلب الترند" — scans the currently-selected city (or the
  // stalest one in the user's plan) via /api/admin/trending-scan. Cron
  // handles the autopilot path; this is the human-in-the-loop button.
  const [scanState, setScanState] = useState<"idle" | "loading" | "error">("idle");
  const [scanFocus, setScanFocus] = useState<CategoryFocus>("all");
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  // ── Plan-tab data ─────────────────────────────────────────────────────
  const planItemsForDay = useMemo(() => {
    if (!selectedDayId) return [];
    return planItems
      .filter((it) => it.day_id === selectedDayId)
      .sort((a, b) => a.position - b.position);
  }, [planItems, selectedDayId]);

  // numberedPlaces: place_id → 1-based position for the selected day.
  // Always computed so plan pins render as numbered sea pins alongside the
  // outline discover pins in the merged view.
  const numberedPlaces = useMemo(() => {
    const m = new Map<string, number>();
    planItemsForDay.forEach((it, idx) => m.set(it.place_id, idx + 1));
    return m;
  }, [planItemsForDay]);

  // Merged place set: plan-only mode → just the day's items; otherwise
  // discover catalogue overlaid with plan items (dedupe by id).
  const mapPlaces = useMemo(() => {
    const planPlaces = planItemsForDay.map((it) => it.places);
    if (planOnly) return planPlaces;
    const ids = new Set(searched.map((p) => p.id));
    return [...searched, ...planPlaces.filter((p) => !ids.has(p.id))];
  }, [planOnly, searched, planItemsForDay]);

  const triggerScan = useCallback(async (opts?: { force?: boolean; focus?: CategoryFocus }) => {
    if (scanState === "loading") return;
    setScanState("loading");
    setScanMsg(null);
    try {
      const body: Record<string, unknown> = activeCity
        ? { city_label: activeCity }
        : { all_trip_cities: true };
      if (opts?.force) body.force = true;
      if (opts?.focus && opts.focus !== "all") body.category_focus = opts.focus;
      const r = await fetch("/api/admin/trending-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error ?? `http_${r.status}`);
      // Server may return `cached: true` when the last scan for this city is
      // within the 72h TTL and the user did NOT explicitly force a refresh.
      // We surface it in the toast so the user understands why nothing spun.
      if (json.cached) {
        setScanMsg(
          `الترند محدّث لـ${json.city} — آخر فحص قبل ${json.hoursAgo}س (اضغط "حدّث الآن" لفرض)`,
        );
      } else if (json.empty) {
        setScanMsg(`ما في مرشحين كافيين في ${json.city ?? "هذه المدينة"}`);
      } else if (!json.written) {
        setScanMsg(`فحصنا ${json.candidates ?? 0} مرشح في ${json.city} — ما انلقى ترند مطابق`);
      } else {
        setScanMsg(`✓ ${json.city}: ${json.written} ترند · $${(json.costUsd ?? 0).toFixed(3)}`);
      }
      setScanState("idle");
      // Auto-activate the trending filter so the user sees the results —
      // works both on fresh scans and on cached hits (they may want to view
      // existing data too).
      //
      // When the scan had a category FOCUS (e.g. "☕ قهاوي") also activate
      // that category chip. Trend rows are append-only in the DB, so old
      // scans' sights/restaurants still carry scores — without the category
      // AND, a coffee-focused scan would surface برج المملكة next to the
      // cafés. Category chips OR among themselves, so we REPLACE any active
      // cat_ chips with the focused one (focus = explicit user intent).
      if (json.cached || (!json.empty && json.written > 0)) {
        const focusCat = FOCUS_TO_CATEGORY_CHIP[opts?.focus ?? "all"];
        setActiveFilters((s) => {
          const next = new Set(s);
          if (focusCat) {
            for (const id of next) {
              if (id.startsWith("cat_")) next.delete(id);
            }
            next.add(focusCat);
          }
          next.add("trending");
          return next;
        });
      }
      router.refresh();
    } catch (e) {
      setScanState("error");
      setScanMsg(e instanceof Error ? e.message : "خطأ");
    }
  }, [activeCity, scanState, router]);

  // Error toasts stay up 12s (users need to read the reason); success 5s.
  useEffect(() => {
    if (!scanMsg) return;
    const t = setTimeout(() => setScanMsg(null), scanState === "error" ? 12000 : 5000);
    return () => clearTimeout(t);
  }, [scanMsg, scanState]);

  // ── Scope segmented control (خطتي · 🔥 ترند · الكل) ────────────────────
  // A veneer over EXISTING state — no new filter wiring:
  //   خطتي  → planOnly=true
  //   ترند  → planOnly=false + "trending" filter (auto-scan when no data,
  //           same as the old 🔥 chip)
  //   الكل  → planOnly=false + "trending" removed
  const scope: "plan" | "trend" | "all" =
    planOnly ? "plan" : trendingActive ? "trend" : "all";
  const selectScope = useCallback((next: "plan" | "trend" | "all") => {
    if (next === "plan") { setPlanOnly(true); return; }
    setPlanOnly(false);
    if (next === "trend") {
      if (trendingStats.total === 0 && isAdmin) {
        // No trend data yet → kick a scan (auto-activates 🔥 on success).
        // Admin-only: scans cost money. Non-admins just get the filter —
        // it reads whatever scores the last admin/cron scan wrote.
        if (scanState !== "loading") triggerScan();
      } else {
        setActiveFilters((s) => new Set(s).add("trending"));
      }
    } else {
      setActiveFilters((s) => {
        const n = new Set(s);
        n.delete("trending");
        return n;
      });
    }
  }, [trendingStats.total, scanState, triggerScan, isAdmin]);

  // Category chips keep the existing multi-toggle semantics. Turning مطاعم
  // OFF also clears cuisine_* so a hidden cuisine filter can't keep silently
  // narrowing results after its row disappears.
  const toggleCategory = useCallback((id: DiscoverFilterId) => {
    setActiveFilters((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
        if (id === "cat_food") {
          for (const f of Array.from(next)) if (f.startsWith("cuisine_")) next.delete(f);
        }
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  // "✦ الكل" — clears every category + cuisine filter (quick filters stay).
  const clearCategories = useCallback(() => {
    setActiveFilters((s) => {
      const next = new Set(s);
      for (const f of Array.from(next)) {
        if (f.startsWith("cat_") || f.startsWith("cuisine_")) next.delete(f);
      }
      return next;
    });
  }, []);
  const anyCategoryActive = Array.from(activeFilters).some((f) => f.startsWith("cat_"));

  return (
    <main className="fixed inset-0 bg-sand overflow-hidden">
      {/* ─── Header panel — 3 rows over the map (design_handoff_rihla_app §1)
          Solid bg-sand + soft bottom shadow. Every color is a theme token so
          the whole panel re-skins on `.dark`. */}
      <div
        ref={headerRef}
        className="absolute top-0 inset-x-0 z-[900] bg-sand shadow-[0_10px_22px_-10px_var(--elev2)]"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="px-3 pt-1.5 pb-3 space-y-2">
          {/* ── Row A: back · city pill · search · advanced filters ── */}
          <div className="flex items-center gap-2">
            <Link
              href="/trips"
              aria-label={`رجوع — ${trip.name}`}
              title={trip.name}
              className="shrink-0 w-11 h-11 rounded-full bg-[var(--glass)] backdrop-blur-md border border-line text-ink grid place-items-center shadow-[0_4px_12px_var(--elev)] active:scale-95 transition"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </Link>
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
            {/* Search — persistent glass pill. 16px input (iOS no-zoom),
                clear ✕ when text. Focusing while خطتي is active switches to
                الكل because search never applied to plan pins. */}
            <div className="relative flex-1 min-w-0">
              <SearchIcon
                size={16}
                aria-hidden="true"
                className="absolute top-1/2 -translate-y-1/2 right-3.5 text-muted pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="search"
                dir="rtl"
                enterKeyHint="search"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => { if (planOnly) setPlanOnly(false); }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchQuery("");
                  // Dismiss the iOS keyboard so the pins/carousel show.
                  else if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                placeholder={`ابحث في ${activeCity ?? "الأماكن"}…`}
                aria-label="ابحث في أماكن الخريطة"
                // text-[16px] — anything smaller triggers iOS Safari auto-zoom.
                className="w-full h-11 ps-9 pe-10 rounded-pill bg-[var(--glass)] backdrop-blur-md border border-line text-ink placeholder:text-muted font-semibold text-[16px] shadow-[0_4px_12px_var(--elev)] focus:outline-none focus:border-sea [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery !== "" && (
                <button
                  type="button"
                  // Keep input focus when clearing — preventDefault stops the
                  // blur that a mousedown would otherwise trigger.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                  aria-label="امسح البحث"
                  className="absolute top-1/2 -translate-y-1/2 left-0.5 w-10 h-10 grid place-items-center text-muted active:scale-90 transition"
                >
                  <XIcon size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {/* ⚙ فلاتر — circular glass, coral count badge when active. */}
            <button
              onClick={() => setFilterSheetOpen(true)}
              title="افتح الفلاتر"
              aria-label={`افتح الفلاتر${activeFilters.size > 0 ? ` (${activeFilters.size} مفعّل)` : ""}`}
              className="relative shrink-0 w-11 h-11 rounded-full bg-[var(--glass)] backdrop-blur-md border border-line text-ink grid place-items-center shadow-[0_4px_12px_var(--elev)] active:scale-95 transition"
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
              {activeFilters.size > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-coral text-white text-[10px] font-extrabold min-w-[16px] h-4 px-1 grid place-items-center rounded-full">
                  {activeFilters.size}
                </span>
              )}
            </button>
          </div>

          {/* ── Row B: scope segmented control · count · GPS · view toggle ──
              The segment is a veneer over EXISTING state (planOnly +
              "trending" filter) — see selectScope. */}
          <div className="flex items-center gap-2">
            <div
              role="tablist"
              aria-label="نطاق الخريطة"
              className="flex bg-[var(--glass)] backdrop-blur-md border border-line rounded-[20px] p-[3px] shadow-[0_4px_12px_var(--elev)]"
            >
              {([
                { key: "plan" as const, label: "خطتي" },
                { key: "trend" as const, label: "ترند" },
                { key: "all" as const, label: "الكل" },
              ]).map((seg) => {
                const on = scope === seg.key;
                return (
                  <button
                    key={seg.key}
                    onClick={() => selectScope(seg.key)}
                    role="tab"
                    aria-selected={on}
                    aria-label={
                      seg.key === "trend"
                        ? (scanState === "loading" ? "جارٍ البحث عن الترند"
                          : trendingStats.total > 0 ? `ترند (${trendingStats.total} مكان)`
                          : isAdmin ? "ترند — اضغط للجلب" : "ترند")
                        : seg.label
                    }
                    // after:* expands the 34px visual to a ≥44px hit area.
                    className={`relative h-[34px] px-[14px] rounded-[17px] text-[12.5px] font-semibold whitespace-nowrap transition active:scale-95 after:absolute after:-inset-y-2 after:-inset-x-0.5 after:content-[''] ${
                      on ? "bg-card text-sea-strong shadow-[0_2px_8px_var(--elev)]" : "text-muted"
                    }`}
                  >
                    {seg.key === "trend" ? (
                      <span className="inline-flex items-center gap-1">
                        {scanState === "loading"
                          ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                          : <span aria-hidden="true">🔥</span>}
                        <span>ترند</span>
                      </span>
                    ) : seg.label}
                  </button>
                );
              })}
            </div>
            <div className="ms-auto flex items-center gap-1.5">
              {/* Result count — the app has no streak feature, so the
                  prototype's streak-chip slot shows the live result count. */}
              <span
                className="inline-flex items-center gap-1 h-[34px] px-3 rounded-[17px] bg-[var(--glass)] backdrop-blur-md border border-line text-ink text-[12px] font-bold tabular-nums shadow-[0_4px_12px_var(--elev)]"
                aria-label="عدد النتائج"
              >
                <MapIcon size={13} aria-hidden="true" />
                {planOnly ? planItemsForDay.length : sorted.length}
              </span>
              {/* موقعي / الفندق — recenter. */}
              {(userLoc || hotelLoc) && (
                <button
                  onClick={() => setRecenterTick((t) => t + 1)}
                  title={userLoc ? "ركّز على موقعي" : "ركّز على فندقي"}
                  aria-label={userLoc ? "ركّز الخريطة على موقعي" : "ركّز الخريطة على فندقي"}
                  className="relative shrink-0 w-[34px] h-[34px] rounded-full bg-[var(--glass)] backdrop-blur-md border border-line text-ink grid place-items-center shadow-[0_4px_12px_var(--elev)] active:scale-95 transition after:absolute after:-inset-[5px] after:content-[''] after:rounded-full"
                >
                  {userLoc ? <MapPin size={16} aria-hidden="true" /> : <Hotel size={16} aria-hidden="true" />}
                </button>
              )}
              {/* 🗺 ↔ ☰ view toggle — discover only (plan has its own list). */}
              {!planOnly && (
                <button
                  onClick={() => setViewMode((v) => (v === "map" ? "list" : "map"))}
                  title={viewMode === "map" ? "عرض كقائمة" : "عرض كخريطة"}
                  aria-label={viewMode === "map" ? "بدّل لعرض القائمة" : "بدّل لعرض الخريطة"}
                  className="relative shrink-0 w-[34px] h-[34px] rounded-full bg-[var(--glass)] backdrop-blur-md border border-line text-ink grid place-items-center shadow-[0_4px_12px_var(--elev)] active:scale-95 transition after:absolute after:-inset-[5px] after:content-[''] after:rounded-full"
                >
                  {viewMode === "map" ? <ListIcon size={16} aria-hidden="true" /> : <MapIcon size={16} aria-hidden="true" />}
                </button>
              )}
            </div>
          </div>

          {/* ── Row C (contextual) — day selector in خطتي, chips otherwise ── */}
          {planOnly && tripDays.length > 0 && (
            <div className="flex items-center gap-[9px]">
              {/* 🗺 خطتك label chip */}
              <div className="shrink-0 inline-flex items-center gap-1.5 bg-sea/10 rounded-[14px] px-[11px] py-[7px]">
                <span className="text-[14px]" aria-hidden="true">🗺</span>
                <span className="text-[12px] font-extrabold text-sea-strong">خطتك</span>
              </div>
              {/* Day selector — replaces the old <select>. Gregorian Arabic
                  dates (design shows ١٣ يوليو, not Hijri). */}
              <div className="flex-1 flex gap-2 overflow-x-auto scrollbar-thin pb-0.5">
                {tripDays.map((d, i) => {
                  const on = d.id === selectedDayId;
                  const date = new Date(d.day_date);
                  const dayName = date.toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "long" });
                  const dayDate = date.toLocaleDateString("ar-SA-u-ca-gregory", { day: "numeric", month: "long" });
                  return (
                    <button
                      key={d.id}
                      onClick={() => setSelectedDayId(d.id)}
                      aria-pressed={on}
                      aria-label={`اليوم ${i + 1} — ${dayName} ${dayDate}`}
                      className={`shrink-0 flex items-center gap-[9px] ps-[10px] pe-[13px] py-[9px] rounded-[16px] border transition active:scale-95 ${
                        on
                          ? "bg-gradient-to-b from-sea to-sea-600 text-white border-transparent shadow-[0_6px_16px_var(--elev2)]"
                          : "bg-card border-line shadow-[0_2px_8px_var(--elev)]"
                      }`}
                    >
                      <span
                        className={`w-[30px] h-[30px] rounded-[10px] grid place-items-center font-extrabold text-[14px] ${
                          on ? "bg-white/20 text-white" : "bg-sea/10 text-sea-strong"
                        }`}
                        aria-hidden="true"
                      >
                        {arNum(i + 1)}
                      </span>
                      <span className="text-start">
                        <span className={`block text-[12px] font-bold whitespace-nowrap leading-tight ${on ? "text-white" : "text-ink"}`}>
                          {dayName}
                        </span>
                        <span className={`block text-[10px] whitespace-nowrap leading-tight mt-px ${on ? "text-white/80" : "text-muted"}`}>
                          {dayDate}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Browse scopes (ترند/الكل) — one smooth horizontal row:
              categories → divider → quick filters → cuisines (مطاعم only)
              → divider → sort. */}
          {!planOnly && (
            <div className="relative">
              {/* Fade on the left edge (RTL scroll direction) hints there
                  are more chips. from-sand matches the solid panel bg. */}
              <div className="pointer-events-none absolute left-0 top-0 bottom-0.5 w-8 z-[1] bg-gradient-to-r from-sand to-transparent" />
              <div className="flex items-center gap-[7px] overflow-x-auto scrollbar-thin pb-0.5">
                {/* ✦ الكل — clears every category (+cuisine) filter */}
                <button
                  onClick={clearCategories}
                  aria-pressed={!anyCategoryActive}
                  aria-label="كل الفئات"
                  className={chipCls(!anyCategoryActive)}
                >
                  <span aria-hidden="true">✦</span>
                  <span>الكل</span>
                </button>
                {ROW_C_CATEGORIES.map((c) => {
                  const on = activeFilters.has(c.id);
                  const n = counts[c.id] ?? 0;
                  if (n === 0 && !on) return null;
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCategory(c.id)}
                      aria-pressed={on}
                      aria-label={`فلتر ${c.ar}${n > 0 ? ` (${n} مكان)` : ""}`}
                      className={chipCls(on)}
                    >
                      <span aria-hidden="true">{c.emoji}</span>
                      <span>{c.ar}</span>
                    </button>
                  );
                })}
                <span className="shrink-0 w-px h-[22px] bg-line mx-[3px]" aria-hidden="true" />
                {ROW_C_QUICK.map((c) => {
                  const on = activeFilters.has(c.id);
                  const n = counts[c.id] ?? 0;
                  if (n === 0 && !on) return null;
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      aria-pressed={on}
                      aria-label={`فلتر ${c.ar}${n > 0 ? ` (${n} مكان)` : ""}`}
                      className={chipCls(on)}
                    >
                      <span aria-hidden="true">{c.emoji}</span>
                      <span>{c.ar}</span>
                      {/* suppressHydrationWarning: counts include the
                          time-dependent مفتوح الآن filter. */}
                      {n > 0 && (
                        <span aria-hidden="true" suppressHydrationWarning className={`text-[9px] tabular-nums ${on ? "opacity-95" : "opacity-60"}`}>
                          {n}
                        </span>
                      )}
                    </button>
                  );
                })}
                {/* Cuisine chips — only while مطاعم is active */}
                {cuisineRowVisible && ROW_C_CUISINES.map((c) => {
                  const on = activeFilters.has(c.id);
                  const n = counts[c.id] ?? 0;
                  if (n === 0 && !on) return null;
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      aria-pressed={on}
                      aria-label={`مطبخ ${c.ar}${n > 0 ? ` (${n} مكان)` : ""}`}
                      className={chipCls(on)}
                    >
                      <span>{c.ar}</span>
                    </button>
                  );
                })}
                <span className="shrink-0 w-px h-[22px] bg-line mx-[3px]" aria-hidden="true" />
                {/* Sort chips — kept from the old header, restyled to match */}
                {SORT_LABELS.map((s) => {
                  const on = sortMode === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => handleSortChange(s.key)}
                      aria-pressed={on}
                      aria-label={`رتّب بـ${s.ar}`}
                      className={chipCls(on)}
                    >
                      <SortIcon k={s.key} /><span>{s.ar}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Scan toast — floating, non-blocking. Auto-dismisses after 5s. */}
      {scanMsg && (
        <div
          className="absolute z-[950] left-1/2 -translate-x-1/2 max-w-[90vw]"
          style={{ top: headerOffsetPx + 6 }}
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
          className="absolute z-[940] left-1/2 -translate-x-1/2 max-w-[90vw] px-3.5 py-2 rounded-pill bg-card border-2 border-sea/60 shadow-2xl text-[11.5px] font-extrabold text-sea-strong inline-flex items-center gap-1.5 active:scale-95 transition"
          style={{ top: headerOffsetPx + 6 }}
          aria-label="موقعك خارج خطتك — تَوسَّع لكامل المنطقة"
        >
          <span>📍</span>
          <span>موقعك خارج خطتك ·</span>
          <span className="text-danger">استكشف {regionAr}</span>
          <span className="opacity-60">↗</span>
        </Link>
      )}

      {/* ─── Body ───
          Discover + Map: DiscoverMap (markers) + bottom carousel.
          Discover + List: vertical PlaceListView (Airbnb/Booking style).
          Plan: DiscoverMap + numbered markers + PlanInlineList. */}
      {/* Measured header height already includes the safe-area inset. */}
      <div className="absolute inset-0" style={{ top: headerOffsetPx }}>
        {!planOnly && viewMode === "list" ? (
          <PlaceListView
            places={sorted}
            userLocation={userLoc}
            hotelLocation={hotelLoc}
            onOpenDetail={handleOpenDetail}
            savedSet={savedSet}
            activeCity={activeCity}
            hasActiveFilters={activeFilters.size > 0 || searchTokens.length > 0}
            onClearFilters={handleClearFilters}
          />
        ) : (
          <DiscoverMap
            fullHeight
            hidePopup
            selectedId={selectedId}
            onSelect={handleSelect}
            recenterTrigger={recenterTick}
            fitAllTrigger={fitAllTick}
            cityChangeTrigger={cityChangeTick}
            focusTrigger={focusTick}
            places={mapPlaces}
            totalCount={mapPlaces.length}
            showingAll
            savedSet={savedSet}
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
      {!planOnly && viewMode === "map" && (
        <MapBottomCarousel
          places={sorted}
          selectedId={selectedId}
          userLocation={userLoc}
          hotelLocation={hotelLoc}
          sortMode={sortMode}
          onSelect={handleSelect}
          onOpenDetail={handleOpenDetail}
          savedSet={savedSet}
          hasActiveFilters={activeFilters.size > 0 || searchTokens.length > 0}
          onClearFilters={handleClearFilters}
        />
      )}
      {planOnly && (
        <PlanInlineList
          tripId={trip.id}
          items={planItemsForDay}
          selectedId={selectedId}
          userLocation={userLoc}
          hotelLocation={hotelLoc}
          onSelect={handleSelect}
          onOpenDetail={handleOpenDetail}
          onChanged={() => router.refresh()}
          onShowAll={() => selectScope("all")}
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
          onClear={handleClearFilters}
          onClose={() => setFilterSheetOpen(false)}
          // Scan triggers cost money → admin-only. Non-admins keep the 🔥
          // toggle over already-scanned data; the fetch/refresh CTAs vanish.
          onTriggerScan={isAdmin ? () => triggerScan({ focus: scanFocus }) : undefined}
          onForceRefresh={isAdmin && trendingStats.total > 0 ? () => triggerScan({ force: true, focus: scanFocus }) : undefined}
          scanLoading={scanState === "loading"}
          activeCityLabel={activeCity}
          scanFocus={scanFocus}
          onScanFocusChange={isAdmin ? setScanFocus : undefined}
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
          hotel={hotelForSheet}
          onClose={() => {
            setDetailPlace(null);
            // Re-focus the map on the place so the user sees their pin
            // exactly where they left off after dismissing the modal.
            setFocusTick((t) => t + 1);
          }}
          onSave={async (placeId) => {
            const wasSaved = savedDelta.get(placeId) ?? initialSavedSet.has(placeId);
            setSavedDelta((m) => new Map(m).set(placeId, !wasSaved));
            try {
              const r = await fetch(`/api/trips/${trip.id}/places`, {
                method: wasSaved ? "DELETE" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ place_id: placeId }),
              });
              if (!r.ok) setSavedDelta((m) => new Map(m).set(placeId, wasSaved));
            } catch {
              setSavedDelta((m) => new Map(m).set(placeId, wasSaved));
            }
          }}
          savedSet={savedSet}
          onAddToPlan={async () => {
            // Direct itinerary write — the old `?add=` deep-link died with the
            // trip-hub page. Adds to the selected day (or first day) midday.
            const day = tripDays.find((d) => d.id === selectedDayId) ?? tripDays[0];
            const placeId = detailPlace.id;
            setDetailPlace(null);
            if (!day) return;
            try {
              await fetch(`/api/trips/${trip.id}/itinerary`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day_date: day.day_date, slot: "midday", place_id: placeId }),
              });
              router.refresh();
            } catch { /* silent — user can retry from sheet */ }
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

  // ── Windowed rendering ──
  // Region scope loads up to ~1800 places; rendering them ALL as DOM cards
  // makes first paint + hydration crawl (same finding as MapBottomCarousel's
  // windowing, 2026-07-04). Render a small window and grow it as the user
  // nears the bottom via an IntersectionObserver sentinel — every place is
  // still reachable by scrolling.
  const RENDER_CHUNK = 24;
  const [renderCount, setRenderCount] = useState(RENDER_CHUNK);
  // New list (filter/sort/search change) → snap the window back to the head.
  useEffect(() => { setRenderCount(RENDER_CHUNK); }, [places]);
  const visiblePlaces = places.length > renderCount ? places.slice(0, renderCount) : places;
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderCount((c) => (c >= places.length ? c : c + RENDER_CHUNK));
        }
      },
      // Grow ~2 card-screens before the sentinel actually scrolls into view
      // so the user never sees the list "end" early.
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
    // renderCount dep: re-observe after each grow so a still-visible sentinel
    // keeps loading until it leaves the expanded viewport.
  }, [places.length, renderCount]);

  if (places.length === 0) {
    return (
      <div className="absolute inset-0 overflow-y-auto p-4">
        <div className="bg-card rounded-2xl border border-line p-6 text-center shadow-md">
          <div className="text-4xl mb-2">🔍</div>
          <p className="text-[14px] font-extrabold tracking-tight text-ink mb-1">
            {hasActiveFilters ? "ما لقينا أماكن بهالفلاتر" : `ما في أماكن في ${activeCity ?? "المنطقة"}`}
          </p>
          {hasActiveFilters && (
            <button
              onClick={onClearFilters}
              className="mt-3 text-coral-600 font-extrabold text-[12.5px] min-h-[44px] px-5 rounded-pill bg-coral/10 active:scale-95 transition"
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
      <div className="px-3 pt-2 pb-24 space-y-2">
        <div className="text-[11px] font-bold text-muted px-1">
          {places.length} مكان{activeCity ? ` في ${activeCity}` : " في المنطقة"}
        </div>
        {visiblePlaces.map((p) => {
          // Route through the /api/photo proxy so legacy maps.googleapis.com
          // URLs don't leak the API key (and so daily budget cap applies).
          const photo = photoAtWidth(p.photo_url, 240);
          const distKm = anchor && p.lat != null && p.lng != null
            ? haversineKm(anchor, { lat: p.lat, lng: p.lng })
            : null;
          const distLabel = distKm != null
            ? distKm < 1.5 ? `🚶 ${Math.max(1, Math.round(distKm * 12))}د`
              : `${distKm.toFixed(1)} كم`
            : null;
          const trending = isTrendingNow(p);
          const saved = savedSet.has(p.id);
          const catLabel = p.category === "food" ? "🍽 مطعم"
            : p.category === "coffee" ? "☕ قهوة"
            : p.category === "sight" ? "🏛 معلم"
            : p.category === "nature" ? "🌿 طبيعة"
            : p.category === "sweet" ? "🍰 حلويات"
            : p.category === "event" ? "🎭 ترفيه"
            : p.category === "bar" ? "🍸 بار" : "";
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onOpenDetail(p)}
              className="w-full text-right group bg-card rounded-2xl border border-line overflow-hidden shadow-sm active:scale-[0.99] transition flex items-stretch"
            >
              {/* Larger hero photo for visual presence */}
              <div className="relative shrink-0 w-28 h-32 bg-sand overflow-hidden">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo}
                    alt={p.name}
                    className="w-full h-full object-cover group-active:brightness-90 transition"
                    loading="lazy"
                  />
                ) : (
                  <div className={`w-full h-full grid place-items-center text-5xl bg-gradient-to-br ${CAT_GRADIENT[p.category] ?? "from-sand to-line"}`} aria-hidden="true">{CAT_EMOJI[p.category] ?? "📍"}</div>
                )}
                {/* TOP-LEFT: priority badge (curated places only) */}
                {p.priority === "P1" && (
                  <span className="absolute top-1.5 left-1.5 bg-emerald-600 text-white text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-pill shadow-sm">
                    ⭐ مميز
                  </span>
                )}
                {/* TOP-RIGHT: trending */}
                {trending && (
                  <span className="absolute top-1.5 right-1.5 bg-gradient-to-l from-pink-600 to-orange-700 text-white text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-pill shadow-sm">
                    🔥 ترند
                  </span>
                )}
                {/* BOTTOM-LEFT: saved heart */}
                {saved && (
                  <span className="absolute bottom-1.5 left-1.5 bg-rose-500 text-white w-5 h-5 grid place-items-center rounded-full text-[10px] shadow-md">
                    ❤
                  </span>
                )}
                {/* BOTTOM-RIGHT: seasonal indicator */}
                {p.seasonal && (
                  <span className="absolute bottom-1.5 right-1.5 bg-amber-500/90 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-pill">
                    ☀ موسمي
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0 py-2 px-3 flex flex-col">
                <h3 className="font-extrabold text-[15px] text-ink line-clamp-1 tracking-tight">{p.name}</h3>
                {/* Meta row — rating · reviews · distance · price */}
                <div className="text-[11px] text-muted font-bold mt-1 flex items-center gap-1.5 flex-wrap">
                  {p.rating != null && (
                    <span className="text-gold-safe">
                      ⭐ {p.rating.toFixed(1)}
                      {p.review_count != null && (
                        <span className="text-muted font-normal"> · {p.review_count >= 1000 ? `${(p.review_count / 1000).toFixed(1)}k` : p.review_count}</span>
                      )}
                    </span>
                  )}
                  {distLabel && <span className="text-ink">· {distLabel}</span>}
                  {p.price_level != null && p.price_level > 0 && (
                    <span className="text-ink">· {"€".repeat(Math.min(4, p.price_level))}</span>
                  )}
                </div>
                {/* WHY THIS PLACE — curated short_ar takes precedence over
                    the auto-generated review tip. Falls back to the existing
                    "tip" or "ai_summary" if curated metadata missing. */}
                {(p.short_ar || (p as Place & { tip?: string | null }).tip) && (
                  <p className="text-[11px] text-ink leading-relaxed mt-1.5 line-clamp-2">
                    {p.short_ar ?? (p as Place & { tip?: string | null }).tip}
                  </p>
                )}
                {/* Bottom row — category + reservation level + warning */}
                <div className="text-[10px] text-muted mt-auto pt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="line-clamp-1">{p.city_label ?? p.city}{catLabel && <> · {catLabel}</>}</span>
                  {p.reservation_level === "required" && (
                    <span className="bg-danger/10 text-danger font-bold px-1.5 py-0.5 rounded-pill border border-danger/30">📞 احجز</span>
                  )}
                  {p.best_time && (
                    <span className="bg-sea/10 text-sea-strong font-bold px-1.5 py-0.5 rounded-pill border border-sea/30">⏰ {p.best_time.split(",")[0]}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {/* Sentinel — grows the render window when it nears the viewport.
            Unmounts once every place is rendered. */}
        {renderCount < places.length && (
          <div ref={sentinelRef} className="h-8" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}

// ─── Plan inline list ───────────────────────────────────────────────────
// Replaces the discover carousel when tab=plan. Shows the selected day's
// items as numbered cards with: photo, name, distance, open status, and
// delete + reorder controls. Calls the existing itinerary API for mutations.
// ─── Sortable plan card (dnd-kit) ───────────────────────────────────────
// Wraps each plan-strip card so it can be long-press-dragged to reorder.
// `useSortable` returns a transform that we apply via CSS to slide the card
// smoothly. Long-press (TouchSensor delay 220 ms) prevents drag from
// hijacking horizontal scroll on iOS.
function SortablePlanCard({
  id, isDragging, children,
}: {
  id: string;
  isDragging?: boolean;
  children: (handle: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
    isCurrentlyDragging: boolean;
  }) => React.ReactNode;
}) {
  const sortable = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    // Lift the card while dragged so it visually detaches from the strip.
    zIndex: sortable.isDragging || isDragging ? 50 : "auto",
    opacity: sortable.isDragging ? 0.85 : 1,
    boxShadow: sortable.isDragging
      ? "0 14px 32px rgba(12,74,99,.28)"
      : undefined,
    scrollSnapAlign: "start",
  };
  return (
    <div ref={sortable.setNodeRef} style={style}>
      {children({
        attributes: sortable.attributes,
        listeners: sortable.listeners,
        isCurrentlyDragging: sortable.isDragging,
      })}
    </div>
  );
}

function PlanInlineList({
  tripId, items, selectedId, userLocation, hotelLocation,
  onSelect, onOpenDetail, onChanged, onShowAll,
}: {
  tripId: string;
  items: PlanItemRow[];
  selectedId: string | null;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  onSelect: (p: Place) => void;
  onOpenDetail: (p: Place) => void;
  onChanged: () => void;
  /** Empty-state CTA — switches the map scope to «الكل» so the user can
   *  discover places and add them to the day with one tap. */
  onShowAll: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // iOS-native confirmation pattern — `confirm()` shows the desktop-style
  // browser dialog which jars against the rest of the UI. Custom sheet
  // matches the existing modal pattern and respects safe-area-inset.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Local optimistic order — mirrors `items` but flips instantly on tap so
  // the user sees the move before the network round-trip resolves.
  const [localOrder, setLocalOrder] = useState<PlanItemRow[]>(items);
  useEffect(() => { setLocalOrder(items); }, [items]);

  const anchor = userLocation ?? hotelLocation;
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll the selected card into view
  useEffect(() => {
    if (!selectedId) return;
    const el = document.getElementById(`plancard-${selectedId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedId]);

  // Drag sensors: PointerSensor (mouse/desktop), TouchSensor with 220 ms
  // long-press to avoid kidnapping horizontal scroll on iOS, and Keyboard
  // sensor for a11y (Tab + Space to grab + arrows to move).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function persistOrder(next: PlanItemRow[], dayId: string) {
    const res = await fetch(`/api/trips/${tripId}/itinerary/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_id: dayId,
        ordered_ids: next.map((it) => it.id),
      }),
    });
    return res.ok;
  }

  async function remove(itemId: string) {
    setBusy(itemId);
    try {
      await fetch(`/api/trips/${tripId}/itinerary/${itemId}`, { method: "DELETE" });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  // Drag-to-reorder. Same payload as the ↑↓ buttons — both share /reorder.
  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIdx = localOrder.findIndex((it) => it.id === active.id);
    const toIdx = localOrder.findIndex((it) => it.id === over.id);
    if (fromIdx < 0 || toIdx < 0) return;
    const dayId = localOrder[fromIdx].day_id;
    if (!dayId) return;
    const next = arrayMove(localOrder, fromIdx, toIdx);
    const snapshot = localOrder;
    setLocalOrder(next);
    setBusy(String(active.id));
    try {
      const ok = await persistOrder(next, dayId);
      if (!ok) { setLocalOrder(snapshot); return; }
      onChanged();
    } catch {
      setLocalOrder(snapshot);
    } finally {
      setBusy(null);
    }
  }

  // Keep the ↑↓ buttons as the accessible fallback. Sends the same payload as
  // drag-to-reorder so behavior stays consistent.
  async function move(itemId: string, direction: -1 | 1) {
    const idx = localOrder.findIndex((it) => it.id === itemId);
    if (idx < 0) return;
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= localOrder.length) return;
    const dayId = localOrder[idx].day_id;
    if (!dayId) return;

    const next = arrayMove(localOrder, idx, targetIdx);
    const snapshot = localOrder;
    setLocalOrder(next);
    setBusy(itemId);
    try {
      const ok = await persistOrder(next, dayId);
      if (!ok) { setLocalOrder(snapshot); return; }
      onChanged();
    } catch {
      setLocalOrder(snapshot);
    } finally {
      setBusy(null);
    }
  }

  if (localOrder.length === 0) {
    return (
      <div
        className="absolute inset-x-0 bottom-0 z-[750] pb-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="mx-3 bg-gradient-to-br from-card to-sand border border-line rounded-3xl p-6 text-center shadow-sm">
          <div className="text-5xl mb-2 animate-float" aria-hidden="true">🗺️</div>
          <p className="font-extrabold tracking-tight text-ink text-[16px] mb-1">يومك فاضي… وش رأيك نعمّره؟</p>
          <p className="text-muted text-[12px] mb-4 leading-relaxed">اعرض كل الأماكن وأضف اللي يعجبك لخطتك بضغطة</p>
          {/* Concrete CTA right here in the empty state — beats pointing the
              user UP at the tab strip. One-tap switch to «الكل» to discover
              + add. */}
          <button
            type="button"
            onClick={onShowAll}
            className="min-h-[44px] px-6 rounded-pill bg-sea text-white font-extrabold text-[13px] shadow-[0_4px_12px_var(--elev)] active:scale-95 transition"
          >
            <span aria-hidden="true">🗺</span> اعرض كل الأماكن
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      // Plan panel = vertical scrollable list anchored to the bottom. Caps at
      // 65 dvh so the map peeks through above for spatial context. Switching
      // from horizontal strip to vertical list (audit fix) lets the user
      // scan their whole day at a glance instead of swiping sideways.
      className="absolute inset-x-0 bottom-0 z-[750] max-h-[50dvh] flex flex-col"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
    >
      {/* Soft gradient header — fades the map into the list panel so the
          boundary doesn't feel like a hard cut. */}
      <div className="pointer-events-none h-4 bg-gradient-to-b from-transparent to-sand/95" />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={localOrder.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          <div
            ref={scrollRef}
            className="overflow-y-auto overflow-x-hidden scrollbar-thin px-3 pb-2 space-y-2 bg-sand/95 backdrop-blur-sm"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {localOrder.map((it, idx) => {
              const p = it.places;
              const isSelected = selectedId === p.id;
              const distKm = anchor && p.lat != null && p.lng != null
                ? haversineKm(anchor, { lat: p.lat, lng: p.lng })
                : null;
              const distLabel = distKm != null
                ? distKm < 1.5 ? `🚶 ${Math.max(1, Math.round(distKm * 12))}د`
                  : `${distKm.toFixed(1)} كم`
                : null;
              const photo = photoAtWidth(p.photo_url, 160);
              return (
                <SortablePlanCard key={it.id} id={it.id}>
                  {({ attributes, listeners, isCurrentlyDragging }) => (
                    <div
                      id={`plancard-${p.id}`}
                      className={`bg-card rounded-2xl overflow-hidden transition border ${
                        isSelected
                          ? "border-2 border-coral shadow-lg"
                          : "border-line shadow-sm"
                      } ${isCurrentlyDragging ? "ring-2 ring-sea/40" : ""}`}
                    >
                      <div className="flex items-stretch gap-2 p-2">
                        {/* Drag handle column — number badge + GripVertical
                            glyph stacked. Both the number AND the glyph are
                            the drag affordance, so users have a clear visual
                            cue ("hold and drag this column"). */}
                        <button
                          type="button"
                          {...attributes}
                          {...listeners}
                          aria-label={`اسحب لإعادة ترتيب ${p.name}`}
                          className="shrink-0 w-11 min-w-[44px] flex flex-col items-center justify-center gap-0.5 rounded-xl bg-sea/5 hover:bg-sea/10 active:bg-sea/15 touch-none cursor-grab active:cursor-grabbing transition"
                          style={{ touchAction: "none" }}
                        >
                          <span className="w-7 h-7 rounded-full bg-sea text-white font-extrabold text-[13px] grid place-items-center shadow">
                            {idx + 1}
                          </span>
                          <GripVertical size={14} className="text-sea/60" aria-hidden="true" />
                        </button>
                        {/* Photo — tap opens detail (separate from body which
                            selects on map). Matches user expectation that the
                            visual representation is the deepest hit. */}
                        <button
                          type="button"
                          onClick={() => onOpenDetail(p)}
                          aria-label={`افتح تفاصيل ${p.name}`}
                          className="shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-sand active:scale-95 transition"
                        >
                          {photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photo}
                              alt=""
                              width={64}
                              height={64}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className={`w-full h-full grid place-items-center text-4xl bg-gradient-to-br ${CAT_GRADIENT[p.category] ?? "from-sand to-line"}`} aria-hidden="true">{CAT_EMOJI[p.category] ?? "📍"}</span>
                          )}
                        </button>
                        {/* Body */}
                        <button
                          type="button"
                          onClick={() => onSelect(p)}
                          className="flex-1 min-w-0 text-right active:scale-[0.99] transition"
                        >
                          <h4 className="font-extrabold text-[13.5px] line-clamp-1 text-ink">{p.name}</h4>
                          <div className="text-[11.5px] text-muted font-bold mt-0.5 flex items-center gap-2 flex-wrap">
                            {p.rating != null && (
                              <span className="text-gold-safe"><span aria-hidden="true">⭐</span> {p.rating.toFixed(1)}</span>
                            )}
                            {distLabel && <span>{distLabel}</span>}
                            {p.cost_estimate != null && (
                              <span className="text-ink">~{Math.round(p.cost_estimate)} {p.cost_currency ?? "€"}</span>
                            )}
                          </div>
                          {/* Practical badges — same row as parity carousel */}
                          {(p.reservation_level === "required" || p.seasonal) && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {p.reservation_level === "required" && (
                                <span className="bg-danger/10 text-danger font-bold px-1.5 py-0.5 rounded-pill border border-danger/30 text-[10px]">
                                  <span aria-hidden="true">📞</span> احجز
                                </span>
                              )}
                              {p.seasonal && (
                                <span className="bg-gold/10 text-gold-safe font-bold px-1.5 py-0.5 rounded-pill border border-gold/30 text-[10px]">
                                  <span aria-hidden="true">☀</span> موسمي
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      </div>
                      {/* Actions row — only 2 buttons now (drag handle owns
                          reorder, ↑↓ no longer needed because drag handle is
                          a11y-fallback via keyboard navigation). */}
                      <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => onOpenDetail(p)}
                          aria-label="افتح التفاصيل"
                          className="min-h-[44px] rounded-xl bg-sea text-white font-extrabold text-[12.5px] active:scale-95 transition"
                        >
                          التفاصيل
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(it.id)}
                          disabled={busy === it.id}
                          aria-label="احذف من خطتي"
                          className="min-h-[44px] rounded-xl bg-danger/10 border border-danger/30 text-danger font-extrabold inline-flex items-center justify-center active:scale-95 disabled:opacity-50 transition"
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}
                </SortablePlanCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* ─── Delete confirmation sheet ─── */}
      {confirmDeleteId && (
        <DeleteConfirmSheet
          name={localOrder.find((x) => x.id === confirmDeleteId)?.places.name ?? null}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            const idToRemove = confirmDeleteId;
            setConfirmDeleteId(null);
            remove(idToRemove);
          }}
        />
      )}
    </div>
  );
}

// ─── Delete confirmation sheet ──────────────────────────────────────────
// Extracted from PlanInlineList's inline IIFE so it can own its focus trap
// (hooks can't live inside a conditional expression). Same markup as before.
function DeleteConfirmSheet({
  name, onCancel, onConfirm,
}: {
  /** Name of the place being removed — shown under the prompt. */
  name: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Focus trap + Escape + focus restore — see useSheetFocusTrap.
  const sheetRef = useSheetFocusTrap(onCancel);
  return (
    <div
      className="fixed inset-0 z-[1200] bg-black/45 flex items-end"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="تأكيد الحذف"
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-sand w-full rounded-t-3xl shadow-2xl border-t border-line p-5 space-y-3 animate-sheet-up outline-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="w-12 h-1.5 bg-ink/20 rounded-full mx-auto" />
        <p className="text-center font-extrabold text-ink text-[15px]">
          احذف من خطتك؟
        </p>
        {name && (
          <p className="text-center text-muted text-[13px] line-clamp-1">
            {name}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] rounded-xl bg-card border border-line text-ink font-extrabold text-[13.5px] active:scale-95 transition"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-[48px] rounded-xl bg-rose-600 text-white font-extrabold text-[13.5px] active:scale-95 transition inline-flex items-center justify-center gap-1.5"
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>احذف</span>
          </button>
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
        // City-switch pill — solid sea per design_handoff_rihla_app Row A.
        className="inline-flex items-center gap-1.5 px-3 h-11 rounded-pill text-[13px] font-semibold bg-sea text-white shadow-[0_4px_12px_var(--elev)] active:scale-95 transition shrink-0"
      >
        <span className="line-clamp-1 max-w-[88px]">{label}</span>
        <span className="text-[9.5px] opacity-80 tabular-nums">{labelCount}</span>
        <span className="text-[9px] opacity-80">▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="مدن خطتك"
          className="absolute z-[1000] top-full right-0 mt-1 bg-card border border-line rounded-2xl shadow-2xl min-w-[220px] max-h-[60vh] overflow-y-auto overscroll-contain"
        >
          {/* "كل خطتي" — meta-option for the union */}
          <button
            type="button"
            role="option"
            aria-selected={activeCity == null}
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-right px-3 py-2.5 min-h-[44px] flex items-center justify-between border-b border-line-soft text-[12.5px] font-extrabold ${
              activeCity == null ? "bg-coral/10 text-coral-600" : "text-ink"
            }`}
          >
            <span>{expandedToRegion ? "كل المنطقة" : "كل خطتي"}</span>
            <span className="text-[10px] opacity-70">{allCount}</span>
          </button>

          {/* Trip cities (the user's plan) */}
          {tripCities.length > 0 && (
            <>
              <div className="text-[9.5px] font-extrabold text-muted px-3 pt-2 pb-1 uppercase tracking-wider">
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
                    className={`w-full text-right px-3 py-2 min-h-[44px] flex items-center justify-between text-[12.5px] font-bold ${
                      on ? "bg-coral/10 text-coral-600" : "text-ink hover:bg-sand"
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
                <div className="text-[9.5px] font-extrabold text-muted px-3 pt-2 pb-1 uppercase tracking-wider">
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
                      className={`w-full text-right px-3 py-2 min-h-[44px] flex items-center justify-between text-[12.5px] font-bold ${
                        on ? "bg-coral/10 text-coral-600" : "text-ink hover:bg-sand"
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
              <div className="text-[9.5px] font-extrabold text-muted px-3 pt-2 pb-1 uppercase tracking-wider">
                استكشف {regionAr}
              </div>
              {extraRegionCities.map((c) => (
                <Link
                  key={`extra-${c.key}`}
                  href={`/trips/${tripId}/map?expand=region`}
                  prefetch={false}
                  className="w-full text-right px-3 py-2 min-h-[44px] flex items-center justify-between text-[12.5px] font-bold text-ink hover:bg-sand"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-muted">+</span>
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
              className="block w-full text-right px-3 py-2.5 min-h-[44px] text-[12px] font-bold text-coral-600 border-t border-line-soft hover:bg-coral/5"
            >
              <span aria-hidden="true">→</span> اقصرها على خطتي
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
        className="absolute right-3 z-[760] inline-flex items-center gap-1 bg-ok/10 border border-ok/30 text-ok font-bold text-[10.5px] px-2 py-0.5 rounded-pill shadow-sm pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 230px)" }}
      >
        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />
        <span>📍 موقعك</span>
      </div>
    );
  }

  // Hotel anchor — tappable when geo isn't denied (so we can prompt).
  const canPrompt = geoStatus === "idle" || geoStatus === "error";
  const button = (
    <span className="inline-flex items-center gap-1 bg-gold/10 border border-gold/30 text-gold-safe font-bold text-[10.5px] px-2 py-0.5 rounded-pill shadow-sm">
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
  counts, active, onToggle, onClear, onClose, onTriggerScan, onForceRefresh,
  scanLoading, activeCityLabel, scanFocus, onScanFocusChange,
}: {
  counts: Record<string, number>;
  active: Set<DiscoverFilterId>;
  onToggle: (id: DiscoverFilterId) => void;
  onClear: () => void;
  onClose: () => void;
  /** Called when the user taps the prominent trending chip while no
   *  trending data exists yet for the current scope. */
  onTriggerScan?: () => void;
  /** Called when the user explicitly taps "🔄 حدّث الآن" — bypasses TTL and
   *  pays for a fresh scan. Only offered when data already exists. */
  onForceRefresh?: () => void;
  scanLoading?: boolean;
  activeCityLabel?: string | null;
  /** Trending focus category — what the scan is looking for. */
  scanFocus?: CategoryFocus;
  onScanFocusChange?: (f: CategoryFocus) => void;
}) {
  const total = active.size;
  // Focus trap + Escape + focus restore — see useSheetFocusTrap.
  const sheetRef = useSheetFocusTrap(onClose);
  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/45 grid items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="bg-sand rounded-t-3xl shadow-2xl border-t border-line max-h-[88vh] overflow-y-auto animate-sheet-up outline-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="sticky top-0 bg-sand/95 backdrop-blur-sm border-b border-line-soft px-5 py-3 flex items-center justify-between z-10">
          <h2 className="font-extrabold tracking-tight text-lg text-ink inline-flex items-center gap-2">
            <SlidersHorizontal size={20} aria-hidden="true" />
            <span>فلاتر</span>
            {total > 0 && (
              <span className="bg-coral text-white text-[11px] font-extrabold px-2 py-0.5 rounded-pill">{total}</span>
            )}
          </h2>
          <div className="flex gap-2">
            {total > 0 && (
              <button
                onClick={onClear}
                className="bg-card border border-coral/30 text-coral-600 font-bold text-[11.5px] px-3 min-h-[44px] rounded-pill active:scale-95"
              >
                ✕ مسح
              </button>
            )}
            <button
              onClick={onClose}
              className="bg-coral text-white font-bold text-[12px] px-4 min-h-[44px] rounded-pill active:scale-95"
            >
              ✓ تطبيق
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* 🔥 Trending — user-controlled fetch. Main button toggles filter
              (uses cache/TTL when scanning); "🔄 حدّث الآن" forces a new paid
              scan when the user explicitly wants fresh data. Cron disabled by
              user request — cost is on-demand only. */}
          <section>
            <h3 className="text-[12.5px] font-extrabold text-ink mb-2">🔥 الترند · تيك توك / انستقرام</h3>
            {/* Focus chips — answers "الترند يبحث عن ايش؟". Horizontal scroll
                so all 8 fit on iPhone SE (375px). Applies to the next scan
                the user triggers below. */}
            {onScanFocusChange && (
              <div className="flex gap-1.5 overflow-x-auto scrollbar-thin pb-1.5 mb-2 -mx-1 px-1">
                {FOCUS_CHIPS.map((f) => {
                  const on = scanFocus === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => onScanFocusChange(f.key)}
                      aria-pressed={on}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 min-h-[36px] rounded-pill text-[11.5px] font-bold border transition active:scale-95 ${
                        on
                          ? "bg-rose-600 text-white border-rose-700 shadow-sm"
                          : "bg-card text-danger border-danger/30"
                      }`}
                    >
                      <span aria-hidden="true">{f.emoji}</span>
                      <span>{f.ar}</span>
                    </button>
                  );
                })}
              </div>
            )}
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
              // No data + no scan permission → the tap would be a no-op, so
              // communicate it (opacity) instead of silently ignoring it.
              disabled={scanLoading || ((counts[TRENDING_CHIP.id] ?? 0) === 0 && !onTriggerScan)}
              aria-pressed={active.has(TRENDING_CHIP.id)}
              className={`w-full inline-flex items-center justify-between gap-2 px-4 min-h-[48px] rounded-pill border-2 shadow-md font-extrabold text-[13px] active:scale-[0.98] transition disabled:opacity-60 ${
                active.has(TRENDING_CHIP.id)
                  ? "bg-gradient-to-l from-pink-600 to-orange-700 text-white border-rose-600 ring-2 ring-danger/30"
                  : "bg-gradient-to-l from-pink-50 to-orange-50 dark:from-pink-500/10 dark:to-orange-500/10 text-danger border-rose-400"
              }`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="text-[16px]">{scanLoading ? "⏳" : "🔥"}</span>
                <span>{TRENDING_CHIP.ar}</span>
              </span>
              <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded-pill ${
                active.has(TRENDING_CHIP.id) ? "bg-white/25" : "bg-danger/20 text-danger"
              }`}>
                {(counts[TRENDING_CHIP.id] ?? 0) > 0
                  ? `${counts[TRENDING_CHIP.id]} مكان`
                  : scanLoading ? "جارٍ البحث…"
                  : onTriggerScan ? "اضغط للجلب" : "لا ترند بعد"}
              </span>
            </button>
            {/* Explicit paid-refresh button — only offered when data already
                exists so a plain 🔥 tap can't accidentally re-charge. */}
            {onForceRefresh && (
              <button
                type="button"
                onClick={() => {
                  onForceRefresh();
                  onClose();
                }}
                disabled={scanLoading}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-pill border border-danger/30 bg-card text-danger font-bold text-[11.5px] active:scale-95 transition disabled:opacity-50"
              >
                <span aria-hidden="true">🔄</span>
                <span>حدّث الآن ({activeCityLabel ?? "المدينة الحالية"}) · مدفوع ~$0.02</span>
              </button>
            )}
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
    sea:    { on: "bg-sea text-white border-sea",          off: "bg-card text-sea-strong border-sea/30" },
    coral:  { on: "bg-coral text-white border-coral",      off: "bg-card text-coral-600 border-coral/30" },
    amber:  { on: "bg-amber-500 text-white border-amber-500", off: "bg-card text-gold-safe border-gold/30" },
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
              aria-pressed={on}
              aria-label={`فلتر ${c.ar}${n > 0 ? ` (${n} مكان)` : ""}`}
              className={`inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-pill text-[12.5px] font-bold border shadow-sm transition active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${on ? styles.on : styles.off}`}
            >
              <span aria-hidden="true">{c.emoji}</span>
              <span>{c.ar}</span>
              <span aria-hidden="true" className={`text-[9.5px] ${on ? "opacity-95" : "opacity-60"}`}>{n}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
