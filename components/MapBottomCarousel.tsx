"use client";

// Persistent horizontal carousel at the bottom of the full-screen map.
// Primary place-browsing surface — sole gesture (swipe) drives discovery.
//
// Each card answers 5 quick questions:
//   ▸ ما هو؟           — emoji + kind/category label
//   ▸ كم تقييمه؟        — ⭐ + review_count
//   ▸ كم سعره؟          — €€ tier
//   ▸ كم يبعد؟          — walk time when close, km otherwise
//   ▸ مفتوح الآن؟       — top-left photo overlay
//
// Performance: Card is memo'd, formatOpenStatus is computed once per place.
// Audit notes 2026-06-16: setIcon scoped to prev+new in DiscoverMap, this
// carousel just renders 150 memoized cards.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import { isTrendingNow, trendBadge } from "@/lib/discover/filters";
import { fmtKm, fmtMins, formatOpenStatus, haversineKm, estimateTravelTimes, buildDirectionsUrl, tzForCity } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";
import { MapPin, Star, Gem } from "lucide-react";

// Module-scope stable style refs — were rebuilt per card per render before,
// breaking MemoCard's identity check and causing 600 needless reconciliations
// on every parent state tick (audit fix 2026-06-24).
// Intrinsic sizes track the design-spec card widths (208px rest / 228px
// selected) so off-screen content-visibility placeholders don't jitter.
const CARD_STYLE_VISIBLE = {
  scrollSnapAlign: "start" as const,
  contentVisibility: "visible" as const,
  containIntrinsicSize: "228px 320px",
};
const CARD_STYLE_AUTO = {
  scrollSnapAlign: "start" as const,
  contentVisibility: "auto" as const,
  containIntrinsicSize: "208px 136px",
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
  const rawPhoto = photoAtWidth(place.photo_url, 240);
  // Track photo-load failure so we fall back to the category emoji hero
  // instead of showing the browser's broken-image ? glyph.
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? null : rawPhoto;
  const anchor = userLocation ?? hotelLocation;
  const distKm = anchor && place.lat != null && place.lng != null
    ? haversineKm(anchor, { lat: place.lat, lng: place.lng })
    : null;
  const emoji = CAT_EMOJI[place.category] ?? "📍";
  const catLabel = CAT_AR[place.category] ?? "";

  // Open-now signal — computed in the PLACE's timezone with the parent's
  // shared 5-minute snapshot. Using `new Date()` here was (a) a fresh Date on
  // every render, and (b) env-local time — SSR (server tz) disagreed with the
  // device tz, contributing to the /map hydration mismatch.
  const openStatus = useMemo(
    () => formatOpenStatus(place.opening_hours, now, tzForCity(place.city ?? place.city_label)),
    [place.opening_hours, place.city, place.city_label, now],
  );
  const trending = isTrendingNow(place);
  // For trending places we ALWAYS surface the open-status pill (even when
  // open) so the user can verify before walking there. For non-trending we
  // keep the original "only when closing/closed" behavior.
  const showStatusPill = !openStatus.freeform && (
    trending || !openStatus.isOpen || /يقفل/.test(openStatus.label)
  );

  // Walking time replaces km when very close (under 1.5km)
  const distLabel = (() => {
    if (distKm == null) return null;
    if (distKm < 1.5) {
      const w = estimateTravelTimes(distKm).walkMin;
      return `🚶 ${fmtMins(w)}`;
    }
    return `${userLocation ? "📍" : "🏨"} ${fmtKm(distKm)}`;
  })();

  const price = priceTier(place.price_level);
  const reviews = fmtReviews(place.review_count);

  // Directions URL — built once per place. Opens Google Maps in a new tab.
  const directionsUrl = useMemo(() => buildDirectionsUrl(place), [place]);

  // Premium card design: hero photo dominates the card, dark gradient
  // bottom-overlay carries the name (Airbnb/Apple-Maps style), body has
  // compact meta. Selected state grows slightly and adds the detail CTA.
  // Widths follow the design spec (carousel cards 208–228px): 208 at rest,
  // 228 selected — swipe/snap behavior and selected emphasis unchanged.
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
        {/* Hero photo — wider when unselected (16:10) to keep total card
            height short. Selected grows to 5:4 so the focused card feels
            substantial and has room for the rich body below. */}
        <div className={`${isSelected ? "aspect-[5/4]" : "aspect-[16/10]"} grid place-items-center text-3xl overflow-hidden relative group-active:brightness-90 transition ${
          photo ? "bg-sand" : `bg-gradient-to-br ${CAT_GRADIENT[place.category] ?? "from-sand to-line"}`
        }`}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={place.name}
              onError={() => setPhotoFailed(true)}
              width={isSelected ? 228 : 208}
              height={isSelected ? 182 : 130}
              className="w-full h-full object-cover"
              loading={eager || isSelected ? "eager" : "lazy"}
              fetchPriority={eager || isSelected ? "high" : "auto"}
              decoding="async"
            />
          ) : (
            <span className="text-5xl drop-shadow-sm">{emoji}</span>
          )}

          {/* Slimmer bottom gradient — protects name without killing photo */}
          {photo && (
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
          )}

          {/* Name floats on hero (overlay on photo). Extra text-shadow handles
              the "light photo defeats gradient" edge-case (audit risk). */}
          {/* Name + inline rating/distance overlay. Distance uses real-time
              user GPS (falls back to hotel) — see anchor calc above. */}
          <div
            className="absolute bottom-1.5 right-2 left-2 leading-tight text-right"
            style={photo ? { textShadow: "0 1px 3px rgba(0,0,0,0.7)" } : undefined}
          >
            {!isSelected && (place.rating != null || distLabel) && (
              <div className={`font-bold text-[10px] mb-0.5 inline-flex items-center gap-1.5 flex-wrap ${photo ? "text-white" : "text-stone-900"}`}>
                {place.rating != null && (
                  <span className={photo ? "text-amber-200" : "text-amber-700"}>
                    ⭐ {place.rating.toFixed(1)}
                    {reviews && <span className={`opacity-80 ${photo ? "text-white/80" : "text-stone-600"}`}> · {reviews}</span>}
                  </span>
                )}
                {distLabel && (
                  <span className={photo ? "text-white/95" : "text-stone-900"}>· {distLabel}</span>
                )}
              </div>
            )}
            <h4
              className={`font-extrabold tracking-tight line-clamp-1 ${
                isSelected ? "text-[15px]" : "text-[13px]"
              } ${photo ? "text-white" : "text-stone-900"}`}
            >
              {place.name}
            </h4>
          </div>

          {/* TOP-LEFT: badge priority — trending > curated P1 > editor-pick.
              At most one renders so the corner stays clean (audit: 7 marker
              signals → 3). */}
          {/* TODO(social): wire here_now/friends_here when carousel places
              carry social data — the design spec wants a live "هنا الآن"
              badge + friend-avatar row here, but the slim Place rows this
              carousel receives have no presence fields and we NEVER render
              fake presence. */}
          {/* Calmed corner badges (spacing/size only): smaller type, tighter
              padding, and a max-width + truncation on the left badge so the
              two corners can never collide/stack on a 208px card. */}
          {isTrendingNow(place) ? (() => {
            // متى انجلب — real date («ترند · منذ ٣ أيام»), «جديد» < 7 days.
            const badge = trendBadge(place);
            return (
              <span
                suppressHydrationWarning
                className="absolute top-1.5 left-1.5 max-w-[52%] text-[9px] font-bold px-1.5 py-px rounded-pill bg-gradient-to-l from-pink-600 to-orange-700 text-white shadow-sm inline-flex items-center gap-1"
              >
                <span className="truncate">🔥 {badge?.label ?? "ترند"}</span>
                {badge?.isNew && <span className="shrink-0 bg-white/25 rounded-pill px-1">جديد</span>}
              </span>
            );
          })() : place.priority === "P1" ? (
            <span className="absolute top-1.5 left-1.5 max-w-[52%] truncate text-[9px] font-bold px-1.5 py-px rounded-pill bg-emerald-600 text-white shadow-sm">
              ⭐ مميز
            </span>
          ) : place.is_editor_pick && (
            <span className="absolute top-1.5 left-1.5 max-w-[52%] truncate text-[9px] font-bold px-1.5 py-px rounded-pill bg-amber-500/95 text-white shadow-sm">
              ⭐ نخبة
            </span>
          )}
          {/* TOP-RIGHT: open status (time-sensitive metadata). For trending
              places we show a distinct "🟢 مفتوح" pill when actually open so
              the viral mention is paired with a verified open signal. */}
          {showStatusPill && (
            <span
              className={`absolute top-1.5 right-1.5 max-w-[44%] truncate text-[9px] font-bold px-1.5 py-px rounded-pill backdrop-blur-md shadow-sm ${
                openStatus.isOpen
                  ? (/يقفل/.test(openStatus.label)
                      ? "bg-amber-500/95 text-white"
                      : "bg-emerald-500/95 text-white")
                  : "bg-rose-500/95 text-white"
              }`}
            >
              {!openStatus.isOpen
                ? "🔴 مغلق"
                : /يقفل/.test(openStatus.label)
                  ? "⏰ يقفل"
                  : "🟢 مفتوح"}
            </span>
          )}
          {/* BOTTOM-LEFT: user state — saved heart. Separating system vs user
              metadata avoids the previous top-left stacking collision. */}
          {isSaved && (
            <span className="absolute bottom-1.5 left-1.5 text-sm bg-rose-500/95 text-white w-6 h-6 rounded-full grid place-items-center shadow-md">
              ❤
            </span>
          )}
        </div>

        {/* Body — selected only. Compact single-row meta. Reason line dropped
            (it's redundant with the full PlaceDetailSheet). */}
        {isSelected && (
          <div className="text-right px-2.5 py-1.5">
            <div className="flex items-center justify-between text-[11px] gap-1">
              {place.rating != null ? (
                <span className="text-gold-safe font-extrabold inline-flex items-baseline gap-0.5">
                  <span>⭐ {place.rating.toFixed(1)}</span>
                  {reviews && <span className="text-muted font-normal text-[10px]"> · {reviews}</span>}
                </span>
              ) : (
                <span className="text-muted text-[10px]">{emoji} {catLabel}</span>
              )}
              <span className="inline-flex items-center gap-1.5 text-[10.5px] text-ink">
                {distLabel && <span className="font-bold">{distLabel}</span>}
                {price && <span className="font-extrabold">{price}</span>}
              </span>
            </div>
            {place.short_ar && (
              <p className="text-[10.5px] text-muted mt-1 line-clamp-1">{place.short_ar}</p>
            )}
            {/* Feature-parity badges: surfaced on selected card so the carousel
                matches the list view. Sheet shows the full warning text. */}
            {(place.reservation_level === "required" || place.seasonal || place.practical_warning) && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {place.reservation_level === "required" && (
                  <span className="bg-danger/10 text-danger font-bold px-1.5 py-0.5 rounded-pill border border-danger/30 text-[9.5px]">
                    📞 احجز
                  </span>
                )}
                {place.seasonal && (
                  <span className="bg-gold/10 text-gold-safe font-bold px-1.5 py-0.5 rounded-pill border border-gold/30 text-[9.5px]">
                    ☀ موسمي
                  </span>
                )}
                {place.practical_warning && (
                  <span className="text-muted font-bold text-[9.5px] inline-flex items-center gap-0.5">
                    ⚠ <span className="line-clamp-1">{place.practical_warning}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
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
            🧭 اتجاهات
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
