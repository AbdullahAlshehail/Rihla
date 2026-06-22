"use client";

// Live Replan — bottom sheet that pops on "غيّرت رأيي". Five quick intents
// re-feed the Decision Engine with a temporary mode + relevant constraints
// and show 3 compact options. Picking an option opens it in plan/maps.
//
// Pure client. No new Google calls. Uses the trip's already-fetched catalog.

import { useState, useMemo, useEffect } from "react";
import type { Place, Trip } from "@/lib/supabase/database.types";
import { decide, type PreferenceMode, type UserHistory } from "@/lib/decision/engine";
import { pickThreeCards, type ScoredPlace } from "@/lib/decision/pickCards";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { haversineKm, fmtKm, fmtMins, estimateTravelTimes, buildDirectionsUrl } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";

type Intent = "near" | "quiet" | "luxury" | "hotel" | "continue";

const INTENTS: Array<{ key: Intent; ar: string; emoji: string; hint: string }> = [
  { key: "near",     ar: "شيء قريب",      emoji: "📍", hint: "أقرب ما يمكن" },
  { key: "quiet",    ar: "شيء هادئ",      emoji: "🧘", hint: "بدون زحمة" },
  { key: "luxury",   ar: "شيء أفخم",      emoji: "💎", hint: "تجربة راقية" },
  { key: "hotel",    ar: "رجوع للفندق",   emoji: "🏨", hint: "خريطة مباشرة" },
  { key: "continue", ar: "كمّل الخطة",     emoji: "▶️", hint: "أغلق وارجع" },
];

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

export default function LiveReplanSheet({
  open,
  onClose,
  trip,
  places,
  userHistory,
  refLocation,
  hotelLocation,
}: {
  open: boolean;
  onClose: () => void;
  trip: Trip;
  places: Place[];
  userHistory: UserHistory;
  refLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
}) {
  const [intent, setIntent] = useState<Intent | null>(null);

  // Lock body scroll when open + ESC to close
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Reset intent when sheet closes
  useEffect(() => { if (!open) setIntent(null); }, [open]);

  // Map intent → temporary preference mode used inside the sheet only
  const tempMode: PreferenceMode = useMemo(() => {
    switch (intent) {
      case "near":   return "near";
      case "quiet":  return "tired";    // tired ⇒ near + low effort
      case "luxury": return "luxury";
      default:       return null;
    }
  }, [intent]);

  // Compute decisions + pick 3 with the temp mode
  const cards = useMemo(() => {
    if (!intent || intent === "hotel" || intent === "continue") {
      return { best: null, near: null, luxury: null };
    }
    const now = new Date();
    const scored: ScoredPlace[] = places.map((p) => {
      const smart = computeSmartScore(p, {
        now,
        userLocation: refLocation,
        hotelLocation,
        budgetStyle: trip.budget_style,
        userRating: userHistory.ratings[p.id] ?? null,
        userVerdict: userHistory.verdicts[p.id] ?? null,
      });
      // Quiet intent also de-prioritises bars/nightclubs categorically
      if (intent === "quiet" && (p.category === "bar" || p.category === "event")) {
        return { place: p, decision: { verdict: "skip" as const, ar: "تخطّه", confidence: 0, reason: ["غير هادئ"] } };
      }
      const decision = decide(p, {
        now,
        currentLocation: refLocation,
        hotelLocation,
        preferenceMode: tempMode,
        userHistory,
        smartScore: smart.score,
        rates: (trip.rates as Partial<Record<string, number>>) ?? undefined,
      });
      return { place: p, decision };
    });
    return pickThreeCards(
      scored.sort((a, b) => b.decision.confidence - a.decision.confidence),
      refLocation,
    );
  }, [intent, tempMode, places, refLocation, hotelLocation, trip.budget_style, trip.rates, userHistory]);

  // "Hotel" intent — open Google Maps directly, close sheet
  useEffect(() => {
    if (intent !== "hotel") return;
    if (hotelLocation) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${hotelLocation.lat},${hotelLocation.lng}`;
      window.open(url, "_blank", "noopener");
    }
    onClose();
  }, [intent, hotelLocation, onClose]);

  // "Continue" intent — just close
  useEffect(() => {
    if (intent === "continue") onClose();
  }, [intent, onClose]);

  if (!open) return null;

  const picks = [cards.best, cards.near, cards.luxury].filter(
    (x): x is ScoredPlace => x != null,
  );

  return (
    <div
      className="fixed inset-0 z-[70] bg-ink/50 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-sand w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88dvh] overflow-y-auto overscroll-contain animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-sand pt-3 pb-2 px-4 border-b border-line z-10">
          <div className="w-12 h-1.5 bg-ink/20 rounded-full mx-auto mb-2" />
          <div className="flex items-center justify-between">
            <h2 className="font-serif font-extrabold text-lg">غيّرت رأيك؟</h2>
            <button
              onClick={onClose}
              aria-label="إغلاق"
              className="w-8 h-8 grid place-items-center bg-white border border-line rounded-full font-bold text-ink"
            >
              ✕
            </button>
          </div>
          <p className="text-[11.5px] text-muted mt-0.5">اختر اتجاه واحد — نعطيك ٣ خيارات فوراً.</p>
        </div>

        {/* Intent buttons */}
        <div className="p-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {INTENTS.map((it) => {
              const active = intent === it.key;
              return (
                <button
                  key={it.key}
                  onClick={() => setIntent(it.key)}
                  className={`text-right px-3 py-3 rounded-2xl border-2 transition active:scale-[0.98] ${
                    active
                      ? "bg-sea text-white border-sea shadow"
                      : "bg-white text-ink border-line hover:border-sea"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl shrink-0">{it.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[13.5px] leading-tight">{it.ar}</div>
                      <div className={`text-[10.5px] mt-0.5 ${active ? "text-white/80" : "text-muted"}`}>{it.hint}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Results */}
        {intent && intent !== "hotel" && intent !== "continue" && (
          <div className="px-4 pb-5">
            <div className="text-[11.5px] font-bold text-muted mb-2 px-1">
              أفضل ٣ خيارات لك:
            </div>
            {picks.length === 0 ? (
              <div className="bg-white rounded-2xl border border-line p-5 text-center">
                <p className="text-muted text-sm">ما لقيت خيار يطابق. جرّب اتجاه ثاني.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {picks.map(({ place, decision }) => {
                  let distKm: number | null = null;
                  if (refLocation && place.lat != null && place.lng != null) {
                    distKm = haversineKm(refLocation, { lat: place.lat, lng: place.lng });
                  }
                  const travel = distKm != null ? estimateTravelTimes(distKm) : null;
                  const dirHref = place.lat != null && place.lng != null ? buildDirectionsUrl(place) : null;
                  return (
                    <article
                      key={place.id}
                      className="bg-white rounded-2xl border border-line p-3 flex items-start gap-3"
                    >
                      <div className={`w-11 h-11 rounded-xl shrink-0 grid place-items-center text-2xl ${
                        place.photo_url ? "bg-stone-200" : "bg-gradient-to-br from-stone-100 to-stone-200"
                      }`}>
                        {place.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoAtWidth(place.photo_url, 160) ?? undefined} alt={place.name} className="w-full h-full object-cover rounded-xl" loading="lazy" decoding="async" />
                        ) : (
                          CAT_EMOJI[place.category] ?? "✦"
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-serif font-extrabold text-[13.5px] leading-tight line-clamp-1">
                          {place.name}
                        </div>
                        <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {place.rating != null && (
                            <span><b className="text-ink">{place.rating.toFixed(1)}</b>★</span>
                          )}
                          {distKm != null && travel && (
                            <span>{distKm < 2 ? "🚶" : "🚗"} {fmtMins(distKm < 2 ? travel.walkMin : travel.driveMin)} · {fmtKm(distKm)}</span>
                          )}
                          <span className="font-bold text-ink">ثقة {decision.confidence}٪</span>
                        </div>
                        <p className="text-[11px] text-ink/75 mt-1 leading-snug line-clamp-2">
                          {decision.reason.slice(0, 2).join(" · ") || decision.ar}
                        </p>
                      </div>
                      {dirHref && (
                        <a
                          href={dirHref}
                          target="_blank"
                          rel="noopener"
                          className="shrink-0 bg-coral text-white font-bold text-[11px] px-3 py-2 rounded-xl self-center"
                        >
                          🧭 خذني
                        </a>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
