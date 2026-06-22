"use client";

import type { ItineraryDay, ItineraryItem, Place } from "@/lib/supabase/database.types";
import { fmtDayLong, SLOT_LABEL, SLOT_ORDER, SLOT_SHORT, estimateTravelTimes, haversineKm, fmtMins, fmtKm, fmtMoneySAR } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ItemWithPlace = ItineraryItem & { places: Place };

export default function ItineraryDayCard({
  tripId,
  day,
  idx,
  items,
  hotel,
}: {
  tripId: string;
  day: ItineraryDay;
  idx: number;
  items: ItemWithPlace[];
  hotel: { lat: number; lng: number; name: string } | null;
}) {
  const [, startTransition] = useTransition();
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function removeItem(itemId: string) {
    setPending(itemId);
    await fetch(`/api/trips/${tripId}/itinerary/${itemId}`, { method: "DELETE" });
    setPending(null);
    startTransition(() => router.refresh());
  }

  const ordered = items.slice().sort((a, b) => {
    const so = SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
    return so !== 0 ? so : a.position - b.position;
  });

  // Compute hops between consecutive items
  type Hop = { walkMin: number; driveMin: number; km: number; toName: string };
  const hops: (Hop | null)[] = ordered.map((it, i) => {
    if (i === 0) return null;
    const prev = ordered[i - 1].places;
    const next = it.places;
    if (prev.lat == null || prev.lng == null || next.lat == null || next.lng == null) return null;
    const km = haversineKm({ lat: prev.lat, lng: prev.lng }, { lat: next.lat, lng: next.lng });
    const { walkMin, driveMin } = estimateTravelTimes(km);
    return { walkMin, driveMin, km, toName: next.name };
  });

  return (
    <section className="bg-card border border-line rounded-2xl overflow-hidden shadow">
      <header className="px-4 py-3 bg-gradient-to-b from-amber-50 to-white border-b border-line-soft">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="font-serif font-extrabold text-base">{fmtDayLong(day.day_date)}</div>
            <div className="text-[11px] text-muted">يوم {idx + 1} · {day.city ?? "—"}</div>
          </div>
          <span className="text-[11px] text-muted">{items.length}/{15} مكان</span>
        </div>
      </header>

      <div className="p-3 space-y-3">
        {SLOT_ORDER.map((slot) => {
          const slotItems = ordered.filter((it) => it.slot === slot);
          return (
            <div key={slot} className="border-b border-dashed border-line-soft last:border-0 pb-3 last:pb-0">
              <div className="flex items-baseline justify-between mb-2">
                <span className="font-bold text-[13px] text-sea">{SLOT_LABEL[slot]}</span>
                <button
                  onClick={() => router.push(`/trips/${tripId}/places?slot=${slot}&day=${day.id}`)}
                  className="text-[12px] font-bold text-coral-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-pill"
                >
                  ＋ أضف
                </button>
              </div>
              {slotItems.length === 0 ? (
                <p className="text-xs text-muted bg-sand/40 border border-dashed border-line-soft rounded-lg py-2 text-center">
                  لم تختر شيء بعد
                </p>
              ) : (
                <div className="space-y-2">
                  {slotItems.map((it) => {
                    const idxOrdered = ordered.findIndex((x) => x.id === it.id);
                    const hop = idxOrdered > 0 ? hops[idxOrdered] : null;
                    return (
                      <div key={it.id}>
                        {hop && (
                          <p className="text-[11px] text-muted text-center my-1.5 font-bold">
                            {hop.km < 2
                              ? `🚶 ${fmtMins(hop.walkMin)} مشي إلى ${hop.toName}`
                              : `🚗 ${fmtMins(hop.driveMin)} سيارة إلى ${hop.toName}`}{" "}
                            · {fmtKm(hop.km)}
                          </p>
                        )}
                        <div className="bg-white border border-line rounded-xl p-3 flex items-start gap-3">
                          <span className="text-2xl shrink-0">
                            {{ food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿", event: "🎭", sweet: "🍰", bar: "🍸" }[it.places.category] ?? "✦"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="font-serif font-extrabold text-sm">{it.places.name}</div>
                            <div className="text-[11px] text-muted mt-0.5 truncate">
                              {it.places.rating != null && <><b className="text-ink">{it.places.rating}</b>★ · </>}
                              {it.places.city_label ?? it.places.city}
                            </div>
                          </div>
                          <button
                            onClick={() => removeItem(it.id)}
                            disabled={pending === it.id}
                            aria-label="حذف"
                            className="w-10 h-10 rounded-xl grid place-items-center text-danger bg-rose-50 border border-rose-200 disabled:opacity-40"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
