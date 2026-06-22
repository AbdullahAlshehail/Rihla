"use client";

// Flexible "narrative" day view — 5 phases mapped to existing itinerary slots.
// Each phase shows the chosen item + up to 2 inline alternatives from the
// catalogue (picked by Decision Engine). Buttons: بدّل · تخطَّ · خذني هناك.

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ItineraryDay, ItineraryItem, Place, Trip, Slot } from "@/lib/supabase/database.types";
import { decide } from "@/lib/decision/engine";
import { fmtMins, fmtKm, fmtDayLong, estimateTravelTimes, haversineKm, buildDirectionsUrl } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";

type ItemWithPlace = ItineraryItem & { places: Place };

type PhaseDef = {
  key: string;
  ar: string;
  emoji: string;
  slots: Slot[];              // which slot(s) feed this phase
  preferredCategory?: Place["category"][]; // for picking alternatives
};

const PHASES: PhaseDef[] = [
  { key: "morning",    ar: "الصباح",       emoji: "☀️", slots: ["morning"], preferredCategory: ["coffee", "sight"] },
  { key: "midday",     ar: "الغداء",        emoji: "🍽", slots: ["midday"], preferredCategory: ["food"] },
  { key: "afternoon",  ar: "بعد الظهر",     emoji: "🌆", slots: ["afternoon"], preferredCategory: ["sight", "nature", "sweet"] },
  { key: "evening",    ar: "العشاء",        emoji: "🌙", slots: ["evening"], preferredCategory: ["food"] },
  { key: "night",      ar: "آخر اليوم",     emoji: "🌃", slots: ["night"], preferredCategory: ["bar", "event", "sweet"] },
];

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

export default function DayView({
  trip,
  day,
  items,
  catalogue,
  allDays,
}: {
  trip: Trip;
  day: ItineraryDay | null;
  items: ItemWithPlace[];
  catalogue: Place[];
  allDays: ItineraryDay[];
}) {
  const router = useRouter();
  const [, startTx] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [altCursors, setAltCursors] = useState<Record<string, number>>({});

  const hotelLocation = useMemo(
    () => (trip.hotel_lat != null && trip.hotel_lng != null
      ? { lat: trip.hotel_lat, lng: trip.hotel_lng } : null),
    [trip.hotel_lat, trip.hotel_lng],
  );

  // Group plan items by their slot
  const itemsBySlot = useMemo(() => {
    const map = new Map<Slot, ItemWithPlace[]>();
    for (const it of items) {
      const arr = map.get(it.slot) ?? [];
      arr.push(it);
      map.set(it.slot, arr);
    }
    return map;
  }, [items]);

  // For each phase, find the placed item + alternatives (from catalogue)
  type PhaseSlot = {
    phase: PhaseDef;
    placed: ItemWithPlace | null;
    alternatives: Place[];
  };

  const phaseSlots: PhaseSlot[] = useMemo(() => {
    const now = new Date();
    return PHASES.map((phase) => {
      // Placed = first item that lives in any of the phase's mapped slots
      let placed: ItemWithPlace | null = null;
      for (const s of phase.slots) {
        const arr = itemsBySlot.get(s);
        if (arr && arr.length > 0) { placed = arr[0]; break; }
      }
      // Alternatives = top scored places matching the preferred category,
      // excluding any place already placed today in any slot
      const usedIds = new Set(items.map((it) => it.place_id));
      const candidates = catalogue.filter(
        (p) =>
          !usedIds.has(p.id) &&
          phase.preferredCategory?.includes(p.category),
      );
      const scored = candidates.map((p) => {
        const dec = decide(p, {
          now,
          currentLocation: null,
          hotelLocation,
          preferenceMode: null,
        });
        return { p, conf: dec.confidence, blocked: dec.verdict === "skip" || dec.verdict === "too_far" };
      });
      const ranked = scored
        .filter((s) => !s.blocked)
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 6) // small pool — UI cycles through with 🔄
        .map((s) => s.p);
      return { phase, placed, alternatives: ranked };
    });
  }, [itemsBySlot, items, catalogue, hotelLocation]);

  // Track anchor point for distance between phases
  function getPrevAnchor(idx: number): { lat: number; lng: number; name: string } | null {
    for (let i = idx - 1; i >= 0; i--) {
      const slot = phaseSlots[i];
      const p = slot.placed?.places;
      if (p && p.lat != null && p.lng != null) {
        return { lat: p.lat, lng: p.lng, name: p.name };
      }
    }
    if (hotelLocation) return { lat: hotelLocation.lat, lng: hotelLocation.lng, name: trip.hotel_name ?? "الفندق" };
    return null;
  }

  async function skipItem(item: ItemWithPlace) {
    if (busy) return;
    setBusy(item.id);
    try {
      await fetch(`/api/trips/${trip.id}/itinerary/${item.id}`, { method: "DELETE" }).catch(() => {});
    } finally {
      setBusy(null);
      startTx(() => router.refresh());
    }
  }

  async function swapItem(item: ItemWithPlace, replacement: Place) {
    if (busy) return;
    setBusy(item.id);
    try {
      const r = await fetch(`/api/trips/${trip.id}/itinerary/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place_id: replacement.id }),
      });
      if (!r.ok) console.warn("swap failed", await r.text());
    } finally {
      setBusy(null);
      startTx(() => router.refresh());
    }
  }

  async function addToSlot(phase: PhaseDef, place: Place) {
    if (!day || busy) return;
    setBusy(`add-${phase.key}`);
    try {
      await fetch(`/api/trips/${trip.id}/itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day_date: day.day_date,
          place_id: place.id,
          slot: phase.slots[0],
        }),
      });
    } finally {
      setBusy(null);
      startTx(() => router.refresh());
    }
  }

  const hotelHref = hotelLocation
    ? `https://www.google.com/maps/dir/?api=1&destination=${hotelLocation.lat},${hotelLocation.lng}`
    : null;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-5">
      <Link href={`/trips/${trip.id}`} className="text-sea text-sm font-bold inline-block mb-3">
        ← {trip.name}
      </Link>

      {/* Header */}
      <header className="bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 text-white rounded-2xl p-4 shadow-lg mb-3">
        <h1 className="font-serif font-extrabold text-2xl">📋 خطة اليوم</h1>
        <div className="mt-1 text-[12px] opacity-95">
          {day ? fmtDayLong(day.day_date) : "ما في يوم مخطّط بعد"}
          {trip.destination_city && <> · {trip.destination_city}</>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/trips/${trip.id}/plan`}
            className="bg-white/20 border border-white/30 text-[11px] font-bold px-3 py-1.5 rounded-pill"
          >
            📅 العرض الكلاسيكي
          </Link>
          {allDays.length > 1 && (
            <Link
              href={`/trips/${trip.id}/plan`}
              className="bg-white/20 border border-white/30 text-[11px] font-bold px-3 py-1.5 rounded-pill"
            >
              🗓 {allDays.length} أيام
            </Link>
          )}
        </div>
      </header>

      {/* Phases */}
      {!day ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-center">
          <p className="text-muted text-sm leading-relaxed mb-3">
            ما في خطة لهذي الرحلة بعد. ابدأ من العرض الكلاسيكي:
          </p>
          <Link
            href={`/trips/${trip.id}/plan`}
            className="inline-block bg-sea text-white font-bold text-xs px-4 py-2 rounded-xl"
          >
            افتح المخطّط
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {phaseSlots.map((ps, idx) => {
            const prev = getPrevAnchor(idx);
            const placedPlace = ps.placed?.places ?? null;

            // Hop info from previous anchor
            let hop: { km: number; minutes: number; mode: "walk" | "drive"; from: string } | null = null;
            if (prev && placedPlace?.lat != null && placedPlace?.lng != null) {
              const km = haversineKm(prev, { lat: placedPlace.lat, lng: placedPlace.lng });
              const t = estimateTravelTimes(km);
              const isWalk = km < 2;
              hop = { km, minutes: isWalk ? t.walkMin : t.driveMin, mode: isWalk ? "walk" : "drive", from: prev.name };
            }

            return (
              <section key={ps.phase.key} className="bg-card border border-line rounded-2xl shadow overflow-hidden">
                {/* Phase header */}
                <div className="px-3 py-2 bg-stone-50 border-b border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{ps.phase.emoji}</span>
                    <span className="font-serif font-extrabold text-sm">{ps.phase.ar}</span>
                  </div>
                  {hop && (
                    <span className="text-[10.5px] text-muted">
                      {hop.mode === "walk" ? "🚶" : "🚗"} {fmtMins(hop.minutes)} · {fmtKm(hop.km)} من {hop.from}
                    </span>
                  )}
                </div>

                {/* Placed item OR empty state */}
                {ps.placed && placedPlace ? (
                  <PhaseItem
                    tripId={trip.id}
                    place={placedPlace}
                    alternatives={ps.alternatives}
                    onSkip={() => ps.placed && skipItem(ps.placed)}
                    onSwap={(alt) => ps.placed && swapItem(ps.placed, alt)}
                    busy={busy === ps.placed.id}
                    cursor={altCursors[ps.phase.key] ?? 0}
                    onAdvanceCursor={() =>
                      setAltCursors((c) => ({ ...c, [ps.phase.key]: ((c[ps.phase.key] ?? 0) + 1) % Math.max(1, ps.alternatives.length) }))
                    }
                  />
                ) : (
                  <EmptyPhase
                    phase={ps.phase}
                    alternatives={ps.alternatives}
                    onAdd={(p) => addToSlot(ps.phase, p)}
                    busy={busy === `add-${ps.phase.key}`}
                  />
                )}
              </section>
            );
          })}

          {/* Return to hotel — last phase as action button */}
          <section className="bg-card border border-line rounded-2xl shadow overflow-hidden">
            <div className="px-3 py-2 bg-stone-50 border-b border-line flex items-center gap-2">
              <span className="text-lg">🏨</span>
              <span className="font-serif font-extrabold text-sm">رجعة الفندق</span>
            </div>
            <div className="p-3">
              {hotelHref ? (
                <a
                  href={hotelHref}
                  target="_blank"
                  rel="noopener"
                  className="block bg-gradient-to-br from-coral to-coral-600 text-white text-center font-bold text-sm py-3 rounded-xl shadow"
                >
                  🧭 خذني للفندق
                </a>
              ) : (
                <p className="text-[12px] text-muted text-center">
                  لا يوجد موقع للفندق. عدّله من ⚙ إعدادات الرحلة.
                </p>
              )}
            </div>
          </section>
        </div>
      )}

      <p className="text-[10.5px] text-muted text-center mt-4">
        ✓ بدون أي طلب إلى Google · القرارات محلّية
      </p>
    </main>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PhaseItem({
  tripId, place, alternatives, onSkip, onSwap, busy, cursor, onAdvanceCursor,
}: {
  tripId: string;
  place: Place;
  alternatives: Place[];
  onSkip: () => void;
  onSwap: (alt: Place) => void;
  busy: boolean;
  cursor: number;
  onAdvanceCursor: () => void;
}) {
  const dirHref = place.lat != null && place.lng != null ? buildDirectionsUrl(place) : null;
  const altPick = alternatives.length > 0 ? alternatives[cursor % alternatives.length] : null;

  const shortBlurb = place.ai_summary ?? place.review_summary ?? place.tip ?? "";

  return (
    <div className="p-3 space-y-2">
      {/* Main place */}
      <div className="flex items-start gap-3">
        <div className={`w-12 h-12 rounded-xl shrink-0 overflow-hidden grid place-items-center text-xl ${
          place.photo_url ? "bg-stone-200" : "bg-stone-100"
        }`}>
          {place.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoAtWidth(place.photo_url, 320) ?? undefined} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            CAT_EMOJI[place.category] ?? "✦"
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-serif font-extrabold text-[14px] leading-tight line-clamp-1">{place.name}</div>
          <div className="text-[11px] text-muted mt-0.5 flex items-center gap-x-2 flex-wrap">
            {place.rating != null && (<span><b className="text-ink">{place.rating.toFixed(1)}</b>★</span>)}
            {place.cost_estimate != null && place.cost_estimate > 0 && (
              <span className="font-bold text-ink">
                {place.cost_currency === "SAR" ? `${Math.round(place.cost_estimate)} ر.س` : `~${Math.round(place.cost_estimate)} ${place.cost_currency}`}
              </span>
            )}
          </div>
          {shortBlurb && (
            <p className="text-[11px] text-ink/75 mt-1 leading-snug line-clamp-2">
              {place.ai_summary ? "🧠 " : "📝 "}{shortBlurb}
            </p>
          )}
        </div>
      </div>

      {/* Inline alternative (cycle with 🔄) */}
      {altPick && (
        <div className="bg-stone-50/80 rounded-xl px-2.5 py-1.5 border border-line flex items-center gap-2">
          <span className="text-base">{CAT_EMOJI[altPick.category] ?? "✦"}</span>
          <div className="flex-1 min-w-0">
            <div className="text-[10.5px] text-muted">بديل مقترح:</div>
            <div className="text-[12px] font-bold text-ink line-clamp-1">{altPick.name}
              {altPick.rating != null && <span className="text-muted font-normal text-[10.5px]"> · {altPick.rating.toFixed(1)}★</span>}
            </div>
          </div>
          <button
            onClick={() => onSwap(altPick)}
            disabled={busy}
            className="bg-sea text-white font-bold text-[10.5px] px-2.5 py-1 rounded-pill disabled:opacity-50"
          >
            بدّل
          </button>
          {alternatives.length > 1 && (
            <button
              onClick={onAdvanceCursor}
              className="text-muted text-sm w-7 h-7 rounded-full bg-white border border-line"
              aria-label="بديل آخر"
            >
              ↻
            </button>
          )}
        </div>
      )}

      {/* Actions row */}
      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
        {dirHref ? (
          <a
            href={dirHref}
            target="_blank"
            rel="noopener"
            className="bg-coral text-white text-center font-bold text-xs py-2 rounded-xl"
          >
            🧭 خذني
          </a>
        ) : (
          <button disabled className="bg-stone-200 text-stone-500 font-bold text-xs py-2 rounded-xl">
            🧭 —
          </button>
        )}
        <button
          onClick={onSkip}
          disabled={busy}
          className="bg-white border border-line text-muted font-bold text-xs py-2 rounded-xl disabled:opacity-40"
        >
          ✕ حذف
        </button>
        <Link
          href={`/trips/${tripId}/places`}
          className="bg-white border border-sea/30 text-sea text-center font-bold text-xs py-2 rounded-xl flex items-center justify-center"
        >
          📍 استكشف
        </Link>
      </div>
    </div>
  );
}

function EmptyPhase({
  phase, alternatives, onAdd, busy,
}: {
  phase: PhaseDef;
  alternatives: Place[];
  onAdd: (p: Place) => void;
  busy: boolean;
}) {
  const top2 = alternatives.slice(0, 2);
  return (
    <div className="p-3 space-y-2">
      <p className="text-[12px] text-muted text-center">
        ما اخترت بعد لـ <b>{phase.ar}</b>. مقترحات:
      </p>
      {top2.length === 0 ? (
        <p className="text-[11px] text-muted text-center">لا توجد مقترحات في الكتالوج.</p>
      ) : (
        <div className="space-y-1.5">
          {top2.map((p) => (
            <button
              key={p.id}
              onClick={() => onAdd(p)}
              disabled={busy}
              className="w-full text-right bg-white border border-line rounded-xl px-3 py-2 flex items-center gap-2 disabled:opacity-50 active:bg-stone-50"
            >
              <span className="text-lg">{CAT_EMOJI[p.category] ?? "✦"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-bold text-ink line-clamp-1">{p.name}</div>
                <div className="text-[10.5px] text-muted">
                  {p.rating != null && <>★ {p.rating.toFixed(1)} · </>}
                  {p.category}
                </div>
              </div>
              <span className="bg-coral text-white text-[10.5px] font-bold px-2 py-1 rounded-pill">＋ أضف</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
