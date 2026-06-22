"use client";

// SmartFillSheet — preview the proposed auto-fill before committing.
// Each item can be swapped or removed; user clicks "تنفيذ" to commit only
// what they kept. Zero surprise — every pick is shown with the reason.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ItineraryDay, ItineraryItem, Place } from "@/lib/supabase/database.types";
import {
  computeSmartFill, alternativePicksFor,
  type FillPick, type FillInput,
} from "@/lib/plan/smartFill";
import { photoAtWidth } from "@/lib/images";

type Status =
  | { kind: "idle" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; added: number }
  | { kind: "error"; message: string };

export default function SmartFillSheet({
  open,
  onClose,
  tripId,
  scope,
  fillInput,
  onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  tripId: string;
  scope: "day" | "trip";
  fillInput: FillInput;
  /** Called after a successful commit so the parent can show a final toast */
  onCommitted: (count: number) => void;
}) {
  // Compute the proposed fill once per open — recompute when scope changes.
  const initialPicks = useMemo(
    () => (open ? computeSmartFill(fillInput) : []),
    [open, fillInput],
  );

  // Allow the user to swap individual picks; track current pick per (day, phase).
  const [picks, setPicks] = useState<FillPick[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set()); // key: day.id + phase.key
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const doneTimeoutRef = useRef<number | null>(null);
  // Always clear any pending timeout on unmount
  useEffect(() => () => {
    if (doneTimeoutRef.current != null) {
      clearTimeout(doneTimeoutRef.current);
      doneTimeoutRef.current = null;
    }
  }, []);

  // Reset whenever the sheet opens (or its inputs change while open)
  useEffect(() => {
    if (open) {
      setPicks(initialPicks);
      setSkipped(new Set());
      setStatus({ kind: "idle" });
    } else {
      // Clear when closed so reopening is fresh
      setPicks([]);
      setSkipped(new Set());
      setStatus({ kind: "idle" });
    }
  }, [open, initialPicks]);

  // Close on Escape — basic a11y
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && status.kind !== "running") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, status.kind]);

  function keyOf(pick: FillPick) {
    return pick.day.id + ":" + pick.phase.key;
  }

  function toggleSkip(pick: FillPick) {
    const k = keyOf(pick);
    const next = new Set(skipped);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSkipped(next);
  }

  function swapPick(pick: FillPick) {
    const pickedSet = new Set(picks.map((p) => p.place.id));
    const alts = alternativePicksFor(fillInput, pickedSet, pick.day, pick.phase, 5);
    // Find a candidate that's not the current one — explicitly typed so a
    // missing return value doesn't silently null-out the pick.
    const next: typeof pick.place | undefined = alts.find((a) => a.id !== pick.place.id);
    if (!next) {
      // No alternatives available — flash an inline error so the user knows
      // why the swap button looked dead.
      setStatus({ kind: "error", message: "ما في بدائل متاحة لهذه الفترة" });
      setTimeout(() => setStatus((s) => s.kind === "error" ? { kind: "idle" } : s), 2500);
      return;
    }
    setPicks((arr) => arr.map((p) =>
      keyOf(p) === keyOf(pick) ? { ...p, place: next, reasons: ["بديل يدوي"] } : p,
    ));
  }

  const committable = picks.filter((p) => !skipped.has(keyOf(p)));

  async function commit() {
    if (committable.length === 0) {
      onClose();
      return;
    }
    setStatus({ kind: "running", done: 0, total: committable.length });
    let added = 0;
    try {
      for (const p of committable) {
        const r = await fetch(`/api/trips/${tripId}/itinerary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            day_date: p.day.day_date,
            place_id: p.place.id,
            slot: p.phase.slots[0],
          }),
        });
        if (r.ok) added++;
        setStatus({ kind: "running", done: added, total: committable.length });
      }
      setStatus({ kind: "done", added });
      onCommitted(added);
      // Use a ref-tracked timeout so the unmount effect can cancel it; prevents
      // setState-on-unmounted warnings if the user navigates away fast.
      doneTimeoutRef.current = window.setTimeout(() => { onClose(); }, 1200);
    } catch {
      setStatus({ kind: "error", message: "تعذّر التنفيذ — حاول مرة ثانية" });
    }
  }

  function resetSheet() {
    setPicks([]);
    setSkipped(new Set());
    setStatus({ kind: "idle" });
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smartfill-title"
      className="fixed inset-0 z-[70] bg-ink/50 backdrop-blur-sm flex items-end sm:items-center justify-center px-2"
      onClick={(e) => { if (e.target === e.currentTarget && status.kind !== "running") onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden overscroll-contain flex flex-col max-h-[85dvh] animate-in slide-in-from-bottom-4 duration-200"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Header */}
        <header className="px-4 py-3 border-b border-line bg-gradient-to-l from-violet-50 to-sky-50">
          <div className="flex items-center justify-between">
            <h2 id="smartfill-title" className="font-serif font-extrabold text-[15px] text-violet-900">
              ✨ خطة ذكية مقترحة
            </h2>
            <button
              onClick={onClose}
              disabled={status.kind === "running"}
              aria-label="إغلاق"
              className="w-11 h-11 rounded-full text-stone-600 hover:bg-stone-100 grid place-items-center disabled:opacity-50 text-base font-bold"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] text-violet-800/80 mt-0.5 leading-snug">
            {scope === "day" ? "لليوم المحدّد" : "لكامل الرحلة"} ·
            متنوّعة · قريبة من بعضها · بدون تكرار
          </p>
        </header>

        {/* Body — scrollable list of picks */}
        <div className="flex-1 overflow-y-auto bg-stone-50/40">
          {picks.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-3xl mb-2">🎯</div>
              <p className="text-[13px] font-bold text-stone-700">كل المراحل ممتلئة</p>
              <p className="text-[11px] text-stone-500 mt-1">ما في فراغات نملأها.</p>
            </div>
          ) : (
            <ul className="p-2 space-y-1.5">
              {picks.map((pick, idx) => {
                const k = keyOf(pick);
                const isSkipped = skipped.has(k);
                const dayIdx = fillInput.days.findIndex((d) => d.id === pick.day.id);
                return (
                  <li
                    key={k}
                    className={`bg-white border rounded-2xl overflow-hidden transition ${
                      isSkipped ? "border-stone-200 opacity-50" : "border-stone-200"
                    }`}
                  >
                    {/* Phase strip — small, identifies the slot */}
                    <div className="px-2.5 py-1 bg-stone-50 border-b border-line-soft flex items-center gap-1.5 text-[10.5px]">
                      <span className="font-bold text-stone-700">يوم {dayIdx + 1}</span>
                      <span className="text-stone-400">·</span>
                      <span>{pick.phase.emoji} {pick.phase.ar}</span>
                      <span className="text-stone-400">·</span>
                      <span className="text-stone-500">{pick.phase.timeAr}</span>
                      <span className="ms-auto text-[10px] text-stone-500">#{idx + 1}</span>
                    </div>

                    {/* Pick content */}
                    <div className="p-2.5 flex gap-2.5">
                      <div className="w-14 h-14 rounded-xl shrink-0 overflow-hidden bg-stone-100 grid place-items-center text-xl">
                        {pick.place.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoAtWidth(pick.place.photo_url, 168) ?? pick.place.photo_url} alt={pick.place.name} className="w-full h-full object-cover" loading="lazy" />
                        ) : "📍"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-serif font-extrabold text-[13.5px] leading-tight line-clamp-1">
                          {pick.place.name}
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-0 flex-wrap mt-0.5 text-[10.5px]">
                          {pick.place.rating != null && (
                            <span className="font-bold text-amber-700">★ {pick.place.rating.toFixed(1)}</span>
                          )}
                          {pick.place.kind && <span className="text-stone-500">{pick.place.kind}</span>}
                        </div>
                        {pick.reasons.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {pick.reasons.map((r, i) => (
                              <span key={i} className="text-[9.5px] text-violet-700 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-pill">
                                ✨ {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Per-item action row */}
                    <div className="px-2.5 py-1.5 border-t border-line-soft bg-stone-50/50 flex items-center gap-1.5">
                      <button
                        onClick={() => swapPick(pick)}
                        disabled={status.kind === "running"}
                        className="text-[10.5px] font-bold text-stone-700 bg-white border border-stone-200 hover:border-coral px-2 py-0.5 rounded-pill disabled:opacity-50"
                      >
                        🔁 بدّل
                      </button>
                      <button
                        onClick={() => toggleSkip(pick)}
                        disabled={status.kind === "running"}
                        className={`text-[10.5px] font-bold px-2 py-0.5 rounded-pill border disabled:opacity-50 ${
                          isSkipped
                            ? "bg-stone-100 border-stone-300 text-stone-700"
                            : "bg-white border-rose-200 text-rose-700 hover:bg-rose-50"
                        }`}
                      >
                        {isSkipped ? "↩ رجّع" : "✕ تخطّه"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer — counters + commit */}
        <footer className="border-t border-line bg-white px-4 py-2.5">
          {status.kind === "running" && (
            <div className="mb-2">
              <div className="text-[11px] text-stone-700 mb-1 flex justify-between">
                <span>جاري الإضافة…</span>
                <span className="font-bold">{status.done} / {status.total}</span>
              </div>
              <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-violet-500 transition-all"
                  style={{ width: `${(status.done / status.total) * 100}%` }}
                />
              </div>
            </div>
          )}
          {status.kind === "done" && (
            <div className="mb-2 text-[12px] text-emerald-700 font-bold text-center">
              ✓ أُضيف {status.added} مكان للخطة
            </div>
          )}
          {status.kind === "error" && (
            <div className="mb-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1">
              ⚠️ {status.message}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={status.kind === "running"}
              className="flex-1 bg-white border border-line text-stone-700 text-[12px] font-bold py-2 rounded-pill active:scale-95 disabled:opacity-50"
            >
              إلغاء
            </button>
            <button
              onClick={commit}
              disabled={status.kind === "running" || committable.length === 0}
              className="flex-[2] bg-coral text-white text-[12.5px] font-extrabold py-2 rounded-pill shadow-md active:scale-95 disabled:opacity-50"
            >
              {status.kind === "done"
                ? "✓ تمّ"
                : `أضف ${committable.length} للخطّة`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
