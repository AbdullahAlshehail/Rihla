"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ItineraryDay, ItineraryItem, Place, Slot, Trip } from "@/lib/supabase/database.types";
import { SLOT_LABEL, SLOT_SHORT, SLOT_HINT, SLOT_ORDER, SLOT_MAX } from "@/lib/slots";
import {
  fmtDayLong, fmtMins, fmtKm, fmtMoneySAR,
  estimateTravelTimes, haversineKm,
  formatOpenStatus,
} from "@/lib/utils";
import { getHighlightDisplays, getKindDisplay } from "@/lib/highlights";
import PlaceDetailSheet from "@/components/PlaceDetailSheet";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { photoAtWidth } from "@/lib/images";

type ItemWithPlace = ItineraryItem & { places: Place };
type Option = {
  place: Place;
  score: number;
  reasonAr: string;
  in_this_day_slot: string | null; // SLOT_SHORT name if used in same day
  in_other_day: boolean;
};

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

const CAT_GRADIENT: Record<string, string> = {
  food: "from-orange-100 to-red-100",
  coffee: "from-amber-100 to-stone-200",
  sight: "from-sky-100 to-blue-200",
  nature: "from-emerald-100 to-green-200",
  event: "from-purple-100 to-violet-200",
  sweet: "from-pink-100 to-rose-200",
  bar: "from-amber-200 to-yellow-200",
};

type Anchor = { lat: number; lng: number; name: string; kind: "hotel" | "prev" };

export default function InteractiveDayCard({
  trip, day, items, idx,
}: {
  trip: Pick<Trip, "id" | "hotel_lat" | "hotel_lng" | "hotel_name" | "rates">;
  day: ItineraryDay;
  items: ItemWithPlace[];
  idx: number;
}) {
  const hotel = trip.hotel_lat != null && trip.hotel_lng != null
    ? { lat: trip.hotel_lat, lng: trip.hotel_lng, name: trip.hotel_name ?? "فندقك" }
    : null;
  const router = useRouter();
  const [, startTx] = useTransition();
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);
  const [options, setOptions] = useState<Partial<Record<Slot, Option[]>>>({});
  const [loadingSlot, setLoadingSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((m) => (m === msg ? null : m)), 2400);
  }

  async function fetchOptions(slot: Slot) {
    setLoadingSlot(slot);
    try {
      const r = await fetch(
        `/api/trips/${trip.id}/itinerary/options?dayId=${day.id}&slot=${slot}`
      );
      const data = await r.json();
      setOptions((o) => ({ ...o, [slot]: data.options ?? [] }));
    } finally {
      setLoadingSlot(null);
    }
  }

  async function toggleAlts(slot: Slot) {
    if (openSlot === slot) {
      setOpenSlot(null);
      return;
    }
    if (!options[slot]) await fetchOptions(slot);
    setOpenSlot(slot);
  }

  async function pickPlace(slot: Slot, placeId: string) {
    setBusy(placeId);
    const inSlot = items.filter((it) => it.slot === slot);
    if (inSlot.length >= SLOT_MAX) {
      flash(`الفترة ممتلئة (${SLOT_MAX} كحد أقصى)`);
      setBusy(null);
      return;
    }
    const r = await fetch(`/api/trips/${trip.id}/itinerary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_date: day.day_date, slot, place_id: placeId }),
    });
    setBusy(null);
    if (!r.ok) {
      const err = await r.json();
      flash(err.error ?? "تعذّر الإضافة");
      return;
    }
    const opt = options[slot]?.find((o) => o.place.id === placeId);
    flash(`✓ أضيف ${opt?.place.name ?? ""} لـ ${SLOT_SHORT[slot]}`);
    startTx(() => router.refresh());
    // Refresh options so the picked item is marked "in this slot"
    fetchOptions(slot);
  }

  async function removeItem(itemId: string, slot: Slot, name: string) {
    setBusy(itemId);
    const r = await fetch(`/api/trips/${trip.id}/itinerary/${itemId}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!r.ok) {
      flash("تعذّر الحذف");
      return;
    }
    flash(`✓ شِيل ${name} من ${SLOT_SHORT[slot]}`);
    startTx(() => router.refresh());
    if (openSlot) fetchOptions(openSlot);
  }

  async function suggestDay() {
    setBusy("_day");
    const r = await fetch(`/api/trips/${trip.id}/itinerary/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_id: day.id }),
    });
    setBusy(null);
    if (!r.ok) {
      flash("تعذّر الاقتراح");
      return;
    }
    const data = await r.json();
    if (data.filled > 0) {
      flash(
        `✓ ملأت ${data.filled} فترة${data.skipped ? ` (${data.skipped} لها اختياراتك)` : ""}`
      );
    } else if (data.skipped > 0) {
      flash("الفترات كلها فيها اختياراتك — اضغط 🧹 فرّغ قبل");
    } else {
      flash("ما لقيت أماكن مناسبة");
    }
    startTx(() => router.refresh());
    // Invalidate cached options
    setOptions({});
  }

  async function clearDay() {
    if (!confirm("امسح كل اختياراتك في هذا اليوم؟")) return;
    setBusy("_day");
    for (const it of items) {
      await fetch(`/api/trips/${trip.id}/itinerary/${it.id}`, { method: "DELETE" });
    }
    setBusy(null);
    flash("✓ فُرّغ اليوم");
    startTx(() => router.refresh());
    setOptions({});
  }

  // Order items by slot then position; compute hops
  const ordered = items
    .slice()
    .sort((a, b) => {
      const so = SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot);
      return so !== 0 ? so : a.position - b.position;
    });

  const totalCostSar = items.reduce((sum, it) => {
    const p = it.places;
    if (!p.cost_estimate) return sum;
    const rate = (trip.rates as Record<string, number>)?.[p.cost_currency] ?? 1;
    const sar = p.cost_currency === "SAR" ? p.cost_estimate : p.cost_estimate * rate;
    return sum + sar;
  }, 0);

  // Day-level travel totals (Haversine fallback — clearly marked "تقديري")
  let dayDistanceKm = 0;
  let dayTotalMin = 0;
  let longestHopKm = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1].places;
    const b = ordered[i].places;
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) continue;
    const km = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
    dayDistanceKm += km;
    longestHopKm = Math.max(longestHopKm, km);
    const t = estimateTravelTimes(km);
    dayTotalMin += km < 2 ? t.walkMin : t.driveMin;
  }
  const daySummaryTone = longestHopKm <= 2 ? "good" : longestHopKm <= 8 ? "neut" : longestHopKm <= 25 ? "warn" : "bad";
  const daySummaryMsg =
    !ordered.length ? null :
    ordered.length === 1 ? "محطة واحدة فقط" :
    longestHopKm <= 2 ? `🟢 يومك مترابط · ${fmtMins(dayTotalMin)} مشي تقديري · ${fmtKm(dayDistanceKm)}` :
    longestHopKm <= 8 ? `🟡 مسافات متوسطة · ${fmtMins(dayTotalMin)} انتقال · ${fmtKm(dayDistanceKm)}` :
    longestHopKm <= 25 ? `🟠 يومك يحتاج سيارة · أبعد مسافة ${fmtKm(longestHopKm)}` :
    `🔴 يومك متشتت · ${fmtKm(longestHopKm)} بين محطتين`;

  return (
    <section className="bg-card border border-line rounded-2xl overflow-hidden shadow relative">
      {detailPlace && (
        <PlaceDetailSheet
          place={detailPlace}
          hotel={hotel}
          onClose={() => setDetailPlace(null)}
        />
      )}
      {toast && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-ink text-white text-xs font-bold px-3 py-2 rounded-pill shadow-lg max-w-[90%] text-center">
          {toast}
        </div>
      )}

      <header className="px-4 py-3 bg-gradient-to-b from-amber-50 to-white border-b border-line-soft">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="font-serif font-extrabold text-base">{fmtDayLong(day.day_date)}</div>
            <div className="text-[11px] text-muted">يوم {idx + 1} · {day.city ?? "—"}</div>
          </div>
          <span className="text-[11px] text-coral-600 font-bold bg-white border border-rose-200 px-2 py-1 rounded-pill">
            {fmtMoneySAR(totalCostSar)}
          </span>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={suggestDay}
            disabled={busy === "_day"}
            className="flex-1 bg-gradient-to-br from-coral to-coral-600 text-white font-bold text-xs py-2.5 rounded-xl disabled:opacity-60 shadow"
          >
            {busy === "_day" ? "⏳ يقترح..." : "✨ اقترح يومي"}
          </button>
          <button
            onClick={clearDay}
            disabled={busy === "_day" || items.length === 0}
            className="bg-white border border-line text-muted font-bold text-xs px-3 py-2.5 rounded-xl disabled:opacity-40"
          >
            🧹 فرّغ
          </button>
        </div>
        {daySummaryMsg && (
          <div className={`mt-2.5 px-3 py-2 rounded-lg text-[11.5px] font-bold ${
            daySummaryTone === "good" ? "bg-emerald-50 text-ok border border-emerald-200" :
            daySummaryTone === "neut" ? "bg-amber-50 text-amber-900 border border-amber-200" :
            daySummaryTone === "warn" ? "bg-orange-50 text-orange-800 border border-orange-200" :
            "bg-rose-50 text-danger border border-rose-200"
          }`}>
            {daySummaryMsg}
          </div>
        )}
      </header>

      <div className="p-3 space-y-3">
        {SLOT_ORDER.map((slot) => {
          const slotItems = ordered.filter((it) => it.slot === slot);
          const isOpen = openSlot === slot;
          const slotOptions = options[slot] ?? [];
          const occ = slotItems.length;
          const occLabel = occ === 0 ? "خالية" : occ === 1 ? "١ خيار" : occ === 2 ? "٢ خيارات" : `${occ} خيارات`;
          const occCls = occ === 0 ? "bg-stone-100 text-muted" : occ >= SLOT_MAX ? "bg-rose-100 text-danger" : "bg-emerald-50 text-ok";

          // Anchor for this slot's alts: latest placed item that's <= this slot, else hotel
          const slotIdxOrder = SLOT_ORDER.indexOf(slot);
          let prevAnchor: Anchor | null = null;
          for (let i = ordered.length - 1; i >= 0; i--) {
            const o = ordered[i];
            if (SLOT_ORDER.indexOf(o.slot) <= slotIdxOrder && o.places.lat != null && o.places.lng != null) {
              prevAnchor = { lat: o.places.lat, lng: o.places.lng, name: o.places.name, kind: "prev" };
              break;
            }
          }
          if (!prevAnchor && hotel) {
            prevAnchor = { lat: hotel.lat, lng: hotel.lng, name: hotel.name, kind: "hotel" };
          }

          return (
            <div key={slot} className="border-b border-dashed border-line-soft last:border-0 pb-3 last:pb-0">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-[13px] text-sea">{SLOT_LABEL[slot]}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10.5px] font-extrabold px-2.5 py-1 rounded-pill ${occCls}`}>
                    {occLabel}
                  </span>
                  <button
                    onClick={() => toggleAlts(slot)}
                    className={`text-[12px] font-bold px-3 py-1.5 rounded-pill border ${
                      isOpen
                        ? "bg-coral text-white border-coral"
                        : "bg-amber-50 text-coral-600 border-amber-200"
                    }`}
                  >
                    {isOpen ? "✕ إغلاق" : `↻ بدائل (${slotOptions.length || "..."})`}
                  </button>
                </div>
              </div>

              {/* Selected items + hops between them */}
              {slotItems.length === 0 ? (
                <button
                  onClick={() => toggleAlts(slot)}
                  className="w-full text-xs text-muted bg-sand/40 border border-dashed border-line-soft rounded-lg py-2 hover:text-coral"
                >
                  ＋ افتح البدائل واختر
                </button>
              ) : (
                <div className="space-y-1.5">
                  {slotItems.map((it) => {
                    const orderedIdx = ordered.findIndex((x) => x.id === it.id);
                    const prev = orderedIdx > 0 ? ordered[orderedIdx - 1].places : null;
                    return (
                      <div key={it.id}>
                        {prev && (
                          <Hop from={prev} to={it.places} />
                        )}
                        <Item
                          item={it}
                          hotel={hotel}
                          busy={busy === it.id}
                          onRemove={() => removeItem(it.id, slot, it.places.name)}
                          onOpen={() => setDetailPlace(it.places)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Alternatives panel */}
              {isOpen && (
                <div className="mt-3 bg-gradient-to-b from-amber-50 to-white border border-amber-200 rounded-xl p-2.5">
                  <div className="flex items-baseline justify-between mb-2 px-1">
                    <span className="text-[11px] font-bold text-amber-900">
                      {SLOT_HINT[slot]}
                    </span>
                    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-pill ${occ >= SLOT_MAX ? "bg-rose-100 text-danger" : "bg-white border border-amber-200 text-amber-900"}`}>
                      {occ}/{SLOT_MAX}{occ >= SLOT_MAX ? " · ممتلئة" : ""}
                    </span>
                  </div>
                  {loadingSlot === slot ? (
                    <p className="text-center text-xs text-muted py-4">⏳ يحضّر البدائل...</p>
                  ) : slotOptions.length === 0 ? (
                    <p className="text-center text-xs text-muted py-3">ما لقيت بدائل لهذه الفترة</p>
                  ) : (
                    <div className="space-y-2">
                      {slotOptions.map((opt) => (
                        <Alt
                          key={opt.place.id}
                          opt={opt}
                          slotFull={occ >= SLOT_MAX}
                          busy={busy === opt.place.id}
                          prevAnchor={prevAnchor}
                          hotel={hotel}
                          onPick={() => pickPlace(slot, opt.place.id)}
                          onOpen={() => setDetailPlace(opt.place)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Item({
  item, hotel, busy, onRemove, onOpen,
}: {
  item: ItemWithPlace;
  hotel: { lat: number; lng: number; name: string } | null;
  busy: boolean;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const p = item.places;
  const costStr = !p.cost_estimate || p.cost_estimate <= 0
    ? "مجاني"
    : p.cost_currency === "SAR"
    ? `${Math.round(p.cost_estimate)} ر.س`
    : `~${Math.round(p.cost_estimate)} ${p.cost_currency}`;

  const status = formatOpenStatus(p.opening_hours);

  // Score for visible badge — same engine the Explore page uses
  const { score, reasonAr } = computeSmartScore(p, {
    hotelLocation: hotel ? { lat: hotel.lat, lng: hotel.lng } : null,
  });

  // 🏨 Distance from hotel
  let hotelChip: { text: string; tone: string } | null = null;
  if (hotel && p.lat != null && p.lng != null) {
    const km = haversineKm({ lat: hotel.lat, lng: hotel.lng }, { lat: p.lat, lng: p.lng });
    const t = estimateTravelTimes(km);
    const isWalk = km < 2;
    hotelChip = {
      text: `🏨 ${fmtMins(isWalk ? t.walkMin : t.driveMin)} ${isWalk ? "مشي" : "سيارة"} · ${fmtKm(km)}`,
      tone: km <= 5 ? "good" : km <= 15 ? "neut" : "warn",
    };
  }

  const kind = getKindDisplay(p.kind);

  return (
    <div className="bg-white border border-line rounded-xl p-3 flex items-start gap-3">
      <button
        onClick={onOpen}
        className={`w-14 h-14 rounded-xl overflow-hidden shrink-0 active:scale-95 transition ${
          p.photo_url
            ? "bg-stone-200"
            : `bg-gradient-to-br ${CAT_GRADIENT[p.category] ?? "from-stone-100 to-stone-200"} grid place-items-center text-2xl`
        }`}
        aria-label="افتح التفاصيل"
      >
        {p.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoAtWidth(p.photo_url, 240) ?? undefined} alt={p.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : (
          CAT_EMOJI[p.category] ?? "✦"
        )}
      </button>
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-right"
        aria-label="افتح التفاصيل"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="font-serif font-extrabold text-[14px] leading-tight flex-1 min-w-0">{p.name}</div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-pill ${
              status.isOpen ? "bg-emerald-100 text-ok" : "bg-rose-100 text-danger"
            }`}>
              {status.isOpen ? "🟢 مفتوح" : "🔴 مغلق"}
            </span>
            <span
              className={`text-[10.5px] font-extrabold w-7 h-7 rounded-full grid place-items-center shadow-sm ${
                score >= 85 ? "bg-emerald-500 text-white"
                : score >= 70 ? "bg-amber-500 text-white"
                : "bg-stone-400 text-white"
              }`}
              title={`سكور رحلتي · ${reasonAr}`}
            >
              {score}
            </span>
          </div>
        </div>
        {/* Brief AI/curated summary — "وش فيه ووش فايدته" */}
        {(p.ai_summary || p.review_summary || p.tip) && (
          <p className="text-[11.5px] text-ink/80 leading-snug mt-1 line-clamp-2">
            {p.ai_summary ? "🧠 " : "📝 "}
            {p.ai_summary ?? p.review_summary ?? p.tip}
          </p>
        )}
        <div className="text-[11px] text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {p.rating != null && <span><b className="text-ink">{p.rating}</b>★{p.review_count ? ` · ${p.review_count >= 1000 ? (p.review_count / 1000).toFixed(1) + "k" : p.review_count}` : ""}</span>}
          <span className="font-bold text-ink">{costStr}</span>
          {kind && <span className="bg-sea text-white px-1.5 py-0.5 rounded-pill text-[10px] font-bold">{kind.emoji} {kind.ar}</span>}
        </div>
        {status.todayHours && !status.freeform && status.todayHours !== "مغلق" && (
          <div className="text-[10.5px] text-muted mt-1">🕐 اليوم: {status.todayHours}</div>
        )}
        {hotelChip && (
          <div className={`mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-pill ${
            hotelChip.tone === "good" ? "bg-emerald-50 text-ok border border-emerald-200" :
            hotelChip.tone === "neut" ? "bg-amber-50 text-amber-900 border border-amber-200" :
            "bg-orange-50 text-orange-800 border border-orange-200"
          }`}>
            {hotelChip.text}
          </div>
        )}
        <div className="text-[10.5px] text-coral font-bold mt-1">اضغط للتفاصيل والصور →</div>
      </button>
      <button
        onClick={onRemove}
        disabled={busy}
        aria-label="حذف"
        className="w-10 h-10 rounded-xl grid place-items-center text-danger bg-rose-50 border border-rose-200 disabled:opacity-40 active:bg-rose-100"
      >
        ✕
      </button>
    </div>
  );
}

function Hop({ from, to }: { from: Place; to: Place }) {
  if (from.lat == null || from.lng == null || to.lat == null || to.lng == null) return null;
  const km = haversineKm({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
  if (km < 0.01) return null;
  const t = estimateTravelTimes(km);
  const isWalk = km <= 2;
  const mode = isWalk ? "🚶" : "🚗";
  const minutes = isWalk ? t.walkMin : t.driveMin;
  const tone = km <= 2 ? "ok" : km <= 8 ? "muted" : km <= 25 ? "warn" : "danger";

  const cls = tone === "ok" ? "text-ok"
    : tone === "muted" ? "text-muted"
    : tone === "warn" ? "text-orange-700"
    : "text-danger";

  return (
    <div className={`text-center py-1.5 ${cls}`}>
      <div className="inline-flex items-center gap-1.5 text-[11px] font-bold">
        <span className="opacity-50">↓</span>
        <span>{mode} {fmtMins(minutes)} إلى {to.name}</span>
        <span className="opacity-70">· {fmtKm(km)}</span>
      </div>
      {km > 25 && <div className="text-[10px] text-danger mt-0.5">⚠ مسافة طويلة — اعتبر تقسيمها</div>}
    </div>
  );
}

function Alt({
  opt, slotFull, busy, prevAnchor, hotel, onPick, onOpen,
}: {
  opt: Option;
  slotFull: boolean;
  busy: boolean;
  prevAnchor: Anchor | null;
  hotel: { lat: number; lng: number; name: string } | null;
  onPick: () => void;
  onOpen: () => void;
}) {
  const p = opt.place;
  const isInThisDayElsewhere = !!opt.in_this_day_slot;
  const disabled = busy || slotFull || isInThisDayElsewhere;

  const status = formatOpenStatus(p.opening_hours);
  const kind = getKindDisplay(p.kind);
  const highlights = getHighlightDisplays(p.highlights).slice(0, 3);
  const costStr = !p.cost_estimate || p.cost_estimate <= 0
    ? "مجاني"
    : p.cost_currency === "SAR"
    ? `${Math.round(p.cost_estimate)} ر.س`
    : `~${Math.round(p.cost_estimate)} ${p.cost_currency}`;

  // Distance from previous anchor (last placed item OR hotel)
  let fromAnchor: { walkMin: number; driveMin: number; km: number; name: string; isHotel: boolean } | null = null;
  if (prevAnchor && p.lat != null && p.lng != null) {
    const km = haversineKm({ lat: prevAnchor.lat, lng: prevAnchor.lng }, { lat: p.lat, lng: p.lng });
    const t = estimateTravelTimes(km);
    fromAnchor = { walkMin: t.walkMin, driveMin: t.driveMin, km, name: prevAnchor.name, isHotel: prevAnchor.kind === "hotel" };
  }
  // Distance from hotel separately (only if anchor wasn't already hotel)
  let fromHotel: { walkMin: number; driveMin: number; km: number } | null = null;
  if (hotel && p.lat != null && p.lng != null && prevAnchor?.kind !== "hotel") {
    const km = haversineKm({ lat: hotel.lat, lng: hotel.lng }, { lat: p.lat, lng: p.lng });
    const t = estimateTravelTimes(km);
    fromHotel = { walkMin: t.walkMin, driveMin: t.driveMin, km };
  }

  const stateBorder = isInThisDayElsewhere
    ? "border-amber-300 bg-amber-50/40"
    : opt.in_other_day
    ? "border-line opacity-80"
    : "border-amber-100";

  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${stateBorder} shadow-sm`}>
      {/* Hero row: tappable to open detail sheet */}
      <button
        onClick={onOpen}
        className={`w-full text-right relative px-3 pt-2.5 pb-2 bg-gradient-to-br ${CAT_GRADIENT[p.category] ?? "from-stone-100 to-stone-200"} active:opacity-90 transition`}
      >
        <div className="flex items-start gap-2.5">
          <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-sm bg-white/60">
            {p.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoAtWidth(p.photo_url, 240) ?? undefined} alt={p.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="w-full h-full grid place-items-center text-2xl">
                {CAT_EMOJI[p.category] ?? "✦"}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-serif font-extrabold text-[14px] text-ink leading-tight">{p.name}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink/80 mt-0.5">
              {p.rating != null && (
                <span><b>{p.rating}</b>★{p.review_count ? ` · ${p.review_count >= 1000 ? (p.review_count / 1000).toFixed(1) + "k" : p.review_count}` : ""}</span>
              )}
              {opt.score != null && (
                <span className="bg-white/80 text-coral-600 px-1.5 py-px rounded-pill text-[10px] font-extrabold">
                  {opt.score}
                </span>
              )}
            </div>
          </div>
        </div>
        {/* Status badge top-right */}
        <span className={`absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-pill ${
          status.isOpen ? "bg-emerald-100 text-ok" : "bg-rose-100 text-danger"
        }`}>
          {status.label}
        </span>
      </button>

      {/* Body: classification + highlights + tip + facts */}
      <div className="px-3 py-2 space-y-1.5">
        {/* Kind classification (most prominent) */}
        {kind && (
          <div className="flex items-center gap-1.5">
            <span className="bg-sea text-white font-bold text-[10.5px] px-2 py-0.5 rounded-pill">
              {kind.emoji} {kind.ar}
            </span>
          </div>
        )}
        {/* What it's best at */}
        {highlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted font-bold">أفضل ما فيه:</span>
            {highlights.map((h) => (
              <span key={h.ar} className="bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-bold px-1.5 py-0.5 rounded-pill">
                {h.emoji} {h.ar}
              </span>
            ))}
          </div>
        )}
        {(p.review_summary || p.tip) && (
          <p
            onClick={onOpen}
            className="text-[11.5px] text-ink/85 leading-relaxed line-clamp-2 cursor-pointer"
          >
            📝 {p.review_summary ?? p.tip}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted">
          <span className="font-extrabold text-ink">{costStr}</span>
          {status.todayHours && status.todayHours !== "مغلق" && (
            <span className="text-[10px]">🕐 {status.todayHours}</span>
          )}
          {isInThisDayElsewhere && (
            <span className="bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-pill font-bold">
              ↑ في {opt.in_this_day_slot}
            </span>
          )}
          {opt.in_other_day && !isInThisDayElsewhere && (
            <span className="bg-stone-100 text-muted px-1.5 py-0.5 rounded-pill">
              في يوم آخر
            </span>
          )}
        </div>
        {/* Travel time rows */}
        {(fromAnchor || fromHotel) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {fromAnchor && (
              <span className="inline-flex items-center gap-1 bg-stone-50 border border-stone-200 px-2 py-1 rounded-pill text-[10.5px] font-bold text-ink">
                {fromAnchor.km < 2 ? "🚶" : "🚗"}
                {fromAnchor.km < 2 ? `${fmtMins(fromAnchor.walkMin)} مشي` : `${fmtMins(fromAnchor.driveMin)} سيارة`}
                <span className="text-muted">من {fromAnchor.isHotel ? "🏨 فندقك" : fromAnchor.name}</span>
                <span className="text-muted">({fmtKm(fromAnchor.km)})</span>
              </span>
            )}
            {fromHotel && (
              <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-pill text-[10.5px] font-bold text-amber-900">
                🏨 {fromHotel.km < 2 ? fmtMins(fromHotel.walkMin) + " مشي" : fmtMins(fromHotel.driveMin) + " سيارة"}
              </span>
            )}
          </div>
        )}
        {opt.reasonAr && (
          <p className="text-[10.5px] text-coral-600 font-bold leading-tight pt-1">
            ✨ {opt.reasonAr}
          </p>
        )}
      </div>

      {/* Action buttons */}
      <div className="px-3 pb-2.5 flex gap-2">
        <button
          onClick={onPick}
          disabled={disabled}
          className={`flex-1 font-extrabold text-[13px] py-2.5 rounded-xl min-h-[42px] transition ${
            disabled
              ? "bg-stone-100 text-muted"
              : "bg-coral text-white shadow active:scale-[.98]"
          }`}
        >
          {isInThisDayElsewhere ? `↑ موجود في ${opt.in_this_day_slot}` : slotFull ? "ممتلئة" : busy ? "⏳ ..." : "+ أضِف لخطّتي"}
        </button>
        <button
          onClick={onOpen}
          className="bg-white border border-sea/30 text-sea font-bold text-[12px] px-3 py-2.5 rounded-xl min-h-[42px]"
        >
          📷 شف
        </button>
      </div>
    </div>
  );
}
