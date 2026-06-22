"use client";

// QuickAddPicker — the inline "where do you want it?" panel that opens
// underneath the place card when the user taps "أضف للخطة".
// Aim: zero-navigation add. One tap puts the place into a specific
// (day, phase) slot. The full AddToPlanSheet remains as fallback.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ItineraryDay, ItineraryItem, Place } from "@/lib/supabase/database.types";
import { suggestSlotsFor, type SlotSuggestion } from "@/lib/plan/suggestSlots";

type Status =
  | { kind: "idle" }
  | { kind: "saving"; key: string }
  | { kind: "success"; label: string }
  | { kind: "error"; message: string };

export default function QuickAddPicker({
  place,
  tripId,
  days,
  items,
  saved,
  onSaveToggle,
  onChooseAnother,
  onClose,
  onAdded,
}: {
  place: Place;
  tripId: string;
  days: ItineraryDay[];
  items: ItineraryItem[];
  saved: boolean;
  /** Called when the heart is toggled — for parent's optimistic state */
  onSaveToggle: () => void;
  /** Called when the user wants the full AddToPlanSheet (any day/slot) */
  onChooseAnother: () => void;
  onClose: () => void;
  /** Bubble up the success so the parent can show a page-level snackbar */
  onAdded?: (info: { placeName: string; dayLabel: string; phaseLabel: string; phaseEmoji: string }) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const suggestions = suggestSlotsFor(place, days, items, { limit: 3 });

  // Where THIS place is already scheduled — surfaced as a heads-up at the top
  // of the picker so the user sees it before tapping any slot.
  const existingPlacements = items
    .filter((it) => it.place_id === place.id)
    .map((it) => {
      const dayIdx = days.findIndex((d) => d.id === it.day_id);
      const slotMeta: Record<string, { emoji: string; ar: string }> = {
        morning:   { emoji: "🌅", ar: "الصباح" },
        midday:    { emoji: "🍽", ar: "الغداء" },
        afternoon: { emoji: "🌆", ar: "بعد الظهر" },
        evening:   { emoji: "🌙", ar: "العشاء" },
        night:     { emoji: "🌃", ar: "آخر اليوم" },
      };
      const m = slotMeta[it.slot] ?? { emoji: "📍", ar: it.slot };
      return { id: it.id, dayLabel: dayIdx >= 0 ? `يوم ${dayIdx + 1}` : "اليوم", phaseEmoji: m.emoji, phaseAr: m.ar };
    });

  async function addToSlot(s: SlotSuggestion) {
    setStatus({ kind: "saving", key: s.day.id + s.phase.key });
    try {
      const r = await fetch(`/api/trips/${tripId}/itinerary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day_date: s.day.day_date,
          place_id: place.id,
          slot: s.phase.slots[0],
        }),
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        setStatus({ kind: "error", message: detail || "تعذّرت الإضافة" });
        return;
      }
      setStatus({ kind: "success", label: s.label });
      onAdded?.({
        placeName: place.name,
        dayLabel: s.label.split("·")[0]?.trim() ?? s.label,
        phaseLabel: s.phase.ar,
        phaseEmoji: s.phase.emoji,
      });
      router.refresh();
      // Slightly longer so the user can read the inline confirm before it closes
      setTimeout(() => onClose(), 1600);
    } catch {
      setStatus({ kind: "error", message: "مشكلة في الاتصال" });
    }
  }

  return (
    <div className="bg-sky-50/70 border-t border-sky-200 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-200">
      {/* Success state replaces the chooser entirely for clarity */}
      {status.kind === "success" ? (
        <div className="text-center py-2">
          <div className="text-2xl mb-1">✓</div>
          <p className="text-[13px] font-bold text-emerald-700">{status.label}</p>
          <p className="text-[11px] text-stone-500 mt-0.5">أُضيف للخطة</p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[12px] font-bold text-sky-900">متى تبيها؟</p>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="text-stone-400 hover:text-stone-600 text-[14px] leading-none"
            >
              ✕
            </button>
          </div>

          {/* Top heads-up: this place is already on the plan elsewhere */}
          {existingPlacements.length > 0 && (
            <div className="mb-2 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5 text-[11px] text-amber-900 leading-snug">
              <span className="font-bold">💡 موجود بالفعل في:</span>{" "}
              {existingPlacements.map((e, i) => (
                <span key={e.id}>
                  {i > 0 && <span className="text-amber-500"> · </span>}
                  <b>{e.dayLabel}</b> {e.phaseEmoji} {e.phaseAr}
                </span>
              ))}
              <div className="text-amber-700/80 mt-0.5">
                تقدر تضيفه مرة ثانية في وقت آخر — ما في مشكلة.
              </div>
            </div>
          )}

          {days.length === 0 ? (
            <div className="text-[11.5px] text-stone-600 py-2 space-y-2">
              <p>✨ ما عندك أيام رحلة بعد. حدّد تواريخ الرحلة أولاً.</p>
              <a
                href={`/trips/${tripId}/settings`}
                className="inline-block bg-coral text-white font-bold text-[11.5px] px-3 py-2 rounded-pill active:scale-95"
              >
                ⚙ افتح إعدادات الرحلة ←
              </a>
            </div>
          ) : suggestions.length === 0 ? (
            <p className="text-[11.5px] text-stone-600 py-2">
              ما عندي اقتراحات ذكية — اضغط <b>اختر يوم وقت</b> بالأسفل.
            </p>
          ) : (
            <div className="space-y-1.5">
              {suggestions.map((s) => {
                const key = s.day.id + s.phase.key;
                const isThisSaving = status.kind === "saving" && status.key === key;
                return (
                  <button
                    key={key}
                    disabled={status.kind === "saving"}
                    onClick={() => addToSlot(s)}
                    className={`w-full text-right bg-white border rounded-xl px-3 py-2 active:scale-[.99] transition disabled:opacity-50 flex items-center gap-2.5 ${
                      s.hasThisPlace
                        ? "border-amber-300 hover:border-amber-500 bg-amber-50/40"
                        : s.isEmpty
                        ? "border-emerald-200 hover:border-emerald-400"
                        : "border-stone-200 hover:border-stone-300"
                    }`}
                  >
                    <span className="text-xl">{s.phase.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13px] text-ink leading-tight">{s.label}</div>
                      <div className={`text-[10.5px] mt-0.5 ${s.hasThisPlace ? "text-amber-700" : "text-stone-500"}`}>
                        {s.hint}
                      </div>
                    </div>
                    <span className={`text-[11px] font-bold ${
                      isThisSaving ? "text-stone-400 animate-pulse" :
                      s.hasThisPlace ? "text-amber-700" :
                      s.isEmpty ? "text-emerald-700" : "text-stone-500"
                    }`}>
                      {isThisSaving ? "…" : s.hasThisPlace ? "أضف مرة ثانية" : s.isEmpty ? "أضف ＋" : "أضف"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {status.kind === "error" && (
            <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
              ⚠️ {status.message}
            </div>
          )}

          {/* Secondary actions */}
          <div className="mt-2.5 pt-2.5 border-t border-sky-200 flex gap-2 text-[11.5px]">
            <button
              onClick={onChooseAnother}
              disabled={status.kind === "saving"}
              className="flex-1 bg-white border border-line text-stone-800 font-bold rounded-pill py-1.5 active:scale-95 disabled:opacity-50"
            >
              🗓 اختر يوم/وقت
            </button>
            <button
              onClick={onSaveToggle}
              disabled={status.kind === "saving"}
              className={`flex-1 font-bold rounded-pill py-1.5 active:scale-95 disabled:opacity-50 ${
                saved ? "bg-coral text-white" : "bg-white border border-line text-stone-800"
              }`}
            >
              {saved ? "❤️ محفوظ" : "🤍 احفظ"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
