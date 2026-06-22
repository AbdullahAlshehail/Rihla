"use client";

// Smooth bottom-sheet popup for a single map place. Slides up from the
// bottom of the map area when a marker is tapped — matches the rest of the
// app's sheet pattern (NowCard, BookingsScreen sheet).

import { useEffect, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import {
  fmtMins, fmtKm, estimateTravelTimes, haversineKm,
} from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sweet: "🍰",
  sight: "🏛", nature: "🌿", event: "🎭", bar: "🍸",
};
const CAT_AR: Record<string, string> = {
  food: "مطعم", coffee: "قهوة", sweet: "حلويات",
  sight: "معلم", nature: "طبيعة", event: "ترفيه", bar: "بار",
};

function fmtReviews(n?: number | null): string {
  if (!n) return "";
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function MapPlacePopup({
  place,
  userLocation,
  hotelLocation,
  nearby,
  onPickNearby,
  onClose,
  onOpenDetail,
}: {
  place: Place | null;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  /** 3-4 places nearest to the selected one, rendered as a horizontal strip. */
  nearby?: Array<{ place: Place; km: number }>;
  /** Tap a nearby suggestion → switch the selected place to it. */
  onPickNearby?: (p: Place) => void;
  onClose: () => void;
  onOpenDetail: (p: Place) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Two-phase mount/animate so the slide-up transition actually plays
  useEffect(() => {
    if (place) {
      setMounted(true);
      // next frame so the .translate-y-full → .translate-y-0 transition runs
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else if (mounted) {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 220);
      return () => clearTimeout(t);
    }
  }, [place, mounted]);

  if (!mounted || !place) return null;

  const photo = photoAtWidth(place.photo_url, 320) ?? null;
  const anchor = userLocation ?? hotelLocation;
  let distLine: { km: number; minutes: number; mode: "walk" | "drive" } | null = null;
  if (anchor && place.lat != null && place.lng != null) {
    const km = haversineKm(anchor, { lat: place.lat, lng: place.lng });
    const t = estimateTravelTimes(km);
    const isWalk = km < 1.5;
    distLine = { km, minutes: isWalk ? t.walkMin : t.driveMin, mode: isWalk ? "walk" : "drive" };
  }
  const costStr = !place.cost_estimate || place.cost_estimate <= 0
    ? null
    : place.cost_currency === "SAR"
    ? `${Math.round(place.cost_estimate)} ر.س`
    : `~${Math.round(place.cost_estimate)} ${place.cost_currency}`;

  return (
    <>
      {/* No backdrop — letting taps pass straight through to the map so the
          user can switch markers, pan, or zoom without dismissing first.
          The popup itself sits at the bottom; the small "✕ إغلاق" button
          closes it explicitly. */}

      {/* Sheet */}
      <div
        className={`absolute inset-x-3 bottom-3 z-[600] bg-white rounded-2xl shadow-2xl border border-stone-200 transition-transform duration-200 ease-out ${
          visible ? "translate-y-0" : "translate-y-[calc(100%+24px)]"
        }`}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        {/* Drag handle */}
        <div className="pt-2 grid place-items-center">
          <span className="block w-10 h-1.5 bg-stone-300 rounded-pill" />
        </div>

        <div className="px-3.5 pt-2 pb-3">
          <div className="flex gap-3">
            {/* Photo */}
            <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-stone-100 grid place-items-center text-3xl">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo}
                  alt={place.name}
                  className="w-full h-full object-cover"
                  loading="eager"
                  decoding="async"
                />
              ) : (
                <span>{CAT_EMOJI[place.category] ?? "✦"}</span>
              )}
            </div>

            {/* Title + meta */}
            <div className="flex-1 min-w-0">
              <h3 className="font-extrabold text-[15px] leading-tight text-ink line-clamp-2">{place.name}</h3>
              <p className="text-[11.5px] text-stone-500 mt-0.5">
                <span className="font-bold text-stone-700">{CAT_EMOJI[place.category]} {CAT_AR[place.category]}</span>
                {place.city_label && <> · 📍 {place.city_label}</>}
              </p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
                {place.rating != null && (
                  <span className="font-bold text-amber-700">
                    ⭐ {place.rating.toFixed(1)}
                    {place.review_count != null && (
                      <span className="font-normal text-stone-400"> ({fmtReviews(place.review_count)})</span>
                    )}
                  </span>
                )}
                {distLine && (
                  <span className="font-bold text-sea">
                    {distLine.mode === "walk" ? "🚶" : "🚗"} {fmtMins(distLine.minutes)} · {fmtKm(distLine.km)}
                  </span>
                )}
                {costStr && <span className="font-bold text-ink">💰 {costStr}</span>}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={onClose}
              className="bg-white border border-line text-stone-700 font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 transition"
            >
              ✕ إغلاق
            </button>
            <button
              onClick={() => onOpenDetail(place)}
              className="bg-coral text-white font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 transition"
            >
              التفاصيل ←
            </button>
          </div>

          {/* Nearby suggestions strip — tap to switch selected (map stays put) */}
          {nearby && nearby.length > 0 && (
            <div className="mt-3 pt-3 border-t border-line">
              <div className="text-[10.5px] font-bold text-muted mb-1.5">
                🧭 قريب من هنا
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-3.5 px-3.5 scrollbar-thin">
                {nearby.map(({ place: np, km }) => {
                  const npPhoto = photoAtWidth(np.photo_url, 160);
                  return (
                    <button
                      key={np.id}
                      onClick={() => onPickNearby?.(np)}
                      className="shrink-0 w-32 bg-stone-50 border border-line rounded-xl p-1.5 text-right active:scale-95 transition"
                    >
                      <div className="w-full h-16 rounded-lg overflow-hidden bg-stone-200 grid place-items-center text-2xl">
                        {npPhoto ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={npPhoto}
                            alt={np.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span>{CAT_EMOJI[np.category] ?? "✦"}</span>
                        )}
                      </div>
                      <div className="font-bold text-[11.5px] text-ink line-clamp-1 mt-1">{np.name}</div>
                      <div className="flex items-center justify-between text-[10.5px] text-stone-600 mt-0.5">
                        <span>📍 {fmtKm(km)}</span>
                        {np.rating != null && (
                          <span className="font-bold text-amber-700">⭐ {np.rating.toFixed(1)}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
