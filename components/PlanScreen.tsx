"use client";

// New /plan view: multi-day phases with day tabs + one-tap add via
// AddToPlanSheet. No new Google calls. Replaces the old InteractiveDayCard
// experience while keeping the underlying schema (itinerary_days / _items).

import { useState, useMemo, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  ItineraryDay, ItineraryItem, Place, Slot, Trip,
} from "@/lib/supabase/database.types";
import {
  fmtMins, fmtKm, fmtMoneySAR, fmtDayLong,
  estimateTravelTimes, haversineKm, buildDirectionsUrl,
} from "@/lib/utils";
import dynamic from "next/dynamic";
import { decide } from "@/lib/decision/engine";
import { instantScore, summarizeFromPlaceFields, scoreVerdict } from "@/lib/google/inferKind";
import { getCategoryDisplay, getKindDisplay } from "@/lib/highlights";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import { PHASES, type PhaseDef } from "@/lib/plan/phases";
import DayTimeline from "@/components/DayTimeline";
import SmartFillSheet from "@/components/SmartFillSheet";
import { photoAtWidth } from "@/lib/images";
import type { UserRating } from "@/lib/supabase/database.types";

// Lazy-load — only ships to the client when the sheet actually opens
const AddToPlanSheet = dynamic(() => import("@/components/AddToPlanSheet"), {
  ssr: false,
});

type ItemWithPlace = ItineraryItem & { places: Place };

// PhaseDef + PHASES come from lib/plan/phases.ts — single source of truth
// shared with QuickAddPicker, SmartPlan, and DayView.

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

function MenuItem({
  children, onClick, disabled = false, danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-right px-3 py-2.5 flex items-center gap-2 text-[12.5px] font-bold transition disabled:opacity-40 ${
        danger
          ? "text-rose-700 hover:bg-rose-50 active:bg-rose-100"
          : "text-stone-800 hover:bg-stone-50 active:bg-stone-100"
      }`}
    >
      {children}
    </button>
  );
}

function arabicDayShort(dateStr: string): string {
  const d = new Date(dateStr);
  const ar = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  return ar[d.getDay()];
}

function dayNumber(dateStr: string): string {
  const d = new Date(dateStr);
  return String(d.getDate());
}

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function PlanScreen({
  trip,
  days,
  items,
  catalogue,
  savedSet = new Set(),
  userRatings = new Map(),
  embedded = false,
}: {
  trip: Trip;
  days: ItineraryDay[];
  items: ItemWithPlace[];
  catalogue: Place[];
  /** Saved (wishlist) place IDs — surfaces them as a banner with quick-add */
  savedSet?: Set<string>;
  /** User ratings — feed Smart Fill so it prefers loved places, skips disliked */
  userRatings?: Map<string, { stars: number | null; verdict: "love" | "meh" | "skip" | null }>;
  /** When true, skip the outer <main>/back-link/trip-header chrome —
   *  caller (TripScreen) already supplies them. */
  embedded?: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTx] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [activeAddPhase, setActiveAddPhase] = useState<PhaseDef | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "info" } | null>(null);

  function showToast(text: string, tone: "success" | "info" = "success") {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3500);
  }

  const hotelLocation = useMemo(
    () => (trip.hotel_lat != null && trip.hotel_lng != null
      ? { lat: trip.hotel_lat, lng: trip.hotel_lng } : null),
    [trip.hotel_lat, trip.hotel_lng],
  );

  // Live geolocation — when granted, the decision engine for "Alternatives"
  // gets a real currentLocation instead of null, so suggestions favour what's
  // actually near the user right now (not just the hotel).
  const geo = useGeoLocation();
  const userLocation = useMemo(
    () => (geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng } : null),
    [geo.coords],
  );

  // ── Day selection: default to today if in range, else first day ──────────
  const todayIdx = days.findIndex((d) => d.day_date === todayDateString());
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(
    todayIdx >= 0 ? todayIdx : 0,
  );
  const selectedDay = days[selectedDayIdx] ?? null;

  // ── Handle ?add=PLACE_ID coming from PlaceCard "+ خطتي" button ───────────
  // Opens the AddToPlanSheet primed for the currently-selected day, with a
  // banner offering to drop the carried-in place into any phase.
  const addPlaceId = search.get("add");
  const carriedPlace = useMemo(
    () => (addPlaceId ? catalogue.find((p) => p.id === addPlaceId) ?? null : null),
    [addPlaceId, catalogue],
  );

  // ── Items for selected day, grouped by slot ──────────────────────────────
  const dayItems = useMemo(
    () => items.filter((it) => it.day_id === selectedDay?.id),
    [items, selectedDay],
  );
  const itemsBySlot = useMemo(() => {
    const map = new Map<Slot, ItemWithPlace[]>();
    for (const it of dayItems) {
      const arr = map.get(it.slot) ?? [];
      arr.push(it);
      map.set(it.slot, arr);
    }
    return map;
  }, [dayItems]);

  // ── For each phase: placed item + alternatives ───────────────────────────
  type PhaseSlot = {
    phase: PhaseDef;
    placed: ItemWithPlace[];          // ALL items in this phase (was: single)
    alternatives: Place[];
  };
  const phaseSlots = useMemo<PhaseSlot[]>(() => {
    const now = new Date();
    const usedIds = new Set(items.map((it) => it.place_id)); // exclude across all days
    return PHASES.map((phase) => {
      const placed: ItemWithPlace[] = [];
      for (const s of phase.slots) {
        const arr = itemsBySlot.get(s);
        if (arr && arr.length > 0) placed.push(...arr);
      }
      const candidates = catalogue.filter(
        (p) => !usedIds.has(p.id) && phase.preferredCategory?.includes(p.category),
      );
      const ranked = candidates
        .map((p) => ({
          p,
          conf: decide(p, { now, currentLocation: userLocation, hotelLocation, preferenceMode: null }).confidence,
        }))
        .sort((a, b) => b.conf - a.conf)
        .slice(0, 6)
        .map((x) => x.p);
      return { phase, placed, alternatives: ranked };
    });
  }, [itemsBySlot, items, catalogue, hotelLocation, userLocation]);

  // ── Anchor for hop distance — uses LAST item of previous phase ──────────
  function prevAnchor(idx: number): { lat: number; lng: number; name: string } | null {
    for (let i = idx - 1; i >= 0; i--) {
      const ps = phaseSlots[i];
      const last = ps.placed[ps.placed.length - 1]?.places;
      if (last && last.lat != null && last.lng != null) {
        return { lat: last.lat, lng: last.lng, name: last.name };
      }
    }
    if (hotelLocation) return { lat: hotelLocation.lat, lng: hotelLocation.lng, name: trip.hotel_name ?? "الفندق" };
    return null;
  }

  // ── Day-level cost rollup ────────────────────────────────────────────────
  const dayCostSar = useMemo(() => {
    const rates = (trip.rates ?? {}) as Partial<Record<string, number>>;
    let total = 0;
    for (const it of dayItems) {
      const c = it.places.cost_estimate ?? 0;
      if (c <= 0) continue;
      const rate = (rates[it.places.cost_currency] as number | undefined) ?? 1;
      total += c * rate;
    }
    return total;
  }, [dayItems, trip.rates]);

  // Wishlist places (saved but not yet on any day's itinerary)
  const wishlistPlaces = useMemo(() => {
    if (savedSet.size === 0) return [] as Place[];
    const scheduledIds = new Set(items.map((it) => it.place_id));
    return catalogue.filter((p) => savedSet.has(p.id) && !scheduledIds.has(p.id));
  }, [savedSet, items, catalogue]);
  const [wishlistOpen, setWishlistOpen] = useState(false);

  // Smart Fill sheet — opens with proposed picks for confirmation
  const [smartFillScope, setSmartFillScope] = useState<"day" | "trip" | null>(null);
  // Day-options dropdown menu (smart fill + clear)
  const [dayMenuOpen, setDayMenuOpen] = useState(false);

  // Day balance — count empty phases for the Smart Plan button
  const emptyPhases = useMemo(() => {
    if (!selectedDay) return [];
    return phaseSlots.filter((ps) => ps.placed.length === 0).map((ps) => ps.phase);
  }, [phaseSlots, selectedDay]);

  // Smart fill input — passed to the sheet when it opens
  const fillInput = useMemo(() => ({
    days,
    items,
    catalogue,
    savedSet,
    userRatings,
    hotelLocation,
    targetDayId: smartFillScope === "day" ? selectedDay?.id : undefined,
  }), [days, items, catalogue, savedSet, userRatings, hotelLocation, smartFillScope, selectedDay]);

  // Clear: per-day or whole-trip. Both use the same API endpoint.
  async function clearItems(scope: "day" | "trip") {
    if (busy) return;
    const label = scope === "day"
      ? `كل أماكن ${selectedDay ? fmtDayLong(selectedDay.day_date) : "هذا اليوم"}`
      : "كل أماكن الرحلة";
    // In-app confirm — uses the same browser API for now (still native), but
    // wrapped in a clearer single-prompt phrasing. Replacing both with inline
    // red-button reveals is a follow-up.
    if (!window.confirm(`⚠️ متأكد تبي تحذف ${label}؟ ما يمكن استرجاعها.`)) return;
    if (scope === "trip") {
      if (!window.confirm("⚠️ هذي عملية كبيرة — احذف فعلاً كل أماكن الرحلة كلها؟")) return;
    }
    setBusy("clear");
    try {
      const body = scope === "day" && selectedDay ? { day_date: selectedDay.day_date } : {};
      const r = await fetch(`/api/trips/${trip.id}/itinerary/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        showToast("⚠️ تعذّر الحذف — جرّب مرة ثانية", "info");
        return;
      }
      const n = (data?.deleted ?? 0) as number;
      showToast(n > 0 ? `🗑 حُذف ${n} مكان من الخطة` : "كان فاضي أصلاً", "info");
    } catch {
      showToast("⚠️ مشكلة في الاتصال", "info");
    } finally {
      setBusy(null);
      setDayMenuOpen(false);
      startTx(() => router.refresh());
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  async function addPlaceToSlot(place: Place, phase: PhaseDef) {
    if (!selectedDay || busy) return;
    setBusy(`add-${phase.key}`);
    try {
      const r = await fetch(`/api/trips/${trip.id}/itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day_date: selectedDay.day_date,
          place_id: place.id,
          slot: phase.slots[0],
        }),
      });
      if (r.ok) {
        showToast(`✓ ${place.name} أُضيف لـ ${phase.emoji} ${phase.ar} (${fmtDayLong(selectedDay.day_date)})`);
      } else {
        // Surface the API's actual error (e.g., "الفترة ممتلئة — 3 أماكن
        // كحد أقصى") so the user knows WHY instead of a generic toast.
        const data = await r.json().catch(() => ({} as { error?: string }));
        const msg = (data as { error?: string }).error;
        console.warn("add failed:", msg);
        showToast(msg ? `⚠️ ${msg}` : "⚠️ تعذّرت الإضافة — جرّب مرة ثانية", "info");
      }
    } finally {
      setBusy(null);
      setActiveAddPhase(null);
      if (carriedPlace) router.replace(embedded ? `/trips/${trip.id}` : `/trips/${trip.id}/plan`);
      startTx(() => router.refresh());
    }
  }

  // Add directly from Google: creates the place in our catalog (if new) and
  // assigns it to the phase in one flow.
  async function addGoogleResultToSlot(googlePlaceId: string, phase: PhaseDef) {
    if (!selectedDay || busy) return;
    setBusy(`google-${phase.key}`);
    try {
      // 1. Add to places catalog via Google
      const addResp = await fetch("/api/places/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          google_place_id: googlePlaceId,
          city: trip.destination_city ?? "",
          city_label: trip.destination_city ?? "",
        }),
      });
      const addData = await addResp.json();
      const placeId = addData?.place?.id as string | undefined;
      const placeName = addData?.place?.name as string | undefined;
      if (!placeId) {
        console.warn("Google add failed:", addData?.error);
        showToast("⚠️ تعذّر جلب التفاصيل من Google", "info");
        return;
      }
      // 2. Add to itinerary
      const planResp = await fetch(`/api/trips/${trip.id}/itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day_date: selectedDay.day_date,
          place_id: placeId,
          slot: phase.slots[0],
        }),
      });
      if (planResp.ok) {
        showToast(`✓ ${placeName ?? "المكان"} أُضيف لـ ${phase.emoji} ${phase.ar} (${fmtDayLong(selectedDay.day_date)})`);
      } else {
        const data = await planResp.json().catch(() => ({} as { error?: string }));
        const msg = (data as { error?: string }).error;
        console.warn("itinerary add failed:", msg);
        showToast(msg ? `⚠️ ${msg}` : "⚠️ تعذّرت الإضافة للخطة", "info");
      }
    } finally {
      setBusy(null);
      setActiveAddPhase(null);
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
      if (!r.ok) {
        console.warn("swap failed:", await r.text().catch(() => ""));
        showToast("⚠️ تعذّر الاستبدال", "info");
      }
    } finally {
      setBusy(null);
      startTx(() => router.refresh());
    }
  }

  // Smart Plan uses SmartFillSheet — opening the sheet computes the proposed
  // picks. The user reviews + swaps + skips before committing.
  function openSmartFill(scope: "day" | "trip") {
    setSmartFillScope(scope);
    setDayMenuOpen(false);
  }

  // Move a planned item to a different (day, phase) without losing it.
  async function moveItem(item: ItemWithPlace, target: { day_date?: string; slot?: string }) {
    if (busy) return;
    if (!target.day_date && !target.slot) return;
    setBusy(item.id);
    try {
      const r = await fetch(`/api/trips/${trip.id}/itinerary/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        console.warn("move failed:", detail);
        showToast("⚠️ تعذّر النقل — جرّب مرة ثانية", "info");
        return;
      }
      const where = target.day_date && target.slot ? "ليوم وفترة جديدة"
        : target.day_date ? "ليوم آخر"
        : "لفترة ثانية";
      showToast(`✓ ${item.places.name} نُقل ${where}`);
    } catch {
      showToast("⚠️ مشكلة في الاتصال", "info");
    } finally {
      setBusy(null);
      startTx(() => router.refresh());
    }
  }

  async function removeItem(item: ItemWithPlace) {
    if (busy) return;
    if (!confirm(`حذف ${item.places.name} من ${PHASES.find((p) => p.slots.includes(item.slot))?.ar ?? item.slot}؟`)) return;
    setBusy(item.id);
    try {
      const r = await fetch(`/api/trips/${trip.id}/itinerary/${item.id}`, { method: "DELETE" });
      if (!r.ok) {
        console.warn("delete failed:", await r.text().catch(() => ""));
        showToast("⚠️ تعذّر الحذف — جرّب مرة ثانية", "info");
      }
    } catch {
      showToast("⚠️ مشكلة في الاتصال", "info");
    } finally {
      setBusy(null);
      startTx(() => router.refresh());
    }
  }

  // Auto-open AddToPlanSheet primed for the carried place's natural phase
  useEffect(() => {
    if (!carriedPlace) return;
    // Find phase whose preferredCategory matches the place's category
    const phase = PHASES.find((p) => p.preferredCategory?.includes(carriedPlace.category)) ?? PHASES[2];
    setActiveAddPhase(phase);
  }, [carriedPlace]);

  const hotelHref = hotelLocation
    ? `https://www.google.com/maps/dir/?api=1&destination=${hotelLocation.lat},${hotelLocation.lng}`
    : null;

  // ─── Render ────────────────────────────────────────────────────────────

  if (!days || days.length === 0) {
    const emptyBody = (
      <div className="bg-card border border-line rounded-2xl p-6 text-center">
        <p className="text-muted text-sm mb-3">
          حدّد تاريخ بداية ونهاية للرحلة لتُنشَأ الأيام تلقائياً.
        </p>
        <Link
          href={`/trips/${trip.id}/settings`}
          className="inline-block bg-coral text-white font-bold px-5 py-2.5 rounded-xl"
        >
          ⚙ تعديل الرحلة
        </Link>
      </div>
    );
    if (embedded) return emptyBody;
    return (
      <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
        <Link href={`/trips/${trip.id}`} className="text-sea text-sm font-bold mb-3 inline-block">
          ← {trip.name}
        </Link>
        {emptyBody}
      </main>
    );
  }

  const planBody = (
    <>
      {/* Toast — floating success message */}
      {toast && (
        <div role="status" aria-live="polite" style={{ top: "calc(env(safe-area-inset-top, 0px) + 16px)" }} className={`fixed inset-x-4 z-[80] max-w-2xl mx-auto rounded-2xl shadow-lg px-4 py-3 text-[13px] font-bold border-2 animate-in slide-in-from-top-4 duration-200 ${
          toast.tone === "success"
            ? "bg-emerald-500 text-white border-emerald-400"
            : "bg-amber-500 text-white border-amber-400"
        }`}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex-1">{toast.text}</span>
            <button onClick={() => setToast(null)} className="text-white/80 text-base">✕</button>
          </div>
        </div>
      )}

      {/* Header (skipped when embedded — TripScreen provides it) */}
      {!embedded && (
        <header className="bg-gradient-to-br from-sea via-sea-600 to-sea-700 text-white rounded-2xl p-4 shadow-lg mb-3">
          <h1 className="font-serif font-extrabold text-2xl">📋 خطة الرحلة</h1>
          <div className="text-[12px] opacity-90 mt-0.5">
            {trip.destination_city ?? "—"} · {days.length} أيام
          </div>
        </header>
      )}

      {/* Day tabs — scrollable */}
      <div className="mb-3 -mx-1">
        <div className="flex gap-1.5 overflow-x-auto pb-1.5 px-1">
          {days.map((d, idx) => {
            const isSelected = idx === selectedDayIdx;
            const isToday = d.day_date === todayDateString();
            return (
              <button
                key={d.id}
                onClick={() => setSelectedDayIdx(idx)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-center transition active:scale-95 border-2 min-w-[64px] ${
                  isSelected
                    ? "bg-sea text-white border-sea shadow"
                    : "bg-white text-ink border-line hover:border-sea"
                }`}
              >
                <div className="text-[9.5px] font-bold opacity-80 leading-none">
                  {arabicDayShort(d.day_date)}
                </div>
                <div className="font-serif font-extrabold text-base leading-tight mt-0.5">
                  {dayNumber(d.day_date)}
                </div>
                <div className="text-[9px] opacity-80 leading-none">
                  يوم {idx + 1}
                </div>
                {isToday && (
                  <div className={`text-[8px] font-bold mt-0.5 px-1 rounded-pill ${isSelected ? "bg-white/25" : "bg-emerald-500 text-white"}`}>
                    اليوم
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected-day summary strip — single source of truth for the day */}
      {selectedDay && (
        <div className="bg-white border border-stone-200 rounded-2xl px-3 py-2 mb-2 flex items-center justify-between text-[12px]">
          <span className="font-bold text-stone-700">{fmtDayLong(selectedDay.day_date)}</span>
          <span className="text-stone-500 flex items-center gap-2">
            <span><b className="text-ink">{dayItems.length}</b> مكان</span>
            <span className="text-stone-300">·</span>
            <span>
              <b className={emptyPhases.length > 0 ? "text-amber-700" : "text-emerald-700"}>
                {emptyPhases.length}
              </b> فارغ
            </span>
            {dayCostSar > 0 && (
              <>
                <span className="text-stone-300">·</span>
                <span className="font-bold text-stone-700">{fmtMoneySAR(dayCostSar)}</span>
              </>
            )}
          </span>
        </div>
      )}

      {/* Action row — Smart Fill + Wishlist + ⋯ options */}
      {selectedDay && (
        <div className="flex gap-1.5 mb-2 items-stretch">
          {emptyPhases.length >= 1 && (
            <button
              onClick={() => openSmartFill("day")}
              disabled={busy != null}
              className="flex-1 bg-white border border-stone-200 hover:border-coral rounded-2xl px-3 py-2 flex items-center justify-between active:scale-[.99] transition disabled:opacity-50"
            >
              <span className="font-extrabold text-[12px] text-stone-800">
                ✨ خطة ذكية
              </span>
              <span className="text-[10px] text-stone-500">{emptyPhases.length} فترة فارغة</span>
            </button>
          )}
          {wishlistPlaces.length > 0 && (
            <button
              onClick={() => setWishlistOpen((v) => !v)}
              className="flex-1 bg-white border border-stone-200 hover:border-coral rounded-2xl px-3 py-2 flex items-center justify-between active:scale-[.99] transition"
            >
              <span className="font-extrabold text-[12px] text-stone-800">
                💝 محفوظات
              </span>
              <span className="text-[10px] text-stone-500">{wishlistPlaces.length} مكان</span>
            </button>
          )}
          {/* Options ⋯ — always visible */}
          <div className="relative">
            <button
              onClick={() => setDayMenuOpen((v) => !v)}
              aria-label="خيارات اليوم"
              aria-expanded={dayMenuOpen}
              aria-haspopup="menu"
              className={`h-full px-3 bg-white border rounded-2xl active:scale-95 transition text-[16px] font-bold ${
                dayMenuOpen ? "border-coral text-coral" : "border-stone-200 text-stone-700 hover:border-stone-400"
              }`}
            >
              ⋯
            </button>
            {dayMenuOpen && (
              <>
                {/* Click-outside backdrop */}
                <div className="fixed inset-0 z-20" onClick={() => setDayMenuOpen(false)} />
                <div
                  role="menu"
                  className="absolute top-full end-0 mt-1 w-56 bg-white border border-stone-200 rounded-2xl shadow-xl z-30 overflow-hidden"
                >
                  <MenuItem onClick={() => openSmartFill("day")} disabled={emptyPhases.length === 0}>
                    ✨ <span>خطة ذكية لهذا اليوم</span>
                    {emptyPhases.length === 0 && <span className="text-[10px] text-stone-500 ms-auto">ممتلئ</span>}
                  </MenuItem>
                  <MenuItem onClick={() => openSmartFill("trip")}>
                    🌟 <span>خطة ذكية لكل الرحلة</span>
                  </MenuItem>
                  <div className="border-t border-stone-100" />
                  <MenuItem onClick={() => clearItems("day")} disabled={dayItems.length === 0} danger>
                    🗑 <span>حذف كل أماكن اليوم</span>
                  </MenuItem>
                  <MenuItem onClick={() => clearItems("trip")} disabled={items.length === 0} danger>
                    🗑 <span>حذف كل أماكن الرحلة</span>
                  </MenuItem>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Wishlist expanded tray (separate so its chips don't bloat the row) */}
      {wishlistOpen && wishlistPlaces.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl px-3 py-2 mb-2 max-h-72 overflow-y-auto space-y-2">
          <div className="flex items-center justify-between text-[11px] text-stone-500 -mt-0.5 mb-1">
            <span>اضغط فترة لكل مكان لتوزيع المحفوظات على اليوم المحدّد</span>
            <button onClick={() => setWishlistOpen(false)} className="text-stone-400 text-[14px]">✕</button>
          </div>
          {wishlistPlaces.map((p) => (
            <div key={p.id} className="border border-stone-100 rounded-xl px-2 py-1.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base">{CAT_EMOJI[p.category] ?? "📍"}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[12px] line-clamp-1">{p.name}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {PHASES.map((ph) => (
                  <button
                    key={ph.key}
                    onClick={() => addPlaceToSlot(p, ph)}
                    disabled={busy != null}
                    className="text-[10.5px] font-bold bg-stone-50 border border-stone-200 text-stone-800 px-2 py-0.5 rounded-pill hover:border-coral active:bg-coral active:text-white disabled:opacity-50"
                    title={`${ph.ar} · ${ph.timeAr}`}
                  >
                    {ph.emoji} {ph.ar}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Carried-place banner (from PlaceCard "+ خطتي") */}
      {carriedPlace && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 mb-3">
          <div className="flex items-start gap-2.5">
            <span className="text-2xl">＋</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-amber-700 font-bold mb-0.5">إضافة سريعة</div>
              <div className="font-serif font-extrabold text-[14px] line-clamp-1">{carriedPlace.name}</div>
              <p className="text-[11px] text-amber-900/80 mt-1">
                اختر المرحلة من الزر أدناه أو من اللائحة:
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PHASES.map((phase) => (
                  <button
                    key={phase.key}
                    onClick={() => addPlaceToSlot(carriedPlace, phase)}
                    disabled={busy != null}
                    className="bg-white border border-amber-300 text-amber-900 text-[11px] font-bold px-2.5 py-1 rounded-pill active:bg-amber-100 disabled:opacity-50"
                  >
                    {phase.emoji} {phase.ar}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => router.replace(`/trips/${trip.id}/plan`)}
              aria-label="إلغاء"
              className="w-7 h-7 rounded-full bg-white text-amber-900 font-bold border border-amber-300"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Empty-day banner — shown when no phase has any item */}
      {phaseSlots.every((ps) => ps.placed.length === 0) && (
        <div className="mt-3 rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-center">
          <div className="text-3xl mb-1">🗓️</div>
          <p className="font-serif font-extrabold text-[14px] text-ink">يوم فاضي</p>
          <p className="text-[12px] text-stone-600 mt-1">
            استخدم <strong>التعبئة الذكية</strong> من القائمة أو أضف من <strong>اكتشف</strong>.
          </p>
          <button
            onClick={() => setSmartFillScope("day")}
            className="mt-3 inline-flex items-center gap-1.5 bg-emerald-600 text-white text-[12px] font-bold px-3.5 py-2 rounded-pill active:bg-emerald-700"
          >
            ✨ تعبئة ذكية لهذا اليوم
          </button>
        </div>
      )}

      {/* Day timeline — new bucket+card+bridge layout */}
      <DayTimeline
        phaseSlots={phaseSlots}
        hotelLocation={hotelLocation}
        hotelName={trip.hotel_name ?? "الفندق"}
        busy={busy}
        allDays={days}
        selectedDayId={selectedDay?.id ?? null}
        prevAnchorOf={prevAnchor}
        onOpenAdd={(phase) => setActiveAddPhase(phase)}
        onAddPlace={(p, phase) => addPlaceToSlot(p, phase)}
        onSwap={(item, alt) => swapItem(item, alt)}
        onRemove={(item) => removeItem(item)}
        onMove={(item, target) => moveItem(item, target)}
      />

      {/* Return to hotel — compact, end of day */}
      {hotelHref && (
        <a
          href={hotelHref}
          target="_blank"
          rel="noopener"
          className="block mt-4 bg-stone-100 hover:bg-stone-200 text-stone-900 text-center font-bold text-[13px] py-2.5 rounded-2xl active:scale-[.99] transition"
        >
          🏨 خذني للفندق ←
        </a>
      )}

      {/* Smart Fill preview sheet */}
      <SmartFillSheet
        open={smartFillScope != null}
        onClose={() => setSmartFillScope(null)}
        tripId={trip.id}
        scope={smartFillScope ?? "day"}
        fillInput={fillInput}
        onCommitted={(count) => showToast(`✨ أُضيف ${count} مكان للخطة`)}
      />

      <AddToPlanSheet
        open={activeAddPhase != null && !carriedPlace}
        phase={activeAddPhase}
        catalogue={catalogue}
        usedPlaceIds={new Set(items.map((it) => it.place_id))}
        hotelLocation={hotelLocation}
        tripId={trip.id}
        cityKey={trip.destination_city ?? ""}
        cityLabel={trip.destination_city ?? ""}
        savedSet={savedSet}
        isBusy={busy != null}
        onClose={() => setActiveAddPhase(null)}
        onAdd={async (p) => {
          if (activeAddPhase) await addPlaceToSlot(p, activeAddPhase);
        }}
        onAddFromGoogle={async (googleId) => {
          if (activeAddPhase) await addGoogleResultToSlot(googleId, activeAddPhase);
        }}
      />
    </>
  );

  if (embedded) return planBody;
  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-5">
      <Link href={`/trips/${trip.id}`} className="text-sea text-sm font-bold inline-block mb-3">
        ← {trip.name}
      </Link>
      {planBody}
    </main>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PlacedRow({
  place, alternatives, busy,
  hotelLocation, hotelName,
  onSkip, onSwap, onOpenMore,
}: {
  place: Place;
  alternatives: Place[];
  busy: boolean;
  hotelLocation: { lat: number; lng: number } | null;
  hotelName: string;
  onSkip: () => void;
  onSwap: (alt: Place) => void;
  onOpenMore: () => void;
}) {
  const [altsOpen, setAltsOpen] = useState(false);
  void hotelName;

  const dirHref = place.lat != null && place.lng != null ? buildDirectionsUrl(place) : null;
  const cat = getCategoryDisplay(place.category);
  const kind = getKindDisplay(place.kind);
  const score = instantScore({ rating: place.rating, reviewCount: place.review_count });
  const verdict = scoreVerdict(score, place.category);

  // Distance from hotel as a SHORT label
  let hotelDist: { short: string; tone: "good"|"neut"|"warn" } | null = null;
  if (hotelLocation && place.lat != null && place.lng != null) {
    const km = haversineKm(hotelLocation, { lat: place.lat, lng: place.lng });
    const t = estimateTravelTimes(km);
    const walk = km < 2;
    hotelDist = {
      short: `🏨 ${walk ? `${fmtMins(t.walkMin)} مشي` : `${fmtMins(t.driveMin)} سيارة`}`,
      tone: km <= 3 ? "good" : km <= 10 ? "neut" : "warn",
    };
  }

  const reviewsShort = place.review_count
    ? place.review_count >= 1000
      ? `${(place.review_count / 1000).toFixed(1)}k`
      : String(place.review_count)
    : null;

  // Cost — short version
  let costShort: string | null = null;
  if (place.cost_estimate != null && place.cost_estimate > 0) {
    costShort = place.cost_currency === "SAR"
      ? `${Math.round(place.cost_estimate)} ر.س`
      : `${Math.round(place.cost_estimate)} ${place.cost_currency}`;
  } else if (place.cost_estimate === 0) {
    costShort = "مجاني";
  }

  // GUARANTEED summary — curated first, generated as fallback (never empty)
  const summary =
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

  return (
    <div className="p-3">
      {/* ─── Top: photo + name + type + score ─── */}
      <div className="flex gap-3">
        <div className={`w-16 h-16 rounded-xl shrink-0 overflow-hidden grid place-items-center text-2xl ${
          place.photo_url ? "bg-stone-200" : `bg-gradient-to-br from-stone-100 to-stone-200`
        }`}>
          {place.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoAtWidth(place.photo_url, 320) ?? undefined} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            cat.emoji
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-serif font-extrabold text-[15px] leading-tight line-clamp-2">
            {place.name}
          </h3>
          <div className="text-[11px] text-muted mt-0.5">
            <span className="font-bold text-ink">{cat.emoji} {cat.ar}</span>
            {kind && <span> · {kind.ar}</span>}
          </div>
        </div>
      </div>

      {/* ─── Verdict badge — tells the user instantly: "good or bad?" ─── */}
      <div className={`mt-2.5 ${verdict.gradientBg} ${verdict.textColor} rounded-full shadow-sm inline-flex items-center gap-2 px-3 py-1`}>
        <span className="font-extrabold text-[12px] leading-none">{verdict.ar}</span>
        <span className="opacity-50 text-[10px]">·</span>
        <span className="font-bold text-[11px] leading-none">{score}</span>
      </div>

      {/* ─── Summary line (ALWAYS shown) ─── */}
      <p className="text-[12px] text-ink/85 mt-2 leading-relaxed line-clamp-2">
        {summaryIcon} {summary}
      </p>

      {/* ─── Facts strip: rating · distance · cost ─── */}
      <div className="mt-2 flex items-center gap-x-2 gap-y-1 text-[11.5px] flex-wrap">
        {place.rating != null && (
          <span className="font-bold text-amber-700">
            ⭐ {place.rating.toFixed(1)}
            {reviewsShort && <span className="text-muted font-normal"> ({reviewsShort})</span>}
          </span>
        )}
        {hotelDist && (
          <>
            <span className="text-line">·</span>
            <span className={`font-bold ${
              hotelDist.tone === "good" ? "text-ok" :
              hotelDist.tone === "neut" ? "text-ink" :
              "text-orange-700"
            }`}>
              {hotelDist.short}
            </span>
          </>
        )}
        {costShort && (
          <>
            <span className="text-line">·</span>
            <span className="font-extrabold text-ink">💰 {costShort}</span>
          </>
        )}
      </div>

      {/* ─── Actions: open map · swap · delete (clearer labels) ─── */}
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {dirHref ? (
          <a
            href={dirHref}
            target="_blank"
            rel="noopener"
            className="bg-coral text-white text-center font-extrabold text-[12px] py-2.5 rounded-xl shadow-sm active:scale-[0.97] transition"
            title="افتح في Google Maps"
          >
            🗺 افتح الخريطة
          </a>
        ) : (
          <button disabled className="bg-stone-200 text-stone-500 font-bold text-[12px] py-2.5 rounded-xl">
            🗺 —
          </button>
        )}
        <button
          onClick={() => {
            if (alternatives.length > 0) setAltsOpen((v) => !v);
            else onOpenMore();
          }}
          disabled={busy}
          className="bg-sea text-white font-extrabold text-[12px] py-2.5 rounded-xl shadow-sm active:scale-[0.97] transition disabled:opacity-50"
        >
          🔁 بديل{alternatives.length > 0 ? ` (${alternatives.length})` : ""}
        </button>
        <button
          onClick={onSkip}
          disabled={busy}
          className="bg-white border border-rose-200 text-rose-600 font-extrabold text-[12px] py-2.5 rounded-xl active:bg-rose-50 transition disabled:opacity-40"
          title="حذف من الخطة"
        >
          ✕ حذف
        </button>
      </div>

      {/* ─── Alternatives panel (collapsed by default) ─── */}
      {altsOpen && alternatives.length > 0 && (
        <div className="mt-3 bg-sea/5 border border-sky-200 rounded-xl p-2 space-y-1.5">
          <div className="flex items-center justify-between px-1 mb-0.5">
            <span className="text-[11px] font-bold text-sea">اختر بديل:</span>
            <button onClick={onOpenMore} className="text-[10.5px] font-bold text-sea">المزيد ←</button>
          </div>
          {alternatives.slice(0, 3).map((alt) => {
            const altCat = getCategoryDisplay(alt.category);
            const altScore = instantScore({ rating: alt.rating, reviewCount: alt.review_count });
            const altVerdict = scoreVerdict(altScore, alt.category);
            let altHop: { mode: "walk"|"drive"; min: number; km: number } | null = null;
            if (hotelLocation && alt.lat != null && alt.lng != null) {
              const km = haversineKm(hotelLocation, { lat: alt.lat, lng: alt.lng });
              const tt = estimateTravelTimes(km);
              altHop = { mode: km < 2 ? "walk" : "drive", min: km < 2 ? tt.walkMin : tt.driveMin, km };
            }
            return (
              <button
                key={alt.id}
                onClick={() => { setAltsOpen(false); onSwap(alt); }}
                disabled={busy}
                className="w-full text-right bg-white border border-line rounded-xl p-2 flex items-center gap-2 disabled:opacity-50 active:bg-sea/5 transition"
              >
                <div className={`w-12 h-12 rounded-lg overflow-hidden grid place-items-center shrink-0 ${
                  alt.photo_url ? "bg-stone-200" : "bg-stone-100"
                }`}>
                  {alt.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoAtWidth(alt.photo_url, 96) ?? undefined} alt={alt.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <span className="text-lg">{altCat.emoji}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[12.5px] text-ink line-clamp-1">{alt.name}</div>
                  <div className={`mt-0.5 inline-flex items-center gap-1 ${altVerdict.gradientBg} ${altVerdict.textColor} text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-full`}>
                    {altVerdict.ar} · {altScore}
                  </div>
                  <div className="text-[10.5px] text-muted flex items-center gap-x-1.5 flex-wrap mt-0.5">
                    {alt.rating != null && <span>⭐ {alt.rating.toFixed(1)}</span>}
                    {altHop && (
                      <span>· {altHop.mode === "walk" ? "🚶" : "🚗"} {fmtMins(altHop.min)}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyRow({
  phase, topAlternatives, onPick, onOpenAddSheet, busy,
}: {
  phase: PhaseDef;
  topAlternatives: Place[];
  onPick: (p: Place) => void;
  onOpenAddSheet: () => void;
  busy: boolean;
}) {
  return (
    <div className="p-3 space-y-2">
      {topAlternatives.length === 0 ? (
        <button
          onClick={onOpenAddSheet}
          disabled={busy}
          className="w-full bg-gradient-to-br from-sea to-sea-600 text-white font-bold text-sm py-3 rounded-xl shadow disabled:opacity-50"
        >
          ＋ أضف لـ {phase.emoji} {phase.ar}
        </button>
      ) : (
        <>
          <p className="text-[11.5px] text-muted text-center">
            ما اخترت بعد. مقترحات سريعة:
          </p>
          {topAlternatives.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              disabled={busy}
              className="w-full text-right bg-white border border-line rounded-xl px-3 py-2 flex items-center gap-2 disabled:opacity-50 active:bg-stone-50"
            >
              <span className="text-lg">{CAT_EMOJI[p.category] ?? "✦"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-bold text-ink line-clamp-1">{p.name}</div>
                <div className="text-[10.5px] text-muted">
                  {p.rating != null && <>★ {p.rating.toFixed(1)} · </>}
                  {p.city_label && <>📍 {p.city_label} · </>}
                  {p.kind ?? p.category}
                </div>
              </div>
              <span className="bg-coral text-white text-[10.5px] font-bold px-2 py-1 rounded-pill">＋ أضف</span>
            </button>
          ))}
          <button
            onClick={onOpenAddSheet}
            disabled={busy}
            className="w-full bg-white border border-dashed border-sea text-sea font-bold text-xs py-2.5 rounded-xl active:bg-sky-50 disabled:opacity-50"
          >
            🔍 المزيد من الكتالوج
          </button>
        </>
      )}
    </div>
  );
}
