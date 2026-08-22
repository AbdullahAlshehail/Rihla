"use client";

// Persistent horizontal carousel at the bottom of the full-screen map.
// Primary place-browsing surface — sole gesture (swipe) drives discovery.
//
// Converged onto the canonical PlaceCard primitives (P2): a single CardPhoto
// hero (4:3, CSS crop) with ≤2 overlays (save heart + StatusPill), then a
// body carrying the name + one meta line (CategoryIcon · rating · price ·
// distance). Trending/editor/P1 collapse to ONE small inline body badge.
// Emoji category/status glyphs are replaced by lucide icons via Icon/
// CategoryIcon; distance uses the nearbyKm ≤100km guard.
//
// Performance: Card is memo'd, isOpenNow is computed once per place with the
// parent's shared 5-minute `now` snapshot (keeps SSR/client tz in sync).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import { isTrendingNow, trendBadge } from "@/lib/discover/filters";
import { fmtKm, fmtMins, isOpenNow, nearbyKm, estimateTravelTimes, buildDirectionsUrl, tzForCity } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";
import { CardPhoto, StatusPill } from "@/components/ui";
import { CategoryIcon, Icon } from "@/lib/ui/icons";
import { MapPin, Star, Gem } from "lucide-react";

// Module-scope stable style refs — were rebuilt per card per render before,
// breaking MemoCard's identity check and causing 600 needless reconciliations
// on every parent state tick (audit fix 2026-06-24).
// Intrinsic sizes track the design-spec card widths (208px rest / 228px
// selected) so off-screen content-visibility placeholders don't jitter.
const CARD_STYLE_VISIBLE = {
  scrollSnapAlign: "start" as const,
  contentVisibility: "visible" as const,
  containIntrinsicSize: "228px 340px",
};
// 4:3 photo (156px at 208px wide) + body (name + one meta line) ≈ 216px now
// that unselected cards carry a body (name moved off the photo overlay).
const CARD_STYLE_AUTO = {
  scrollSnapAlign: "start" as const,
  contentVisibility: "auto" as const,
  containIntrinsicSize: "208px 216px",
};

export const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sweet: "🍰",
  sight: "🏛", nature: "🌿", event: "🎭", bar: "🍸",
};
const CAT_AR: Record<string, string> = {
  food: "مطعم", coffee: "قهوة", sweet: "حلويات",
  sight: "معلم", nature: "طبيعة", event: "ترفيه", bar: "بار",
};
export const CAT_GRADIENT: Record<string, string> = {
  food:   "from-orange-50 to-rose-100",
  coffee: "from-amber-50 to-stone-200",
  sweet:  "from-pink-50 to-rose-100",
  sight:  "from-sky-50 to-blue-100",
  nature: "from-emerald-50 to-green-100",
  event:  "from-purple-50 to-violet-100",
  bar:    "from-amber-100 to-yellow-100",
};

export type SortMode = "near" | "rating" | "score";

export const SORT_LABELS: Array<{ key: SortMode; ar: string }> = [
  { key: "near",   ar: "قريب" },
  { key: "rating", ar: "تقييم" },
  { key: "score",  ar: "ينصح فيه" },
];

export function SortIcon({ k }: { k: SortMode }) {
  if (k === "near") return <MapPin size={14} aria-hidden="true" />;
  if (k === "rating") return <Star size={14} aria-hidden="true" />;
  return <Gem size={14} aria-hidden="true" />;
}

function fmtReviews(n?: number | null): string {
  if (!n) return "";
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function priceTier(level: number | null | undefined): string {
  if (level == null || level <= 0) return "";
  return "€".repeat(Math.min(4, level));
}

function MapBottomCarouselInner({
  places,
  selectedId,
  userLocation,
  hotelLocation,
  sortMode,
  onSelect,
  onOpenDetail,
  savedSet,
  onClearFilters,
  hasActiveFilters,
}: {
  places: Place[];
  selectedId: string | null;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  sortMode: SortMode;
  onSelect: (p: Place) => void;
  onOpenDetail: (p: Place) => void;
  /** Saved IDs — drives the heart overlay on each card. */
  savedSet?: Set<string>;
  /** Called when the user taps the "امسح الفلاتر" CTA in the empty state. */
  onClearFilters?: () => void;
  /** Whether any filter is currently active — drives empty-state copy. */
  hasActiveFilters?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Windowed rendering ──
  // Browser testing (2026-07-04, iPhone 14 viewport) found ALL sorted places
  // (520 in Nice) rendered as DOM cards: a huge SSR payload, slow hydration,
  // and a blank strip while scrollIntoView smooth-scrolled through hundreds
  // of content-visibility:auto cards. Render a small window and grow it as
  // the user approaches the end — they can still reach every place.
  const RENDER_CHUNK = 24;
  const [renderCount, setRenderCount] = useState(RENDER_CHUNK);
  // New list (filter/sort/search change) → snap the window back to the head.
  useEffect(() => { setRenderCount(RENDER_CHUNK); }, [places]);

  const visiblePlaces = useMemo(() => {
    const out = places.slice(0, Math.min(places.length, renderCount));
    // A marker tap can select a place beyond the window — append it so the
    // selection scrollIntoView below always has a card to land on.
    if (selectedId && !out.some((p) => p.id === selectedId)) {
      const sel = places.find((p) => p.id === selectedId);
      if (sel) out.push(sel);
    }
    return out;
  }, [places, renderCount, selectedId]);

  // Grow the window when the user scrolls near the end of the strip.
  // Math.abs: RTL containers report scrollLeft ≤ 0 in modern engines.
  const onStripScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remaining = el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft);
    if (remaining < 800) {
      const total = places.length;
      setRenderCount((c) => (c >= total ? c : c + RENDER_CHUNK));
    }
  }, [places.length]);

  // Single Date snapshot shared by every card's whyReason memo. Without this
  // each card called `new Date()` inside its memo's deps array, which is a
  // new object reference every render → memo was effectively useless and we
  // burned ~600 reason recomputes per re-render on a busy catalogue. Update
  // every 5 minutes so "مفتوح الآن" stays accurate over a long sitting.
  const [nowMinuteBucket, setNowMinuteBucket] = useState(() => Math.floor(Date.now() / 300_000));
  useEffect(() => {
    const t = setInterval(() => setNowMinuteBucket(Math.floor(Date.now() / 300_000)), 60_000);
    return () => clearInterval(t);
  }, []);
  const nowForReason = useMemo(() => new Date(nowMinuteBucket * 300_000), [nowMinuteBucket]);

  // When selection changes externally (marker tap), scroll the matching card
  // into view AND flash it briefly so the spatial link between map ↔ card is
  // visceral. Without the flash the user has to hunt for the card visually.
  useEffect(() => {
    if (!selectedId) return;
    const el = document.getElementById(`mapcard-${selectedId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    // Trigger flash by toggling animation class via key-style restart.
    el.classList.remove("animate-flash");
    // Force reflow so animation restarts every tap.
    void el.offsetWidth;
    el.classList.add("animate-flash");
  }, [selectedId]);

  // Reset scroll to the FIRST card whenever sort changes. In an RTL container,
  // `scrollTo({ left: 0 })` is unreliable across iOS Safari versions (sometimes
  // 0 = visual end, sometimes = visual start). Using scrollIntoView on the
  // actual first child works correctly in both LTR and RTL.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    // requestAnimationFrame: wait for the freshly-sorted DOM order so the
    // first child is actually the new top-ranked place.
    requestAnimationFrame(() => {
      const firstCard = container.querySelector<HTMLElement>("[data-mapcard]");
      if (firstCard) {
        firstCard.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      }
    });
  }, [sortMode]);

  // Silent disappearance is the worst UX failure mode — Polarsteps would
  // never. Show a soft floating card with a clear next action.
  if (places.length === 0) {
    return (
      <div
        className="absolute inset-x-0 bottom-0 z-[750] pb-2"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        <div className="mx-3 bg-card rounded-2xl border border-line p-4 text-center shadow-md">
          <div className="text-3xl mb-1">🔍</div>
          <p className="text-[13.5px] font-extrabold text-ink mb-0.5">
            {hasActiveFilters ? "ما لقينا أماكن بهالفلاتر" : "ما في أماكن لعرضها"}
          </p>
          {hasActiveFilters && onClearFilters && (
            <button
              onClick={onClearFilters}
              className="mt-2 text-coral-600 font-extrabold text-[12px] min-h-[36px] px-4 rounded-pill bg-coral/10 active:scale-95 transition"
            >
              ✕ امسح الفلاتر
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-[750] pb-2"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
    >
      {/* The horizontal place strip — sort chips are the leading item so
          they scroll with the cards instead of floating mid-screen on
          short iPhones (audit fix). */}
      <div
        ref={scrollRef}
        onScroll={onStripScroll}
        className="overflow-x-auto overflow-y-visible scrollbar-thin px-3"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex gap-2 w-max items-end py-1">
          {visiblePlaces.map((p, idx) => (
            <MemoCard
              key={p.id}
              place={p}
              isSelected={p.id === selectedId}
              isSaved={savedSet?.has(p.id) ?? false}
              userLocation={userLocation}
              hotelLocation={hotelLocation}
              now={nowForReason}
              eager={idx < 4}
              onSelect={onSelect}
              onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Memoized card ─────────────────────────────────────────────────────

function Card({
  place, isSelected, isSaved, userLocation, hotelLocation, now, eager, onSelect, onOpenDetail,
}: {
  place: Place;
  isSelected: boolean;
  isSaved: boolean;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  /** Stable Date snapshot from the parent (5-minute bucket). Avoids
   *  invalidating per-card memos every render. */
  now: Date;
  /** First few cards in the strip — load the photo eagerly + high priority
   *  so the above-fold LCP image arrives ~150-300 ms sooner on 4G. */
  eager: boolean;
  onSelect: (p: Place) => void;
  onOpenDetail: (p: Place) => void;
}) {
  const photo = photoAtWidth(place.photo_url, 240);
  const catLabel = CAT_AR[place.category] ?? "";

  // Live distance ONLY when the anchor is plausibly in the same area (≤100km
  // guard) — a far user must never see "٤٢٠٠كم". anchor = user GPS ?? hotel.
  const anchor = userLocation ?? hotelLocation;
  const distKm = nearbyKm(anchor, place);

  // Open-now signal — computed in the PLACE's timezone with the parent's
  // shared 5-minute snapshot. Using `new Date()` here was (a) a fresh Date on
  // every render, and (b) env-local time — SSR (server tz) disagreed with the
  // device tz, contributing to the /map hydration mismatch.
  const oh = useMemo(
    () => isOpenNow(place.opening_hours, now, tzForCity(place.city ?? place.city_label)),
    [place.opening_hours, place.city, place.city_label, now],
  );
  const trending = isTrendingNow(place);
  // For trending places we ALWAYS surface the open-status pill (even when
  // open) so the viral mention is paired with a verified open signal. For
  // non-trending we only surface it when shut (matches prior behavior — the
  // old "يقفل" branch could never fire against formatOpenStatus labels).
  const showStatusPill = oh.kind !== "free" && (trending || oh.kind === "shut");

  // Walking time replaces km when very close (under 1.5km)
  const distLabel = (() => {
    if (distKm == null) return null;
    if (distKm < 1.5) return fmtMins(estimateTravelTimes(distKm).walkMin);
    return fmtKm(distKm);
  })();

  const price = priceTier(place.price_level);
  const reviews = fmtReviews(place.review_count);

  // Directions URL — built once per place. Opens Google Maps in a new tab.
  const directionsUrl = useMemo(() => buildDirectionsUrl(place), [place]);

  // Converged card: a single CardPhoto hero (4:3, CSS crop of the same URL)
  // with at most TWO overlays (save heart + StatusPill), then a body that
  // carries the name + one meta line (CategoryIcon · area · price · distance)
  // matching the canonical PlaceCard. Trending/editor collapse to ONE small
  // inline badge in the body. Selected state grows width and adds the actions
  // row — swipe/snap/select behavior unchanged.
  const inlineBadge = place.is_editor_pick
    ? { icon: "editor" as const, label: "نخبة", cls: "bg-gold/15 text-gold-safe" }
    : trending
    ? { icon: "trending" as const, label: trendBadge(place)?.label ?? "ترند", cls: "bg-coral/12 text-coral-600" }
    : place.priority === "P1"
    ? { icon: "editor" as const, label: "مميز", cls: "bg-emerald-600/12 text-emerald-700" }
    : null;

  return (
    <div
      id={`mapcard-${place.id}`}
      data-mapcard
      style={isSelected ? CARD_STYLE_VISIBLE : CARD_STYLE_AUTO}
      className={`group shrink-0 ${isSelected ? "w-[228px]" : "w-[208px]"} bg-card rounded-2xl overflow-hidden transition-all duration-150 border border-line ${
        isSelected
          ? "ring-2 ring-coral/60 ring-offset-2 ring-offset-stone-100 shadow-card-selected scale-[1.02]"
          : "shadow-md"
      }`}
    >
      <button
        type="button"
        // Single-tap progressive disclosure: first tap selects + pans the map
        // to the pin; second tap on the same (now-selected) card opens the
        // detail sheet directly. Saves the user a wasted "التفاصيل" hop on
        // their most-trafficked path (audit fix — Job A friction).
        onClick={() => (isSelected ? onOpenDetail(place) : onSelect(place))}
        style={{ touchAction: "manipulation" }}
        aria-label={isSelected ? `افتح تفاصيل ${place.name}` : `اختر ${place.name}`}
        className="block w-full text-right active:scale-[0.97] transition"
      >
        {/* Hero — 4:3 CSS crop of the same photo URL. Overlays: save heart
            (top-right, platform convention) + StatusPill (bottom-right). */}
        <CardPhoto
          src={photo}
          alt={place.name}
          eager={eager || isSelected}
          fallback={<CategoryIcon category={place.category} className="w-9 h-9 opacity-40" />}
        >
          {isSaved && (
            <span className="absolute top-2 right-2 w-7 h-7 rounded-full grid place-items-center bg-coral text-white shadow-md">
              <Icon name="save" fill className="w-4 h-4" />
            </span>
          )}
          {showStatusPill && (
            <span className="absolute bottom-2 right-2">
              <StatusPill isOpen={oh.kind === "open"} closeAt={oh.closeAt} size="xs" />
            </span>
          )}
        </CardPhoto>

        {/* Body — name + one meta line. Present on every card now (the name
            moved off the photo overlay to keep the hero to ≤2 overlays). */}
        <div className="text-right px-2.5 pt-2 pb-1.5">
          <div className="flex items-start gap-1.5">
            <h4 className={`flex-1 font-extrabold tracking-tight line-clamp-1 text-ink ${isSelected ? "text-[15px]" : "text-[13px]"}`}>
              {place.name}
            </h4>
            {inlineBadge && (
              // suppressHydrationWarning: the trending label is day-granular
              // ("منذ ٣ أيام") and reads the clock — SSR/client can disagree.
              <span suppressHydrationWarning className={`shrink-0 mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-extrabold px-1.5 py-0.5 rounded-pill ${inlineBadge.cls}`}>
                <Icon name={inlineBadge.icon} className="w-2.5 h-2.5" />
                <span className="truncate max-w-[64px]">{inlineBadge.label}</span>
              </span>
            )}
          </div>

          {/* One meta line: category · rating · price · distance */}
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-muted">
            {catLabel && (
              <span className="inline-flex items-center gap-1 font-bold text-ink">
                <CategoryIcon category={place.category} className="w-3.5 h-3.5" />
                {catLabel}
              </span>
            )}
            {place.rating != null && (
              <><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-gold-safe font-bold">
                <Icon name="rating" fill className="w-3 h-3" />{place.rating.toFixed(1)}
                {reviews && <span className="text-muted font-normal"> · {reviews}</span>}
              </span></>
            )}
            {price && (
              <><span aria-hidden>·</span><span className="font-extrabold text-ink">{price}</span></>
            )}
            {distLabel && (
              <><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-ink">
                {distKm != null && distKm < 1.5 && <Icon name="walk" className="w-3 h-3" />}{distLabel}
              </span></>
            )}
          </p>

          {/* Reason line — selected only (redundant with the full sheet). */}
          {isSelected && place.short_ar && (
            <p className="text-[10.5px] text-muted mt-1 line-clamp-1">{place.short_ar}</p>
          )}

          {/* Feature-parity badges (selected only) — matches the list view.
              Actionable data (booking required), not ornament; kept per parity. */}
          {isSelected && (place.reservation_level === "required" || place.seasonal || place.practical_warning) && (
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {place.reservation_level === "required" && (
                <span className="bg-danger/10 text-danger font-bold px-1.5 py-0.5 rounded-pill border border-danger/30 text-[9.5px] inline-flex items-center gap-0.5">
                  <Icon name="bookmark" className="w-2.5 h-2.5" /> احجز
                </span>
              )}
              {place.seasonal && (
                <span className="bg-gold/10 text-gold-safe font-bold px-1.5 py-0.5 rounded-pill border border-gold/30 text-[9.5px]">
                  موسمي
                </span>
              )}
              {place.practical_warning && (
                <span className="text-muted font-bold text-[9.5px]">
                  <span className="line-clamp-1">{place.practical_warning}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </button>

      {/* Selected-state quick actions — tighter padding for shorter card. */}
      {isSelected && (
        <div className="px-2 pb-1.5 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => onOpenDetail(place)}
            style={{ touchAction: "manipulation" }}
            aria-label={`عرض تفاصيل ${place.name}`}
            className="bg-coral text-white font-extrabold text-[12px] py-2.5 min-h-[44px] rounded-xl shadow-btn active:shadow-btn-press active:translate-y-px transition-all duration-150"
          >
            التفاصيل
          </button>
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ touchAction: "manipulation" }}
            aria-label={`فتح اتجاهات إلى ${place.name}`}
            className="bg-card border border-coral/30 text-coral-600 font-extrabold text-[12px] py-2.5 min-h-[44px] rounded-xl active:scale-95 transition text-center inline-flex items-center justify-center gap-1"
          >
            <Icon name="navigate" className="w-3.5 h-3.5" /> اتجاهات
          </a>
        </div>
      )}
    </div>
  );
}

const MemoCard = memo(Card);

// memo() on the parent stops the whole carousel from reconciling when
// MapScreen's ~20 useStates flip (scan toast, filter sheet, fitAllTick, etc).
// Inner MemoCard already protects per-card; this guards the outer wrapper.
const MapBottomCarousel = memo(MapBottomCarouselInner);
export default MapBottomCarousel;
