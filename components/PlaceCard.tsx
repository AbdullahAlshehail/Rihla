"use client";

// Premium PlaceCard inspired by TripAdvisor + Airbnb + Google Maps.
// - Photo carousel with swipe + dots (when multiple photos)
// - Save heart (top-right, universal pattern)
// - Verdict badge (bottom-right of hero)
// - Visit-duration chip (top-left of hero)
// - Authentic review snippet with attribution (when available)
// - Clean facts strip with separator dividers

import { useState, useTransition, useRef, useMemo, memo } from "react";
import dynamic from "next/dynamic";
import type { ItineraryDay, ItineraryItem, Place, GoogleReviewSnippet } from "@/lib/supabase/database.types";
import {
  fmtMins, fmtKm, estimateTravelTimes, haversineKm,
  formatOpenStatus, buildPlaceUrl,
} from "@/lib/utils";
import { getKindDisplay, getCategoryDisplay } from "@/lib/highlights";
import {
  summarizeFromPlaceFields, scoreVerdict,
  estimateVisitDuration, pickReviewSnippet,
} from "@/lib/google/inferKind";
import { allOfferings, type Offering } from "@/lib/discover/offerings";
import { estimatePlaceAgeMonths, ageLabelAr } from "@/lib/google/placeAge";
import { bestTimeFor } from "@/lib/google/bestTime";
import { coffeeHighlights } from "@/lib/google/coffeeHighlights";
import { photoAtWidth } from "@/lib/images";
import { useRouter } from "next/navigation";

// Lazy-load the heavy modal — only ships ~25 KB to the client when actually opened
const PlaceDetailSheet = dynamic(() => import("@/components/PlaceDetailSheet"), {
  ssr: false,
});
// QuickAddPicker is light but only mounted on demand
const QuickAddPicker = dynamic(() => import("@/components/QuickAddPicker"), {
  ssr: false,
});

const CAT_GRADIENT: Record<string, string> = {
  food: "from-orange-100 to-red-100",
  coffee: "from-amber-100 to-stone-200",
  sight: "from-sky-100 to-blue-200",
  nature: "from-emerald-100 to-green-200",
  event: "from-purple-100 to-violet-200",
  sweet: "from-pink-100 to-rose-200",
  bar: "from-amber-200 to-yellow-200",
};

export type PlaceCardAddedInfo = {
  placeName: string;
  dayLabel: string;
  phaseLabel: string;
  phaseEmoji: string;
};

function PlaceCardImpl({
  place,
  tripId,
  score,
  reasonAr,
  initiallySaved = false,
  initiallyHidden = false,
  hotel = null,
  days = [],
  items = [],
  onAdded,
  onHidden,
  precomputedOfferings,
  catalogue,
  userLocation = null,
}: {
  place: Place;
  tripId: string;
  score: number;
  reasonAr: string;
  initiallySaved?: boolean;
  hotel?: { lat: number; lng: number; name: string } | null;
  /** User's current GPS coordinates (from useGeoLocation hook in the parent).
   *  When provided, the distance chip on the card prefers this over the hotel
   *  so the user sees "how far am I from this RIGHT NOW" without opening the
   *  detail sheet. Falls back to hotel when geo not granted. */
  userLocation?: { lat: number; lng: number } | null;
  /** Full trip catalogue — forwarded to PlaceDetailSheet so the "similar
   *  places nearby" carousel can render. Pure client compute, no API cost. */
  catalogue?: Place[];
  /** When supplied, the "أضف للخطة" button opens a quick inline picker
   *  instead of navigating to /trips/[id]?add= */
  days?: ItineraryDay[];
  items?: ItineraryItem[];
  /** Fires after a successful quick-add so the page can show a snackbar */
  onAdded?: (info: PlaceCardAddedInfo) => void;
  /** Whether the user has hidden this place from Discover. */
  initiallyHidden?: boolean;
  /** Fires when the user toggles the hide state — parent can refresh. */
  onHidden?: (placeId: string, hidden: boolean) => void;
  /** Parent may pre-compute allOfferings(place) once and pass it in to avoid
   *  re-running tag/hours/meal inference for every card in a 200-item list. */
  precomputedOfferings?: Offering[];
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [hidden, setHidden] = useState(initiallyHidden);
  const [open, setOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function toggleHide() {
    const next = !hidden;
    setHidden(next);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/places/${place.id}/hide`, { method: next ? "POST" : "DELETE" });
        if (!r.ok) {
          // Server rejected — roll back optimistic flip and don't notify parent
          // (audit fix 2026-06-15: fetch resolves 4xx/5xx without throwing).
          setHidden(!next);
          return;
        }
        onHidden?.(place.id, next);
        router.refresh();
      } catch {
        setHidden(!next);
      }
    });
  }

  const status = formatOpenStatus(place.opening_hours);
  const kind = getKindDisplay(place.kind);
  const cat = getCategoryDisplay(place.category);
  const verdict = scoreVerdict(score, place.category);
  const mapsHref = buildPlaceUrl(place);
  const visitDuration = estimateVisitDuration(place.category);
  const offerings = precomputedOfferings ?? allOfferings(place);

  // Where is this place already scheduled? Derived from the trip's items so
  // it stays accurate after the parent refreshes following a quick-add.
  const scheduledOn = (() => {
    const matches = items.filter((it) => it.place_id === place.id);
    if (matches.length === 0) return null;
    // Render up to 2 schedule chips — "يوم ٢ · 🌙" style.
    return matches.slice(0, 2).map((it) => {
      const dayIdx = days.findIndex((d) => d.id === it.day_id);
      // Lazy-import slot→phase to keep this section dependency-light
      // (we don't need full PhaseDef here — just emoji + ar)
      const slotMeta: Record<string, { emoji: string; ar: string }> = {
        morning:   { emoji: "🌅", ar: "الصباح" },
        midday:    { emoji: "🍽", ar: "الغداء" },
        afternoon: { emoji: "🌆", ar: "بعد الظهر" },
        evening:   { emoji: "🌙", ar: "العشاء" },
        night:     { emoji: "🌃", ar: "آخر اليوم" },
      };
      const m = slotMeta[it.slot] ?? { emoji: "📍", ar: it.slot };
      return {
        id: it.id,
        label: dayIdx >= 0 ? `يوم ${dayIdx + 1}` : "اليوم",
        emoji: m.emoji,
        slotAr: m.ar,
      };
    });
  })();

  // Photo carousel data — every URL is routed through `/api/photo` so the
  // browser never holds the Google Maps API key.
  const rawPhotos = place.photo_urls && place.photo_urls.length > 0
    ? place.photo_urls
    : place.photo_url
    ? [place.photo_url]
    : [];
  const photos = rawPhotos
    .map((u) => photoAtWidth(u, 640))
    .filter((u): u is string => u != null);

  const reviewSnippet = pickReviewSnippet(place.google_reviews as GoogleReviewSnippet[] | null | undefined);
  const ageMonths = estimatePlaceAgeMonths(place.google_reviews as GoogleReviewSnippet[] | null | undefined);
  const ageLabel = ageLabelAr(ageMonths);
  // Memoize so the helper doesn't run on every render — for a 600-card mount
  // the saved cycles add up.
  const bestTime = useMemo(() => bestTimeFor(place), [place]);
  // Coffee-specific highlight chips — what's THIS spot good at.
  const coffeeChips = useMemo(() => coffeeHighlights(place), [place]);

  // ── Facts ──────────────────────────────────────────────────────────────
  const reviewsShort = place.review_count
    ? place.review_count >= 1000
      ? `${(place.review_count / 1000).toFixed(1)}k`
      : String(place.review_count)
    : null;

  let costShort: string | null = null;
  if (place.cost_estimate != null && place.cost_estimate > 0) {
    costShort = place.cost_currency === "SAR"
      ? `${Math.round(place.cost_estimate)} ر.س`
      : `${Math.round(place.cost_estimate)} ${place.cost_currency}`;
  } else if (place.cost_estimate === 0) {
    costShort = "مجاني";
  }

  // Travel from the trip's hotel. Show BOTH driving + walking when it makes
  // sense (≤3km walkable). Long walks are not useful so we hide them.
  // Distance chip prefers the USER's current GPS location, falls back to
  // hotel. Saudi-traveler use case: when out walking around Nice, the chip
  // says "🚶 8 د · 🚗 3 د · 0.6 كم" relative to where they actually are.
  let distChip: {
    drive: string;
    walk: string | null;
    kmLabel: string;
    tone: "good" | "neut" | "warn";
    fromLabel: string; // tiny prefix to say WHERE this is measured from
  } | null = null;
  const anchor = userLocation ?? (hotel ? { lat: hotel.lat, lng: hotel.lng } : null);
  if (anchor && place.lat != null && place.lng != null) {
    const km = haversineKm(anchor, { lat: place.lat, lng: place.lng });
    const t = estimateTravelTimes(km);
    distChip = {
      drive: `🚗 ${fmtMins(t.driveMin)}`,
      walk: km <= 3 ? `🚶 ${fmtMins(t.walkMin)}` : null,
      kmLabel: fmtKm(km),
      tone: km <= 5 ? "good" : km <= 15 ? "neut" : "warn",
      fromLabel: userLocation ? "📍 منك" : "🏨 من فندقك",
    };
  }

  // Summary fallback — never empty
  const summaryFallback = summarizeFromPlaceFields({
    rating: place.rating,
    reviewCount: place.review_count,
    priceLevel: place.price_level,
    kindAr: kind?.ar ?? null,
    cityLabel: place.city_label,
  });
  const editorialSummary =
    place.ai_summary
    || place.review_summary
    || place.tip
    || summaryFallback;
  const summaryIcon =
    place.ai_summary ? "🧠"
    : place.review_summary ? "📝"
    : place.tip ? "💡"
    : "ℹ️";

  async function toggleSave() {
    // Optimistic flip; roll back if the request actually fails so the heart
    // doesn't lie about server state.
    const prev = saved;
    setSaved(!prev);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/trips/${tripId}/places`, {
          method: prev ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place_id: place.id }),
        });
        if (!r.ok) setSaved(prev);
      } catch {
        setSaved(prev);
      }
    });
  }

  // Carousel swipe support — tracks both axes so vertical scroll cancels.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStart.current == null || photos.length <= 1) return;
    const dx = e.changedTouches[0].clientX - touchStart.current.x;
    const dy = e.changedTouches[0].clientY - touchStart.current.y;
    // If the gesture was mostly vertical, it was page-scroll — ignore.
    if (Math.abs(dy) > Math.abs(dx)) { touchStart.current = null; return; }
    if (Math.abs(dx) > 40) {
      // RTL: swipe right (positive dx) → next, swipe left → previous
      setPhotoIdx((i) =>
        dx > 0
          ? (i + 1) % photos.length
          : (i - 1 + photos.length) % photos.length,
      );
    }
    touchStart.current = null;
  }

  return (
    <>
      {open && (
        <PlaceDetailSheet
          place={place}
          hotel={hotel}
          onClose={() => setOpen(false)}
          onSave={toggleSave}
          saved={saved}
          onAddToPlan={() => router.push(`/trips/${tripId}?add=${place.id}`)}
          catalogue={catalogue}
        />
      )}

      <article className="bg-white rounded-3xl overflow-hidden shadow-md border border-stone-100">
        {/* ─── Hero photo (with carousel) ─── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          style={{ touchAction: "pan-y" }}
          className={`w-full relative aspect-[16/8] cursor-pointer overflow-hidden ${
            photos.length > 0 && !photoFailed ? "bg-stone-200" : `bg-gradient-to-br ${CAT_GRADIENT[place.category] ?? "from-stone-100 to-stone-200"}`
          }`}
          title={reasonAr || undefined}
        >
          {photos.length > 0 && !photoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photoIdx}
              src={photos[photoIdx]}
              alt={place.name}
              className="w-full h-full object-cover transition-opacity duration-200"
              loading="lazy"
              decoding="async"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-7xl opacity-50">
              {cat.emoji}
            </div>
          )}

          {/* Subtle gradient overlays for legibility */}
          {photos.length > 0 && (
            <>
              <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent pointer-events-none" />
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
            </>
          )}

          {/* Save heart (top-right physically — Tailwind logical props would
              flip with dir=rtl, but we want hearts in the *physical* top-right
              regardless of writing direction so iPhone users tap in the
              expected spot per platform convention). */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleSave(); }}
            aria-label={saved ? "إلغاء الحفظ" : "احفظ"}
            className={`absolute top-3 right-3 w-11 h-11 rounded-full grid place-items-center text-lg shadow-lg backdrop-blur-sm transition active:scale-90 ${
              saved ? "bg-coral text-white" : "bg-white/95 text-stone-500 hover:bg-white"
            }`}
          >
            {saved ? "❤️" : "🤍"}
          </button>

          {/* Hide button — stacked BELOW the heart with full 4px gap so the
              tap zones never touch. */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleHide(); }}
            aria-label={hidden ? "إلغاء الإخفاء" : "إخفاء من اكتشف"}
            title={hidden ? "إلغاء الإخفاء" : "ما يعجبني — إخفاء"}
            className={`absolute top-[3.75rem] right-3 w-11 h-11 rounded-full grid place-items-center text-lg shadow-lg backdrop-blur-sm transition active:scale-90 ${
              hidden ? "bg-stone-700 text-white" : "bg-white/95 text-stone-500 hover:bg-white"
            }`}
          >
            {hidden ? "↩️" : "🙈"}
          </button>

          {/* Editor pick (bottom-left) */}
          {place.is_editor_pick && (
            <div className="absolute bottom-3 left-3 bg-amber-500/95 text-white text-[10.5px] font-extrabold px-2.5 py-1 rounded-full shadow-md backdrop-blur-sm">
              ⭐ النخبة
            </div>
          )}

          {/* Verdict + score (bottom-right) */}
          <div className={`absolute bottom-3 right-3 ${verdict.gradientBg} ${verdict.textColor} shadow-lg rounded-full px-3.5 py-1.5 flex items-center gap-2 border border-white/30`}>
            <span className="font-extrabold text-[13px] leading-none">{verdict.ar}</span>
            <span className="opacity-50 text-[10px]">·</span>
            <span className="font-bold text-[12px] leading-none">{score}</span>
          </div>

          {/* Photo carousel dots (top-center if multiple) */}
          {photos.length > 1 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {photos.map((p, i) => (
                <button
                  key={`${p.slice(0, 40)}-${i}`}
                  onClick={(e) => { e.stopPropagation(); setPhotoIdx(i); }}
                  aria-label={`صورة ${i + 1} من ${photos.length}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === photoIdx ? "bg-white w-6" : "bg-white/60 w-1.5"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {/* ─── Body ─── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
          className="w-full text-right px-4 pt-3.5 pb-3 cursor-pointer"
        >
          {/* Title + status */}
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-serif font-extrabold text-[17px] leading-tight line-clamp-2 text-ink">
              {place.name}
            </h3>
            <span className={`shrink-0 text-[10.5px] font-bold px-2 py-0.5 rounded-full mt-0.5 ${
              status.isOpen
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}>
              {status.isOpen ? "🟢 مفتوح" : "🔴 مغلق"}
            </span>
          </div>

          {/* Type */}
          <p className="text-[12px] text-stone-500 mt-1.5">
            <span className="font-bold text-stone-700">{cat.emoji} {cat.ar}</span>
            {kind && <> · {kind.ar}</>}
            {place.city_label && <> · 📍 {place.city_label}</>}
          </p>

          {/* Planning meta — moved off the hero so it stops crowding the photo.
              Same info, calmer placement. */}
          {(visitDuration || bestTime || ageLabel) && (
            <p className="text-[11px] text-stone-500 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {visitDuration && (
                <span className="inline-flex items-center gap-1">
                  <span>⏱</span><span>{visitDuration}</span>
                </span>
              )}
              {bestTime && (
                <span className="inline-flex items-center gap-1" title={bestTime.hint}>
                  <span>{bestTime.emoji}</span><span>{bestTime.ar}</span>
                </span>
              )}
              {ageLabel && (
                <span
                  className={`inline-flex items-center gap-1 font-bold ${
                    ageMonths != null && ageMonths < 12 ? "text-emerald-700" : "text-stone-600"
                  }`}
                  title="تقدير من أقدم مراجعة قوقل"
                >
                  {ageLabel}
                </span>
              )}
            </p>
          )}

          {/* "ليش مناسب؟" — short derived reason. Renders only when the
              parent passed a non-trivial reason string. */}
          {reasonAr && reasonAr.trim().length > 4 && (
            <p className="text-[12px] text-ink/80 mt-2 leading-snug">
              <span className="font-extrabold text-sea">ليش مناسب؟</span>{" "}
              {reasonAr}
            </p>
          )}

          {/* "In Plan" persistent badge — visible whenever the place has been
              added, so the user never has to flip to خطتي to verify. */}
          {scheduledOn && scheduledOn.length > 0 && (
            <div className="mt-2 inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-pill px-2.5 py-1">
              <span className="text-emerald-700 text-[11px] font-extrabold">✓ في الخطة</span>
              {scheduledOn.map((s) => (
                <span key={s.id} className="text-[11px] text-emerald-800 font-bold">
                  · {s.label} {s.emoji}
                </span>
              ))}
            </div>
          )}

          {/* Coffee-specific highlight chips (only on coffee category) +
              distinguishing offerings — meal times / pastry / dessert. */}
          {(coffeeChips.length > 0 || offerings.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {coffeeChips.map((c) => (
                <span
                  key={`coffee-${c.key}`}
                  className={`text-[10.5px] font-extrabold px-1.5 py-0.5 rounded-pill border inline-flex items-center gap-0.5 ${c.cls}`}
                >
                  <span>{c.emoji}</span>
                  <span>{c.ar}</span>
                </span>
              ))}
              {offerings.map((o) => (
                <span
                  key={o.key}
                  className="text-[10.5px] font-bold text-stone-700 bg-stone-50 border border-stone-200 px-1.5 py-0.5 rounded-pill inline-flex items-center gap-0.5"
                >
                  <span>{o.emoji}</span>
                  <span>{o.ar}</span>
                </span>
              ))}
            </div>
          )}

          {/* Review snippet (authentic) OR editorial summary (fallback) */}
          {reviewSnippet ? (
            <div className="mt-3 bg-stone-50 rounded-2xl p-3 border border-stone-100">
              <p className="text-[12.5px] text-stone-800 leading-relaxed line-clamp-3 italic" dir="auto">
                ❝ {reviewSnippet.quote} ❞
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[10.5px] text-stone-500">
                  <span className="font-bold text-stone-700">— {reviewSnippet.author}</span>
                  {reviewSnippet.rating != null && (
                    <>
                      <span>·</span>
                      <span className="text-amber-600 font-bold">★ {reviewSnippet.rating.toFixed(1)}</span>
                    </>
                  )}
                </div>
                {(() => {
                  const reviews = place.google_reviews as GoogleReviewSnippet[] | null | undefined;
                  if (!reviews || reviews.length <= 1) return null;
                  const arabicCount = reviews.filter((r) => r.language === "ar").length;
                  return (
                    <button
                      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                      className="inline-flex items-center text-[11.5px] font-bold text-sea px-2 min-h-[36px] rounded-pill active:scale-95 transition"
                    >
                      💬 اقرأ كل الآراء ({reviews.length}{arabicCount > 0 ? ` · 🇸🇦 ${arabicCount}` : ""}) ←
                    </button>
                  );
                })()}
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-stone-700 mt-2.5 leading-relaxed line-clamp-2">
              {summaryIcon} {editorialSummary}
            </p>
          )}

          {/* Facts strip — divider pattern */}
          <div className="mt-3 pt-3 border-t border-stone-100 flex items-center gap-x-3 gap-y-1 text-[12px] flex-wrap">
            {place.rating != null && (
              <span className="font-bold text-amber-700">
                ⭐ {place.rating.toFixed(1)}
                {reviewsShort && <span className="font-normal text-stone-400"> ({reviewsShort})</span>}
              </span>
            )}
            {distChip && (
              <span className={`font-bold inline-flex items-center gap-1.5 ${
                distChip.tone === "good" ? "text-emerald-700" :
                distChip.tone === "neut" ? "text-stone-700" :
                "text-orange-600"
              }`}>
                <span className="text-[10px] font-extrabold opacity-70">{distChip.fromLabel}</span>
                <span>{distChip.drive}</span>
                {distChip.walk && <span className="text-stone-500">· {distChip.walk}</span>}
                <span className="font-normal text-stone-400">· {distChip.kmLabel}</span>
              </span>
            )}
            {costShort && (
              <span className="font-extrabold text-ink">💰 {costShort}</span>
            )}
          </div>
        </div>

        {/* ─── Actions ─── */}
        <div className="px-4 pb-4 grid grid-cols-2 gap-2">
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener"
            onClick={(e) => e.stopPropagation()}
            className="bg-stone-100 hover:bg-stone-200 text-stone-900 text-center font-bold text-[12.5px] py-3 rounded-2xl active:scale-[0.98] transition"
            title="افتح في الخريطة لمزيد من التفاصيل"
          >
            🗺 الخريطة
          </a>
          <button
            onClick={(e) => {
              e.stopPropagation();
              // If we have trip context, open the inline picker — zero navigation.
              // Otherwise fall back to the carry-place flow.
              if (days.length > 0) setQuickOpen((q) => !q);
              else router.push(`/trips/${tripId}?add=${place.id}`);
            }}
            className={`font-bold text-[12.5px] py-3 rounded-2xl shadow-md active:scale-[0.98] transition ${
              quickOpen
                ? "bg-white border border-coral text-coral"
                : "bg-coral hover:bg-coral-600 text-white"
            }`}
          >
            {quickOpen ? "إغلاق" : "＋ أضف للخطة"}
          </button>
        </div>

        {/* Inline quick-add picker — only mounted when actually open */}
        {quickOpen && days.length > 0 && (
          <QuickAddPicker
            place={place}
            tripId={tripId}
            days={days}
            items={items}
            saved={saved}
            onSaveToggle={toggleSave}
            onChooseAnother={() => {
              setQuickOpen(false);
              router.push(`/trips/${tripId}?add=${place.id}`);
            }}
            onClose={() => setQuickOpen(false)}
            onAdded={onAdded}
          />
        )}
      </article>
    </>
  );
}

const PlaceCard = memo(PlaceCardImpl);
export default PlaceCard;
