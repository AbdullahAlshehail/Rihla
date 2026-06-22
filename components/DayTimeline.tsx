"use client";

// DayTimeline — compact "bucket + card + bridge" plan view inspired by
// Wanderlog. Replaces the older 5-section-cards layout.
//
// Visual model:
//   ── 🌅 الصباح · ٧–١٠ص ──
//      [photo][name + facts + ✕] ← single card per item
//             🚗 ٨د · ٢.٥كم      ← bridge pill between items
//      [photo][name + facts + ✕]
//   ── 🍽 الغداء · ١٢–٣ظ ──
//      [+ أضف غداء + 2 mini suggestions]  ← dashed CTA when empty
//
// Goals: less chrome, bigger photos, clearer hierarchy, lower color noise.

import { useState, memo } from "react";
import type { ItineraryDay, ItineraryItem, Place, GoogleReviewSnippet } from "@/lib/supabase/database.types";
import { PHASES, type PhaseDef } from "@/lib/plan/phases";
import {
  fmtMins, fmtKm, estimateTravelTimes, haversineKm, buildDirectionsUrl,
  formatOpenStatus,
} from "@/lib/utils";
import { getKindDisplay, getCategoryDisplay } from "@/lib/highlights";
import {
  summarizeFromPlaceFields, estimateVisitDuration, pickReviewSnippet,
} from "@/lib/google/inferKind";
import { allOfferings } from "@/lib/discover/offerings";
import { photoAtWidth } from "@/lib/images";

type ItemWithPlace = ItineraryItem & { places: Place };

export type PhaseSlotData = {
  phase: PhaseDef;
  placed: ItemWithPlace[];
  alternatives: Place[];
};

export default function DayTimeline({
  phaseSlots,
  hotelLocation,
  hotelName,
  busy,
  allDays,
  selectedDayId,
  prevAnchorOf,
  onOpenAdd,
  onAddPlace,
  onSwap,
  onRemove,
  onMove,
}: {
  phaseSlots: PhaseSlotData[];
  hotelLocation: { lat: number; lng: number } | null;
  hotelName: string;
  /** Disable interactions while a request is in flight */
  busy: string | null;
  /** All trip days — used for the "move to other day" picker */
  allDays: ItineraryDay[];
  /** ID of the currently-shown day */
  selectedDayId: string | null;
  /** Returns the previous item's location for hop calculation */
  prevAnchorOf: (idx: number) => { lat: number; lng: number; name: string } | null;
  /** Open AddToPlanSheet primed for the given phase */
  onOpenAdd: (phase: PhaseDef) => void;
  /** Quick-add an alternative directly */
  onAddPlace: (place: Place, phase: PhaseDef) => void;
  /** Swap an existing item with a different place */
  onSwap: (item: ItemWithPlace, replacement: Place) => void;
  /** Remove an item from the plan */
  onRemove: (item: ItemWithPlace) => void;
  /** Move an item to a different (day, phase) — undefined skips the change */
  onMove: (item: ItemWithPlace, target: { day_date?: string; slot?: string }) => void;
}) {
  return (
    <div className="space-y-1">
      {phaseSlots.map((ps, idx) => (
        <PhaseSection
          key={ps.phase.key}
          phaseSlot={ps}
          previous={prevAnchorOf(idx)}
          hotelLocation={hotelLocation}
          hotelName={hotelName}
          busy={busy}
          allDays={allDays}
          selectedDayId={selectedDayId}
          onOpenAdd={() => onOpenAdd(ps.phase)}
          onAddPlace={(p) => onAddPlace(p, ps.phase)}
          onSwap={onSwap}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

// ── Phase section: soft header + cards + (optional) empty CTA ───────────

function PhaseSection({
  phaseSlot, previous, hotelLocation, hotelName, busy,
  allDays, selectedDayId,
  onOpenAdd, onAddPlace, onSwap, onRemove, onMove,
}: {
  phaseSlot: PhaseSlotData;
  previous: { lat: number; lng: number; name: string } | null;
  hotelLocation: { lat: number; lng: number } | null;
  hotelName: string;
  busy: string | null;
  allDays: ItineraryDay[];
  selectedDayId: string | null;
  onOpenAdd: () => void;
  onAddPlace: (p: Place) => void;
  onSwap: (item: ItemWithPlace, replacement: Place) => void;
  onRemove: (item: ItemWithPlace) => void;
  onMove: (item: ItemWithPlace, target: { day_date?: string; slot?: string }) => void;
}) {
  const ps = phaseSlot;
  const isEmpty = ps.placed.length === 0;

  return (
    <section className="pt-3">
      {/* Soft phase header — labels only, no card chrome */}
      <header className="flex items-center gap-2 mb-1.5 px-1">
        <span className="text-base">{ps.phase.emoji}</span>
        <span className="font-serif font-extrabold text-[14px] text-ink">{ps.phase.ar}</span>
        <span className="text-[10.5px] text-stone-400 font-medium tracking-tight">{ps.phase.timeAr}</span>
        {ps.placed.length > 0 && (
          <span className="text-[10px] text-stone-500 ms-auto">
            {ps.placed.length} مكان
          </span>
        )}
      </header>

      {isEmpty ? (
        <EmptyPhaseCTA phase={ps.phase} alternatives={ps.alternatives}
                       onAdd={onOpenAdd} onPick={onAddPlace} disabled={busy != null} />
      ) : (
        <div>
          {ps.placed.map((item, i) => {
            // Bridge — from previous item in this phase, or from previous phase
            const prevPoint = i === 0 ? previous : {
              lat: ps.placed[i - 1].places.lat ?? 0,
              lng: ps.placed[i - 1].places.lng ?? 0,
              name: ps.placed[i - 1].places.name,
            };
            return (
              <div key={item.id}>
                {prevPoint && item.places.lat != null && item.places.lng != null && (
                  <Bridge from={prevPoint} to={{ lat: item.places.lat, lng: item.places.lng }} />
                )}
                {i === 0 && !prevPoint && (
                  <div className="text-center text-[10px] text-stone-300 my-1">— من {hotelName} —</div>
                )}
                <ItemCard
                  item={item}
                  hotelLocation={hotelLocation}
                  alternatives={i === ps.placed.length - 1 ? ps.alternatives : []}
                  busy={busy === item.id}
                  currentPhase={ps.phase}
                  allDays={allDays}
                  selectedDayId={selectedDayId}
                  onSwap={(alt) => onSwap(item, alt)}
                  onRemove={() => onRemove(item)}
                  onMove={(target) => onMove(item, target)}
                />
              </div>
            );
          })}
          {/* Quick add to the same phase — small, after the items */}
          <button
            onClick={onOpenAdd}
            disabled={busy != null}
            className="mt-2 w-full text-[12px] font-bold text-stone-600 bg-white border border-dashed border-stone-300 rounded-xl py-2 active:scale-[.99] transition disabled:opacity-50"
          >
            ＋ أضف مكان آخر لـ {ps.phase.ar}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Empty state: dashed-card CTA with mini suggestions ──────────────────

function EmptyPhaseCTA({
  phase, alternatives, onAdd, onPick, disabled,
}: {
  phase: PhaseDef;
  alternatives: Place[];
  onAdd: () => void;
  onPick: (place: Place) => void;
  disabled: boolean;
}) {
  const suggestions = alternatives.slice(0, 2);
  return (
    <button
      onClick={onAdd}
      disabled={disabled}
      className="w-full text-right bg-stone-50/60 border border-dashed border-stone-300 hover:border-coral hover:bg-coral/5 rounded-2xl px-3 py-2.5 active:scale-[.99] transition disabled:opacity-50"
    >
      <div className="flex items-center justify-between">
        <span className="font-bold text-[13px] text-stone-600">
          ＋ أضف لـ {phase.ar}
        </span>
        <span className="text-[10.5px] text-stone-400">اختر أو اقترح</span>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
          {suggestions.map((p) => (
            <button
              key={p.id}
              onClick={(e) => { e.stopPropagation(); onPick(p); }}
              disabled={disabled}
              className="text-[10.5px] font-bold text-stone-800 bg-white border border-stone-200 hover:border-coral rounded-pill px-2 py-0.5 active:scale-95 disabled:opacity-50"
              title={p.name}
            >
              ✦ {p.name.length > 22 ? p.name.slice(0, 22) + "…" : p.name}
            </button>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Bridge pill between two cards ──────────────────────────────────────

function Bridge({ from, to }: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}) {
  const km = haversineKm(from, to);
  if (km < 0.02) return null; // same location — don't show
  const t = estimateTravelTimes(km);
  const walk = km < 1.2;
  return (
    <div className="text-center my-1">
      <span className="inline-flex items-center gap-1.5 text-[10.5px] text-stone-500 bg-stone-50 border border-stone-200 rounded-pill px-2 py-0.5">
        <span>{walk ? "🚶" : "🚗"}</span>
        <span className="font-bold">{walk ? fmtMins(t.walkMin) : fmtMins(t.driveMin)}</span>
        <span className="text-stone-400">· {fmtKm(km)}</span>
      </span>
    </div>
  );
}

// ── ItemCard — single placed place, photo + name + facts + menu ─────────

type MoveMode = "phase" | "day" | null;

const ItemCard = memo(function ItemCard({
  item, hotelLocation, alternatives, busy,
  currentPhase, allDays, selectedDayId,
  onSwap, onRemove, onMove,
}: {
  item: ItemWithPlace;
  hotelLocation: { lat: number; lng: number } | null;
  alternatives: Place[];
  busy: boolean;
  currentPhase: PhaseDef;
  allDays: ItineraryDay[];
  selectedDayId: string | null;
  onSwap: (alt: Place) => void;
  onRemove: () => void;
  onMove: (target: { day_date?: string; slot?: string }) => void;
}) {
  const place = item.places;
  const [menuOpen, setMenuOpen] = useState(false);
  const [altOpen, setAltOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<MoveMode>(null);

  const mapsHref = place.lat != null && place.lng != null ? buildDirectionsUrl(place) : null;

  // Same data the Discover card surfaces, so the user doesn't have to flip
  // back to recall what they added.
  const cat = getCategoryDisplay(place.category);
  const kind = getKindDisplay(place.kind);
  const status = formatOpenStatus(place.opening_hours);
  const offerings = allOfferings(place);
  const visitDuration = estimateVisitDuration(place.category);
  const reviewSnippet = pickReviewSnippet(
    place.google_reviews as GoogleReviewSnippet[] | null | undefined,
  );
  const editorialSummary =
    place.ai_summary
    || place.review_summary
    || place.tip
    || summarizeFromPlaceFields({
        rating: place.rating,
        reviewCount: place.review_count,
        priceLevel: place.price_level,
        kindAr: kind?.ar ?? null,
        cityLabel: place.city_label,
      });
  const summaryIcon =
    place.ai_summary ? "🧠"
    : place.review_summary ? "📝"
    : place.tip ? "💡"
    : "ℹ️";

  // Compact distance from hotel — show BOTH walk + drive when in walkable range
  let hotelDist: { drive: string; walk: string | null; kmLabel: string } | null = null;
  if (hotelLocation && place.lat != null && place.lng != null) {
    const km = haversineKm(hotelLocation, { lat: place.lat, lng: place.lng });
    const t = estimateTravelTimes(km);
    hotelDist = {
      drive: `🚗 ${fmtMins(t.driveMin)}`,
      walk: km <= 3 ? `🚶 ${fmtMins(t.walkMin)}` : null,
      kmLabel: fmtKm(km),
    };
  }

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

  return (
    <article className={`bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden ${busy ? "opacity-60" : ""}`}>
      <div className="p-2.5 flex gap-2.5">
        {/* Photo — bigger than before (80×80) to actually help recognition.
            Served at 240px (3× DPR) for sharp display without bloating payload. */}
        <div className="w-20 h-20 rounded-xl shrink-0 overflow-hidden bg-stone-100 grid place-items-center text-2xl">
          {place.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoAtWidth(place.photo_url, 240) ?? undefined} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <span>{cat.emoji}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title + open badge + close (✕) inline */}
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-serif font-extrabold text-[14.5px] text-ink leading-tight line-clamp-2">
              {place.name}
            </h3>
            <span className={`shrink-0 text-[10.5px] font-bold px-2 py-1 rounded-pill mt-0.5 ${
              status.isOpen
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}>
              {status.isOpen ? "🟢" : "🔴"}
            </span>
            <button
              onClick={onRemove}
              disabled={busy}
              aria-label="حذف من الخطة"
              className="shrink-0 w-9 h-9 rounded-full text-stone-500 hover:bg-rose-50 hover:text-rose-600 grid place-items-center text-[14px] disabled:opacity-50"
            >
              ✕
            </button>
          </div>

          {/* Type + city + visit duration */}
          <p className="text-[10.5px] text-stone-500 mt-0.5 line-clamp-1">
            <span className="font-bold text-stone-700">{cat.emoji} {cat.ar}</span>
            {kind && <> · {kind.ar}</>}
            {place.city_label && <> · 📍 {place.city_label}</>}
            <> · ⏱ {visitDuration}</>
          </p>

          {/* Offering chips — same set Discover shows */}
          {offerings.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {offerings.slice(0, 4).map((o) => (
                <span
                  key={o.key}
                  className="text-[10.5px] font-bold text-stone-700 bg-stone-50 border border-stone-200 px-2 py-0.5 rounded-pill inline-flex items-center gap-1"
                >
                  <span>{o.emoji}</span>
                  <span>{o.ar}</span>
                </span>
              ))}
            </div>
          )}

          {/* One-line factstrip — rating · distance · cost */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
            {place.rating != null && (
              <span className="font-bold text-amber-700">
                ★ {place.rating.toFixed(1)}
                {reviewsShort && <span className="font-normal text-stone-400"> · {reviewsShort}</span>}
              </span>
            )}
            {hotelDist && (
              <span className="text-stone-700 inline-flex items-center gap-1">
                <span className="font-bold">{hotelDist.drive}</span>
                {hotelDist.walk && <span className="text-stone-500">· {hotelDist.walk}</span>}
                <span className="font-normal text-stone-400">· {hotelDist.kmLabel}</span>
              </span>
            )}
            {costShort && <span className="font-bold text-ink">💰 {costShort}</span>}
          </div>

          {/* Review snippet OR editorial summary — same content as Discover */}
          {reviewSnippet ? (
            <div className="mt-1.5 bg-stone-50 border border-stone-100 rounded-xl px-2 py-1.5">
              <p className="text-[11px] text-stone-800 leading-snug line-clamp-2 italic" dir="auto">
                ❝ {reviewSnippet.quote} ❞
              </p>
              <div className="mt-0.5 text-[9.5px] text-stone-500">
                — {reviewSnippet.author}
                {reviewSnippet.rating != null && (
                  <> · <span className="text-amber-600 font-bold">★ {reviewSnippet.rating.toFixed(1)}</span></>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-stone-600 leading-snug line-clamp-2">
              {summaryIcon} {editorialSummary}
            </p>
          )}

          {/* Actions row — primary maps + secondary menu */}
          <div className="mt-1.5 flex gap-1.5">
            {mapsHref && (
              <a
                href={mapsHref}
                target="_blank"
                rel="noopener"
                className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-900 text-center text-[11.5px] font-bold py-1.5 rounded-pill active:scale-95"
              >
                🗺 الخريطة
              </a>
            )}
            {alternatives.length > 0 && (
              <button
                onClick={() => { setAltOpen((v) => !v); setMenuOpen(false); }}
                disabled={busy}
                aria-expanded={altOpen}
                aria-controls={`alts-${item.id}`}
                className="bg-white border border-stone-200 hover:border-coral text-stone-700 text-[11.5px] font-bold px-2.5 py-1.5 rounded-pill active:scale-95 disabled:opacity-50"
              >
                🔁 بدّل ({alternatives.length})
              </button>
            )}
            <button
              onClick={() => { setMenuOpen((v) => !v); setAltOpen(false); }}
              disabled={busy}
              aria-label="خيارات المكان"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="bg-white border border-stone-200 hover:border-stone-400 text-stone-700 text-[13px] font-bold w-10 h-9 rounded-pill active:scale-95 disabled:opacity-50"
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {/* Alternatives panel — slides under the card */}
      {altOpen && alternatives.length > 0 && (
        <div id={`alts-${item.id}`} className="border-t border-stone-100 bg-stone-50/50 px-2.5 py-2 space-y-1.5">
          <div className="text-[10.5px] font-bold text-stone-600 mb-1">اختر بديل:</div>
          {alternatives.slice(0, 3).map((alt) => (
            <button
              key={alt.id}
              onClick={() => { onSwap(alt); setAltOpen(false); }}
              disabled={busy}
              className="w-full text-right bg-white border border-stone-200 hover:border-coral rounded-xl px-2 py-1.5 flex items-center gap-2 disabled:opacity-50"
            >
              <div className="w-9 h-9 rounded-lg bg-stone-100 shrink-0 overflow-hidden grid place-items-center text-base">
                {alt.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoAtWidth(alt.photo_url, 96) ?? undefined} alt={alt.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : "📍"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[11.5px] line-clamp-1">{alt.name}</div>
                {alt.rating != null && (
                  <div className="text-[10px] text-amber-700">★ {alt.rating.toFixed(1)}</div>
                )}
              </div>
              <span className="text-[10.5px] font-bold text-coral">بدّل ←</span>
            </button>
          ))}
        </div>
      )}

      {/* Secondary menu — quick actions */}
      {menuOpen && moveMode === null && (
        <div className="border-t border-stone-100 bg-stone-50/50 px-2.5 py-1.5 flex flex-wrap gap-1.5">
          <button
            onClick={() => { setMoveMode("phase"); }}
            disabled={busy}
            className="text-[11.5px] font-bold text-stone-800 bg-white border border-stone-200 hover:border-coral px-2.5 py-1.5 rounded-pill disabled:opacity-50"
          >
            🕐 غيّر الفترة
          </button>
          <button
            onClick={() => { setMoveMode("day"); }}
            disabled={busy || allDays.length <= 1}
            className="text-[11.5px] font-bold text-stone-800 bg-white border border-stone-200 hover:border-coral px-2.5 py-1.5 rounded-pill disabled:opacity-50"
          >
            📅 انقل ليوم آخر
          </button>
          {alternatives.length > 0 && (
            <button
              onClick={() => { setAltOpen(true); setMenuOpen(false); }}
              className="text-[11px] font-bold text-stone-800 bg-white border border-stone-200 hover:border-coral px-2 py-0.5 rounded-pill"
            >
              🔁 بدّل المكان
            </button>
          )}
          <button
            onClick={() => { onRemove(); setMenuOpen(false); }}
            disabled={busy}
            className="text-[11.5px] font-bold text-rose-700 bg-white border border-rose-200 hover:bg-rose-50 px-2.5 py-1.5 rounded-pill ms-auto disabled:opacity-50"
          >
            ✕ حذف
          </button>
        </div>
      )}

      {/* "Move to a different phase" picker */}
      {menuOpen && moveMode === "phase" && (
        <div className="border-t border-stone-100 bg-stone-50/50 px-2.5 py-2">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-bold text-stone-700">📍 نقل إلى فترة ثانية في نفس اليوم:</span>
            <button onClick={() => setMoveMode(null)} aria-label="رجوع" className="text-stone-500 hover:text-stone-700 text-[12px] font-bold">↩ رجوع</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PHASES.filter((ph) => ph.key !== currentPhase.key).map((ph) => (
              <button
                key={ph.key}
                onClick={() => { onMove({ slot: ph.slots[0] }); setMenuOpen(false); setMoveMode(null); }}
                disabled={busy}
                className="text-[11.5px] font-bold text-stone-800 bg-white border border-stone-200 hover:border-coral px-2.5 py-1.5 rounded-pill disabled:opacity-50"
                title={`${ph.ar} · ${ph.timeAr}`}
              >
                {ph.emoji} {ph.ar}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* "Move to a different day" picker */}
      {menuOpen && moveMode === "day" && (
        <div className="border-t border-stone-100 bg-stone-50/50 px-2.5 py-2">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[11px] font-bold text-stone-700">📅 نقل إلى يوم آخر:</span>
            <button onClick={() => setMoveMode(null)} aria-label="رجوع" className="text-stone-500 hover:text-stone-700 text-[12px] font-bold">↩ رجوع</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allDays.filter((d) => d.id !== selectedDayId).map((d, _i) => {
              const dayIdx = allDays.findIndex((dd) => dd.id === d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => { onMove({ day_date: d.day_date }); setMenuOpen(false); setMoveMode(null); }}
                  disabled={busy}
                  className="text-[11.5px] font-bold text-stone-800 bg-white border border-stone-200 hover:border-coral px-2.5 py-1.5 rounded-pill disabled:opacity-50"
                >
                  يوم {dayIdx + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
});
