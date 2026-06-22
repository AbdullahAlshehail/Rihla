"use client";

// Now Card (Phase 2B). Renders a NowCardData built upstream by the engine.
// Each card answers 5 questions in one glance:
//   1) ليش هذا؟    → tone-aware reason sentence
//   2) كم يبعد؟   → travel chip (🚗 X د · Y كم)
//   3) كم يأخذ؟   → visit duration
//   4) مفتوح؟     → open-at-arrival pill
//   5) يناسبني؟   → score badge + risk notes
//
// Actions: اذهب · أضف للخطة · بدّل · لماذا هذا؟ (expand bullets)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DecisionContext, NowCardData } from "@/lib/decision/engine";
import { CARD_LABEL_META } from "@/lib/decision/engine";
import { coffeeNature } from "@/lib/google/coffeeHighlights";
import { fmtMins, fmtKm, buildDirectionsUrl } from "@/lib/utils";
import { photoAtWidth } from "@/lib/images";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

const CAT_GRADIENT: Record<string, string> = {
  food: "from-orange-200 to-rose-300",
  coffee: "from-amber-100 to-stone-300",
  sight: "from-sky-200 to-blue-300",
  nature: "from-emerald-200 to-green-300",
  event: "from-purple-200 to-violet-300",
  sweet: "from-pink-200 to-rose-300",
  bar: "from-amber-300 to-yellow-300",
};

function openStatusChip(s: NowCardData["openAtArrival"]) {
  switch (s) {
    case "open":         return { ar: "مفتوح عند الوصول", cls: "bg-emerald-50 text-emerald-700 border border-emerald-200", emoji: "✓" };
    case "closes_soon":  return { ar: "يقفل قريب",        cls: "bg-amber-50 text-amber-800 border border-amber-200",      emoji: "⏰" };
    case "closed":       return { ar: "مغلق عند الوصول",  cls: "bg-rose-50 text-rose-700 border border-rose-200",         emoji: "🔴" };
    case "unknown":      return { ar: "ساعات غير مؤكّدة", cls: "bg-stone-50 text-stone-700 border border-stone-200",     emoji: "❓" };
  }
}

export default function NowCard({
  card,
  ctx,
  tripId,
  initiallySaved = false,
  onSwap,
}: {
  card: NowCardData;
  ctx: DecisionContext;
  tripId: string;
  initiallySaved?: boolean;
  onSwap?: () => void;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [whyOpen, setWhyOpen] = useState(false);
  const [, startTx] = useTransition();

  const { place } = card;
  const meta = CARD_LABEL_META[card.label];
  const open = openStatusChip(card.openAtArrival);
  const coffeeBadges = place.category === "coffee" ? coffeeNature(place) : [];

  const dirHref = place.lat != null && place.lng != null ? buildDirectionsUrl(place) : null;

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    startTx(async () => {
      try {
        const r = await fetch(`/api/trips/${tripId}/places`, {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place_id: place.id }),
        });
        if (!r.ok) setSaved(!next);
      } catch {
        setSaved(!next);
      }
    });
  }

  return (
    <article className={`bg-card rounded-2xl shadow overflow-hidden border-2 ${meta.accent}`}>
      {/* Header strip: label + score */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-stone-50 border-b border-line">
        <span className="text-[11px] font-extrabold text-stone-900 inline-flex items-center gap-1">
          <span>{meta.emoji}</span>
          <span>{meta.ar}</span>
        </span>
        <span className="text-[10.5px] font-bold text-muted" title="درجة قرار الآن">
          ⚡ {card.score}
        </span>
      </div>

      {/* Hero — photo or gradient + name overlay. 16:7 ratio gives the title
          enough breathing room on iPhone SE without dominating the card. */}
      <div className={`relative aspect-[16/7] ${
        place.photo_url ? "bg-stone-200" : `bg-gradient-to-br ${CAT_GRADIENT[place.category] ?? "from-stone-100 to-stone-200"}`
      }`}>
        {place.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoAtWidth(place.photo_url, 640) ?? undefined}
            alt={place.name}
            width={640}
            height={320}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-6xl">
            {CAT_EMOJI[place.category] ?? "✦"}
          </div>
        )}
        {place.photo_url && (
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />
        )}
        <div className={`absolute bottom-2 right-3 left-3 ${place.photo_url ? "text-white" : "text-ink"}`}>
          <h3 className="font-serif font-extrabold text-lg leading-tight drop-shadow line-clamp-1">
            {place.name}
          </h3>
          {place.city_label && (
            <div className={`text-[10.5px] font-bold drop-shadow mt-0.5 ${place.photo_url ? "text-white/95" : "text-ink/75"}`}>
              📍 {place.city_label}
            </div>
          )}
        </div>
      </div>

      {/* Body — 5-question facts strip + reason + risks */}
      <div className="p-3 space-y-2">
        {/* Facts strip — distance · visit · open · cost/rating */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {card.travelMin != null && card.distanceKm != null && (
            <span className="bg-sky-50 text-sea border border-sky-200 font-bold px-2 py-0.5 rounded-pill">
              {card.travelMode === "walk" ? "🚶" : "🚗"} {fmtMins(card.travelMin)} · {fmtKm(card.distanceKm)}
            </span>
          )}
          <span className="bg-stone-50 text-stone-700 border border-stone-200 font-bold px-2 py-0.5 rounded-pill">
            ⏱ زيارة ~{card.visitMin}د
          </span>
          <span className={`font-bold px-2 py-0.5 rounded-pill ${open.cls}`}>
            {open.emoji} {open.ar}
          </span>
          {card.ratingLabel && (
            <span className="bg-amber-50 text-amber-800 border border-amber-200 font-bold px-2 py-0.5 rounded-pill">
              {card.ratingLabel}
            </span>
          )}
          {card.costLabel && (
            <span className="font-bold text-ink">{card.costLabel}</span>
          )}
        </div>

        {/* Coffee character badges — only on cafes */}
        {coffeeBadges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {coffeeBadges.map((b) => (
              <span
                key={b.key}
                className="text-[10.5px] font-extrabold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-pill inline-flex items-center gap-1"
              >
                <span>{b.emoji}</span>
                <span>{b.ar}</span>
              </span>
            ))}
          </div>
        )}

        {/* "ليش هذا؟" one-sentence reason */}
        <div className="bg-stone-50 rounded-lg px-2.5 py-1.5 border border-line">
          <div className="text-[10.5px] font-bold text-muted mb-0.5">ليش هذا؟</div>
          <p className="text-[12px] text-ink/85 leading-snug">{card.reason}</p>
        </div>

        {/* Risk notes inline (never hidden) */}
        {card.riskNotes.length > 0 && (
          <ul className="space-y-0.5">
            {card.riskNotes.map((r, i) => (
              <li
                key={i}
                className="text-[11px] text-amber-900 bg-amber-50/70 border border-amber-200 rounded-lg px-2 py-1 leading-snug"
              >
                ⚠ {r}
              </li>
            ))}
          </ul>
        )}

        {/* "لماذا هذا؟" expand → bulleted breakdown */}
        {whyOpen && card.reasonBullets.length > 0 && (
          <div className="bg-white border border-line rounded-lg px-2.5 py-2">
            <div className="text-[10.5px] font-bold text-muted mb-1">تفاصيل القرار</div>
            <ul className="space-y-0.5">
              {card.reasonBullets.map((b, i) => (
                <li key={i} className="text-[11.5px] text-ink/85 leading-snug">
                  ✓ {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions — اذهب · خطة · بدّل · لماذا */}
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          {dirHref ? (
            <a
              href={dirHref}
              target="_blank"
              rel="noopener"
              className="bg-coral text-white text-center font-bold text-xs py-2.5 min-h-[44px] rounded-xl flex items-center justify-center gap-1 active:scale-95 transition"
            >
              🧭 اذهب الآن
            </a>
          ) : (
            <button disabled className="bg-stone-200 text-stone-500 font-bold text-xs py-2.5 min-h-[44px] rounded-xl">
              🧭 بدون موقع
            </button>
          )}
          <button
            onClick={() => router.push(`/trips/${tripId}/plan?add=${place.id}`)}
            className="bg-white border border-sea/30 text-sea font-bold text-xs py-2.5 min-h-[44px] rounded-xl active:scale-95 transition"
          >
            ＋ خطتي
          </button>
          <button
            onClick={() => onSwap?.()}
            disabled={!onSwap}
            className="bg-white border border-line text-muted font-bold text-xs py-2.5 min-h-[44px] rounded-xl disabled:opacity-40 active:scale-95 transition"
          >
            🔄 بدّل
          </button>
          <button
            onClick={() => setWhyOpen((v) => !v)}
            className={`font-bold text-xs py-2.5 min-h-[44px] rounded-xl border active:scale-95 transition ${
              whyOpen ? "bg-sea/10 text-sea border-sea/30" : "bg-white text-muted border-line"
            }`}
          >
            {whyOpen ? "× أخفِ التفاصيل" : "🧠 لماذا هذا؟"}
          </button>
          {/* Save heart — full-width subtle row when not primary */}
          <button
            onClick={toggleSave}
            className={`col-span-2 font-bold text-xs py-2.5 min-h-[44px] rounded-xl border ${
              saved ? "bg-coral/10 text-coral border-coral/40" : "bg-white text-muted border-line"
            }`}
          >
            {saved ? "❤️ محفوظ" : "🤍 احفظ للرحلة"}
          </button>
        </div>
      </div>
    </article>
  );
}
