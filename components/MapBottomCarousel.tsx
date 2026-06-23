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

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import { fmtKm, fmtMins, formatOpenStatus, haversineKm, estimateTravelTimes, buildDirectionsUrl } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";
import { whyReason } from "@/lib/places/whyReason";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sweet: "🍰",
  sight: "🏛", nature: "🌿", event: "🎭", bar: "🍸",
};
const CAT_AR: Record<string, string> = {
  food: "مطعم", coffee: "قهوة", sweet: "حلويات",
  sight: "معلم", nature: "طبيعة", event: "ترفيه", bar: "بار",
};
const CAT_GRADIENT: Record<string, string> = {
  food:   "from-orange-50 to-rose-100",
  coffee: "from-amber-50 to-stone-200",
  sweet:  "from-pink-50 to-rose-100",
  sight:  "from-sky-50 to-blue-100",
  nature: "from-emerald-50 to-green-100",
  event:  "from-purple-50 to-violet-100",
  bar:    "from-amber-100 to-yellow-100",
};

export type SortMode = "near" | "rating" | "score";

export const SORT_LABELS: Array<{ key: SortMode; ar: string; emoji: string }> = [
  { key: "near",   ar: "قريب",      emoji: "📍" },
  { key: "rating", ar: "تقييم",     emoji: "⭐" },
  { key: "score",  ar: "ينصح فيه", emoji: "💎" },
];

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

// Compact relative age for the 🔥 badge ("3ي" = 3 days, "5س" = 5 hours).
// Returns "" for unknown / very-fresh (<1h) so the badge stays tight.
function trendingAgeShort(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "";
  const hours = ms / 3_600_000;
  if (hours < 1) return "";
  if (hours < 24) return `${Math.round(hours)}س`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}ي`;
  const months = Math.floor(days / 30);
  return `${months}ش`;
}

export default function MapBottomCarousel({
  places,
  selectedId,
  userLocation,
  hotelLocation,
  sortMode,
  onSortChange,
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
  onSortChange: (m: SortMode) => void;
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
        <div className="mx-3 bg-white rounded-2xl border border-line p-4 text-center shadow-md">
          <div className="text-3xl mb-1">🔍</div>
          <p className="text-[13px] font-serif font-extrabold text-ink mb-0.5">
            {hasActiveFilters ? "ما لقينا أماكن بهالفلاتر" : "ما في أماكن لعرضها"}
          </p>
          {hasActiveFilters && onClearFilters && (
            <button
              onClick={onClearFilters}
              className="mt-2 text-coral font-extrabold text-[12px] min-h-[36px] px-4 rounded-pill bg-coral/10 active:scale-95 transition"
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
      {/* Sort chips — iOS segmented-control feel: stone-100 trough with the
          active chip popping out via gradient + colored shadow. */}
      <div className="flex justify-center mb-2">
        <div className="bg-stone-100 border border-line rounded-pill p-0.5 flex gap-0.5 shadow-md">
          {SORT_LABELS.map((s) => {
            const on = sortMode === s.key;
            return (
              <button
                key={s.key}
                onClick={() => onSortChange(s.key)}
                className={`inline-flex items-center gap-1 px-2.5 min-h-[36px] rounded-pill text-[11.5px] font-bold transition-all duration-150 active:scale-95 ${
                  on
                    ? "bg-gradient-to-b from-sea to-sea-600 text-white shadow-btn-sea ring-1 ring-sea-700/20"
                    : "text-stone-700 hover:text-sea"
                }`}
              >
                <span>{s.emoji}</span><span>{s.ar}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The horizontal place strip */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-visible scrollbar-thin px-3"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex gap-2 w-max items-stretch py-1">
          {places.map((p) => (
            <MemoCard
              key={p.id}
              place={p}
              isSelected={p.id === selectedId}
              isSaved={savedSet?.has(p.id) ?? false}
              userLocation={userLocation}
              hotelLocation={hotelLocation}
              now={nowForReason}
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
  place, isSelected, isSaved, userLocation, hotelLocation, now, onSelect, onOpenDetail,
}: {
  place: Place;
  isSelected: boolean;
  isSaved: boolean;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  /** Stable Date snapshot from the parent (5-minute bucket). Avoids
   *  invalidating `reason` memo every render. */
  now: Date;
  onSelect: (p: Place) => void;
  onOpenDetail: (p: Place) => void;
}) {
  const photo = photoAtWidth(place.photo_url, 240);
  const anchor = userLocation ?? hotelLocation;
  const distKm = anchor && place.lat != null && place.lng != null
    ? haversineKm(anchor, { lat: place.lat, lng: place.lng })
    : null;
  const emoji = CAT_EMOJI[place.category] ?? "📍";
  const catLabel = CAT_AR[place.category] ?? "";

  // Open-now signal — compute once via useMemo per place
  const openStatus = useMemo(() => formatOpenStatus(place.opening_hours), [place.opening_hours]);
  const trending = (place.trending_score ?? 0) >= 50;
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

  // "Why this place?" — single decision-oriented Arabic phrase. Memoized on
  // the stable parent-supplied `now` (5-min bucket) so we don't churn 600
  // recomputes on every micro re-render.
  const reason = useMemo(
    () => whyReason(place, { userLocation, hotelLocation, now }),
    [place, userLocation, hotelLocation, now],
  );

  // Directions URL — built once per place. Opens Google Maps in a new tab.
  const directionsUrl = useMemo(() => buildDirectionsUrl(place), [place]);

  // Premium card design: hero photo dominates the card, dark gradient
  // bottom-overlay carries the name (Airbnb/Apple-Maps style), body has
  // compact meta. Selected state grows slightly and adds the detail CTA.
  return (
    <div
      id={`mapcard-${place.id}`}
      data-mapcard
      style={{
        scrollSnapAlign: "start",
        // CSS-only virtualization (Safari 18+ / all evergreen browsers).
        // Browser skips paint + layout for off-screen cards → 600-card strip
        // costs the same as the visible ~5 cards. Selected card is excluded
        // so its grow animation never gets paused mid-flight.
        contentVisibility: isSelected ? "visible" : "auto",
        containIntrinsicSize: "210px 250px",
      } as React.CSSProperties}
      className={`group shrink-0 ${isSelected ? "w-[210px]" : "w-[160px]"} bg-white rounded-2xl overflow-hidden transition-all duration-200 border border-stone-200 ${
        isSelected
          ? "ring-2 ring-coral/60 ring-offset-2 ring-offset-stone-100 shadow-card-selected scale-[1.03]"
          : "shadow-md"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(place)}
        style={{ touchAction: "manipulation" }}
        className="block w-full text-right active:scale-[0.97] transition"
      >
        {/* Hero photo — bigger ratio (5:4) so the image dominates the card.
            Name floats over a slim bottom gradient for an immersive feel.
            Audit fix 2026-06-16: gradient shrunk h-2/3 → h-1/2 (Airbnb pattern)
            so the photo composition is preserved. */}
        <div className={`aspect-[5/4] grid place-items-center text-3xl overflow-hidden relative group-active:brightness-90 transition ${
          photo ? "bg-stone-100" : `bg-gradient-to-br ${CAT_GRADIENT[place.category] ?? "from-stone-100 to-stone-200"}`
        }`}>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={place.name}
              className="w-full h-full object-cover"
              loading="lazy"
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
          <h4
            className={`absolute bottom-1.5 right-2 left-2 font-extrabold text-[13.5px] tracking-tight line-clamp-1 leading-tight text-right ${
              photo ? "text-white" : "text-ink"
            }`}
            style={photo ? { textShadow: "0 1px 3px rgba(0,0,0,0.7)" } : undefined}
          >
            {place.name}
          </h4>

          {/* TOP-LEFT: trending wins over editor-pick when both present.
              The badge shows the AGE (e.g. "3ي") so the user knows the
              freshness. Tap → opens the exact captured TikTok/Insta URL. */}
          {(place.trending_score ?? 0) >= 50 ? (
            <a
              href={place.trending_url ?? `https://www.tiktok.com/search?q=${encodeURIComponent(place.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={`شاهد ${place.name} على تيك توك`}
              className="absolute top-1.5 left-1.5 text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill bg-gradient-to-l from-pink-500 to-orange-500 text-white shadow-sm active:scale-95"
            >
              🔥 ترند{trendingAgeShort(place.trending_updated_at) ? ` · ${trendingAgeShort(place.trending_updated_at)}` : ""}
            </a>
          ) : place.is_editor_pick && (
            <span className="absolute top-1.5 left-1.5 text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill bg-amber-500/95 text-white shadow-sm">
              ⭐ نخبة
            </span>
          )}
          {/* TOP-RIGHT: open status (time-sensitive metadata). For trending
              places we show a distinct "🟢 مفتوح" pill when actually open so
              the viral mention is paired with a verified open signal. */}
          {showStatusPill && (
            <span
              className={`absolute top-1.5 right-1.5 text-[9.5px] font-extrabold px-2 py-0.5 rounded-pill backdrop-blur-md shadow-sm ${
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

        {/* Body — single tight row of meta info, large enough to scan */}
        <div className="px-2.5 py-2 text-right">
          <div className="flex items-center justify-between text-[11px] gap-1 flex-wrap">
            {place.rating != null ? (
              <span className="text-amber-700 font-extrabold inline-flex items-baseline gap-0.5">
                <span>⭐ {place.rating.toFixed(1)}</span>
                {reviews && <span className="text-stone-400 font-normal text-[10px]"> ({reviews})</span>}
              </span>
            ) : (
              <span className="text-stone-400 text-[10px]">{emoji} {catLabel}</span>
            )}
            {price && <span className="text-stone-700 font-extrabold">{price}</span>}
          </div>

          {distLabel && (
            <div className="text-[11px] text-stone-600 font-bold mt-1">{distLabel}</div>
          )}

          {/* "Why this place?" — single short Arabic line. Always rendered so
              every card carries a decision-oriented reason. Color tinted by
              tone (gem / luxury get a warmer accent). */}
          <div
            className={`text-[10.5px] font-bold mt-1 line-clamp-1 ${
              reason.tone === "gem" || reason.tone === "luxury" || reason.tone === "rated"
                ? "text-amber-700"
                : reason.tone === "near" || reason.tone === "open"
                ? "text-emerald-700"
                : reason.tone === "fallback"
                ? "text-stone-500"
                : "text-stone-700"
            }`}
          >
            {reason.text}
          </div>
        </div>
      </button>

      {/* Selected-state quick actions — appears only on the active card.
          Two side-by-side buttons keep the iPhone-thumb reach friendly. */}
      {isSelected && (
        <div className="px-2 pb-2 grid grid-cols-2 gap-1.5">
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
            className="bg-white border border-coral/30 text-coral font-extrabold text-[12px] py-2.5 min-h-[44px] rounded-xl active:scale-95 transition text-center inline-flex items-center justify-center gap-1"
          >
            🧭 اتجاهات
          </a>
        </div>
      )}
    </div>
  );
}

const MemoCard = memo(Card);
