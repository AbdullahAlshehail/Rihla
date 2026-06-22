"use client";

// "وين أروح الآن؟" — Decision Engine page (Phase 2B redesign).
//
// Stops being a filter page. The user picks an INTENT ("what do I need right
// now?"), the engine returns 1–4 cards labelled by the role they fill, and
// per-intent sub-filters refine without ever appearing as a wall of chips.
//
// All compute is local; zero new Google API calls.

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Place, Trip, Currency } from "@/lib/supabase/database.types";
import {
  decide, type DecisionContext, type UserHistory,
  type Intent, type IntentSubfilters,
  type CoffeeSubfilter, type FoodSubfilter, type PhotoSubfilter,
  type NowCardData, type CardLabel,
  INTENT_META,
  timeBudgetFromMinutes, timeBudgetStatusAr,
} from "@/lib/decision/engine";
import { pickCardsByIntent } from "@/lib/decision/pickCards";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { fmtMins } from "@/lib/utils";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import NowCard from "@/components/NowCard";

const LiveReplanSheet = dynamic(() => import("@/components/LiveReplanSheet"), {
  ssr: false,
});

const BUDGET_PER_DAY_SAR: Record<NonNullable<Trip["budget_style"]>, number> = {
  economical: 250,
  mid: 600,
  luxury: 1500,
};

function minutesUntilEndOfDay(now: Date): number {
  const end = new Date(now);
  end.setHours(23, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 60000));
}

// Primary intents are always visible (7 buttons)
const PRIMARY_INTENTS: Intent[] = [
  "decide_for_me", "near_safe", "light_easy", "coffee", "food", "photo", "before_hotel",
];
// Extra intents shown after "+ مزيد" — some are conditional (sunset/nightlife
// by clock; family/luxury/trending/local/quiet are always available).
const EXTRA_INTENTS: Intent[] = [
  "sunset", "nightlife", "family", "luxury", "trending", "local", "quiet",
];

function isIntentVisible(i: Intent, hour: number, hasHotel: boolean): boolean {
  if (i === "sunset")       return hour >= 16 && hour < 21;
  if (i === "nightlife")    return hour >= 19;
  if (i === "before_hotel") return hasHotel;
  return true;
}

// Sub-filter chip catalogs
const COFFEE_SUBFILTERS: Array<{ key: CoffeeSubfilter; ar: string; emoji: string }> = [
  { key: "specialty",     ar: "قهوة مختصة",  emoji: "☕" },
  { key: "quiet_seating", ar: "هادي",          emoji: "🧘" },
  { key: "photogenic",    ar: "للتصوير",      emoji: "📸" },
  { key: "pastry",        ar: "بيستري",       emoji: "🥐" },
  { key: "trending",      ar: "ترند",          emoji: "🔥" },
  { key: "near",          ar: "قريب",          emoji: "📍" },
  { key: "outdoor",       ar: "جلسات خارجية", emoji: "🌿" },
];
const FOOD_SUBFILTERS: Array<{ key: FoodSubfilter; ar: string; emoji: string }> = [
  { key: "quick",  ar: "سريع وقريب", emoji: "⚡" },
  { key: "local",  ar: "محلي",        emoji: "🇸🇦" },
  { key: "family", ar: "عائلي",       emoji: "👨‍👩‍👧" },
  { key: "luxury", ar: "فاخر",        emoji: "💎" },
  { key: "budget", ar: "اقتصادي",    emoji: "💵" },
  { key: "dinner", ar: "عشاء",        emoji: "🌙" },
];
const PHOTO_SUBFILTERS: Array<{ key: PhotoSubfilter; ar: string; emoji: string }> = [
  { key: "view",     ar: "إطلالة",   emoji: "🌇" },
  { key: "sunset",   ar: "غروب",     emoji: "🌅" },
  { key: "rooftop",  ar: "روف توب",  emoji: "🏙" },
  { key: "monument", ar: "معلم",     emoji: "🏛" },
  { key: "interior", ar: "ديكور",    emoji: "✨" },
  { key: "nature",   ar: "طبيعة",    emoji: "🌿" },
];

export default function NowScreen({
  trip,
  places,
  userHistory,
  initialSavedSet,
}: {
  trip: Trip;
  places: Place[];
  userHistory: UserHistory;
  initialSavedSet: Set<string>;
}) {
  const [now, setNow] = useState(() => new Date());
  const [intent, setIntent] = useState<Intent>("decide_for_me");
  const [showExtraIntents, setShowExtraIntents] = useState(false);
  const [coffeeSubs, setCoffeeSubs] = useState<Set<CoffeeSubfilter>>(() => new Set());
  const [foodSubs, setFoodSubs] = useState<Set<FoodSubfilter>>(() => new Set());
  const [photoSubs, setPhotoSubs] = useState<Set<PhotoSubfilter>>(() => new Set());
  const [showMore, setShowMore] = useState(false);
  const [skipMap, setSkipMap] = useState<Partial<Record<CardLabel, number>>>({});
  const [useBudget, setUseBudget] = useState(true);
  const [forceHotelAnchor, setForceHotelAnchor] = useState(false);
  const [replanOpen, setReplanOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const geo = useGeoLocation();
  const liveLocation = geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng } : null;
  const hotelLocation = useMemo(
    () => trip.hotel_lat != null && trip.hotel_lng != null
      ? { lat: trip.hotel_lat, lng: trip.hotel_lng } : null,
    [trip.hotel_lat, trip.hotel_lng],
  );

  // Anchor selection: live if granted (and not forced to hotel), else hotel,
  // else null (we'll show an anchor picker).
  const currentLocation = !forceHotelAnchor ? liveLocation : null;
  const refLocation = currentLocation ?? hotelLocation;
  const anchorKind: "live" | "hotel" | "none" =
    currentLocation ? "live" : hotelLocation ? "hotel" : "none";

  const budgetPerDay = trip.budget_style ? BUDGET_PER_DAY_SAR[trip.budget_style] : 600;
  const minLeft = minutesUntilEndOfDay(now);
  const timeBudget = timeBudgetFromMinutes(minLeft);
  const hour = now.getHours();

  // Build decisions for every place. Budget is "soft" by default (a tilt + a
  // risk note) — never a hard exclusion. The user can also toggle it off.
  const decisions = useMemo(() => {
    const ctx: DecisionContext = {
      now,
      currentLocation,
      hotelLocation,
      budgetRemainingSar: useBudget ? budgetPerDay : undefined,
      budgetMode: useBudget ? "soft" : "off",
      userHistory,
      rates: (trip.rates as Partial<Record<Currency, number>>) ?? undefined,
    };
    return places.map((p) => {
      const smart = computeSmartScore(p, {
        now,
        userLocation: currentLocation,
        hotelLocation,
        budgetStyle: trip.budget_style,
        userSaved: initialSavedSet.has(p.id),
        userRating: userHistory.ratings[p.id] ?? null,
        userVerdict: (userHistory.verdicts[p.id] as "love" | "meh" | "skip" | null) ?? null,
      });
      const decision = decide(p, { ...ctx, smartScore: smart.score });
      return { place: p, decision };
    });
  }, [
    places, now, currentLocation, hotelLocation, useBudget, budgetPerDay,
    userHistory, initialSavedSet, trip.budget_style, trip.rates,
  ]);

  const subfilters = useMemo<IntentSubfilters>(() => ({
    coffee: coffeeSubs,
    food: foodSubs,
    photo: photoSubs,
  }), [coffeeSubs, foodSubs, photoSubs]);

  const picks = useMemo(() => {
    return pickCardsByIntent(decisions, {
      now,
      currentLocation,
      hotelLocation,
      budgetRemainingSar: useBudget ? budgetPerDay : undefined,
      budgetMode: useBudget ? "soft" : "off",
      userHistory,
      rates: (trip.rates as Partial<Record<Currency, number>>) ?? undefined,
      intent,
      timeBudget,
      subfilters,
      useBudget,
      extraCount: 4,
      skip: skipMap,
    });
  }, [
    decisions, now, currentLocation, hotelLocation, useBudget, budgetPerDay,
    userHistory, trip.rates, intent, timeBudget, subfilters, skipMap,
  ]);

  function pickIntent(i: Intent): void {
    setIntent(i);
    setShowMore(false);
    setSkipMap({});
    // Wipe sub-filters that aren't relevant to the new intent so the chips
    // don't silently affect the next intent.
    if (i !== "coffee") setCoffeeSubs(new Set());
    if (i !== "food") setFoodSubs(new Set());
    if (i !== "photo") setPhotoSubs(new Set());
  }

  function swap(label: CardLabel): void {
    setSkipMap((m) => ({ ...m, [label]: (m[label] ?? 0) + 1 }));
  }

  const decisionCtx: DecisionContext = {
    now,
    currentLocation,
    hotelLocation,
    budgetRemainingSar: useBudget ? budgetPerDay : undefined,
    budgetMode: useBudget ? "soft" : "off",
    userHistory,
    rates: (trip.rates as Partial<Record<Currency, number>>) ?? undefined,
  };

  return (
    <main
      className="max-w-2xl mx-auto px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 10px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
      }}
    >
      {/* Back chip — sticky on top with backdrop blur so it stays reachable
          while scrolling. Uses thumb-friendly 44px tap height and the iOS
          safe-area inset so it never overlaps the notch. */}
      <div
        className="sticky z-20 -mx-4 px-4 pb-2 bg-sand/85 backdrop-blur-sm"
        style={{ top: "env(safe-area-inset-top)" }}
      >
        <Link
          href={`/trips/${trip.id}`}
          className="inline-flex items-center gap-1.5 bg-white border border-line text-sea text-sm font-bold px-3 py-2 rounded-pill shadow-sm min-h-[44px] active:scale-95 transition"
        >
          <span>←</span>
          <span className="line-clamp-1 max-w-[200px]">{trip.name}</span>
        </Link>
      </div>

      {/* ─── Context Header ────────────────────────────────────────────── */}
      <header className="bg-gradient-to-br from-sea via-sea-600 to-sea-700 text-white rounded-2xl p-3.5 shadow-md mb-2 mt-1">
        <h1 className="font-serif font-extrabold text-2xl">وين أروح الآن؟</h1>

        {/* Context line: city + anchor (toggleable) */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] opacity-95">
          <span>📍 {trip.destination_city ?? "—"}</span>
          {anchorKind === "live" && (
            <button
              onClick={() => hotelLocation && setForceHotelAnchor(true)}
              disabled={!hotelLocation}
              className="inline-flex items-center bg-white/15 hover:bg-white/25 disabled:opacity-60 px-3 min-h-[36px] rounded-pill text-[12px] font-bold transition active:scale-95"
              title={hotelLocation ? "اضغط لتبديل نقطة البداية إلى الفندق" : ""}
            >
              📍 من موقعك
            </button>
          )}
          {anchorKind === "hotel" && (
            <button
              onClick={() => liveLocation && setForceHotelAnchor(false)}
              disabled={!liveLocation}
              className="inline-flex items-center bg-white/15 hover:bg-white/25 disabled:opacity-60 px-3 min-h-[36px] rounded-pill text-[12px] font-bold transition active:scale-95"
              title={liveLocation ? "اضغط لاستخدام موقعك الحالي" : ""}
            >
              🏨 من فندقك
            </button>
          )}
        </div>

        {/* Time + optional budget */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] opacity-95">
          <span>⏱ باقي {fmtMins(minLeft)}</span>
          {useBudget && trip.budget_style && (
            <button
              onClick={() => setUseBudget(false)}
              className="inline-flex items-center bg-white/15 hover:bg-white/25 px-3 min-h-[36px] rounded-pill text-[12px] font-bold transition active:scale-95"
              title="اضغط للتجاهل في الترتيب"
            >
              💰 {budgetPerDay} ر.س
            </button>
          )}
          {!useBudget && trip.budget_style && (
            <button
              onClick={() => setUseBudget(true)}
              className="inline-flex items-center bg-white/15 hover:bg-white/25 px-3 min-h-[36px] rounded-pill text-[12px] font-bold transition active:scale-95"
            >
              💰 تجاهل ميزانية
            </button>
          )}
        </div>

        {/* Status message — depends on time budget */}
        <div className="mt-2 bg-white/15 text-[12px] font-bold leading-snug rounded-lg px-3 py-2">
          💡 {timeBudgetStatusAr(timeBudget)}
        </div>

        {/* Geolocation prompts inline so they never block the page */}
        {anchorKind === "none" && (
          <div className="mt-2 bg-amber-50/95 text-amber-900 text-[11px] rounded-lg px-2.5 py-2 leading-relaxed">
            <div className="font-extrabold mb-1">نحتاج نقطة بداية</div>
            <div className="flex gap-2">
              <button
                onClick={geo.request}
                className="inline-flex items-center bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 min-h-[44px] rounded-pill text-[12px] active:scale-95 transition"
              >
                📍 شارك موقعك
              </button>
              {hotelLocation && (
                <button
                  onClick={() => setForceHotelAnchor(true)}
                  className="inline-flex items-center bg-white text-amber-900 border border-amber-300 font-bold px-3 min-h-[44px] rounded-pill text-[12px] active:scale-95 transition"
                >
                  🏨 ابدأ من فندقك
                </button>
              )}
            </div>
          </div>
        )}
        {geo.status === "asking" && (
          <div className="mt-2 text-[11px] opacity-90">⏳ يطلب موقعك...</div>
        )}
        {geo.status === "denied" && hotelLocation && (
          <div className="mt-2 text-[11px] opacity-90">
            ✓ نستخدم الفندق كنقطة مرجعية
          </div>
        )}
      </header>

      {/* ─── Intent buttons (primary row + "+ مزيد" reveals extras) ───── */}
      <div className="mb-3 -mx-1">
        <div className="flex gap-2 overflow-x-auto pb-1 px-1 snap-x snap-mandatory">
          {PRIMARY_INTENTS
            .filter((i) => isIntentVisible(i, hour, hotelLocation != null))
            .map((i) => {
              const meta = INTENT_META[i];
              const on = intent === i;
              return (
                <button
                  key={i}
                  onClick={() => pickIntent(i)}
                  className={`shrink-0 snap-start px-3 py-2 rounded-pill text-[12px] font-bold border min-h-[44px] flex items-center gap-1 transition active:scale-95 ${
                    on
                      ? "bg-sea text-white border-sea shadow"
                      : "bg-white text-sea border-sky-200 hover:border-sea"
                  }`}
                >
                  <span>{meta.emoji}</span>
                  <span>{meta.ar}</span>
                </button>
              );
            })}
          <button
            onClick={() => setShowExtraIntents((v) => !v)}
            className={`shrink-0 snap-start px-3 py-2 rounded-pill text-[12px] font-bold border min-h-[44px] flex items-center gap-1 transition active:scale-95 ${
              showExtraIntents
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white text-stone-800 border-stone-300 hover:border-stone-500"
            }`}
          >
            <span>{showExtraIntents ? "−" : "+"}</span>
            <span>مزيد</span>
          </button>
        </div>

        {showExtraIntents && (
          <div className="flex gap-2 overflow-x-auto pb-1 px-1 mt-1.5 snap-x snap-mandatory">
            {EXTRA_INTENTS
              .filter((i) => isIntentVisible(i, hour, hotelLocation != null))
              .map((i) => {
                const meta = INTENT_META[i];
                const on = intent === i;
                return (
                  <button
                    key={i}
                    onClick={() => pickIntent(i)}
                    className={`shrink-0 snap-start px-3 py-2 rounded-pill text-[12px] font-bold border min-h-[44px] flex items-center gap-1 transition active:scale-95 ${
                      on
                        ? "bg-coral text-white border-coral shadow"
                        : "bg-white text-coral border-coral/30 hover:border-coral"
                    }`}
                  >
                    <span>{meta.emoji}</span>
                    <span>{meta.ar}</span>
                  </button>
                );
              })}
          </div>
        )}
      </div>

      {/* ─── Sub-filters (only when relevant) ───────────────────────────── */}
      {intent === "coffee" && (
        <SubFilterRow
          chips={COFFEE_SUBFILTERS}
          active={coffeeSubs}
          onToggle={(k) => setCoffeeSubs((s) => {
            const next = new Set(s);
            next.has(k) ? next.delete(k) : next.add(k);
            return next;
          })}
        />
      )}
      {intent === "food" && (
        <SubFilterRow
          chips={FOOD_SUBFILTERS}
          active={foodSubs}
          onToggle={(k) => setFoodSubs((s) => {
            const next = new Set(s);
            next.has(k) ? next.delete(k) : next.add(k);
            return next;
          })}
        />
      )}
      {intent === "photo" && (
        <SubFilterRow
          chips={PHOTO_SUBFILTERS}
          active={photoSubs}
          onToggle={(k) => setPhotoSubs((s) => {
            const next = new Set(s);
            next.has(k) ? next.delete(k) : next.add(k);
            return next;
          })}
        />
      )}

      {/* ─── Cards or empty state ───────────────────────────────────────── */}
      {picks.primary.length === 0 ? (
        <EmptyState
          intent={intent}
          onWidenBudget={() => setUseBudget(false)}
          onSwitchAnchor={() => hotelLocation && setForceHotelAnchor((v) => !v)}
          hasHotel={hotelLocation != null}
          tripId={trip.id}
        />
      ) : (
        <div className="space-y-3">
          {picks.primary.map((card) => (
            <NowCard
              key={`${card.label}-${card.place.id}`}
              card={card}
              ctx={decisionCtx}
              tripId={trip.id}
              initiallySaved={initialSavedSet.has(card.place.id)}
              onSwap={() => swap(card.label)}
            />
          ))}

          {picks.more.length > 0 && !showMore && (
            <button
              onClick={() => setShowMore(true)}
              className="w-full bg-white border-2 border-sea/30 text-sea font-bold text-[13px] py-3 rounded-2xl active:scale-[0.99] transition"
            >
              ↓ اعرض خيارات أكثر ({picks.more.length})
            </button>
          )}
          {showMore && picks.more.map((card) => (
            <NowCard
              key={`more-${card.place.id}`}
              card={card}
              ctx={decisionCtx}
              tripId={trip.id}
              initiallySaved={initialSavedSet.has(card.place.id)}
            />
          ))}
        </div>
      )}

      {/* ─── Live Replan + Day plan quick links ────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setReplanOpen(true)}
          className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white rounded-2xl p-3 shadow-md active:scale-[0.98] transition"
        >
          <div className="text-xl mb-0.5">🔀</div>
          <div className="font-bold text-[12.5px]">غيّرت رأيي</div>
          <div className="text-[10px] opacity-90 mt-0.5">٣ خيارات سريعة</div>
        </button>
        <Link
          href={`/trips/${trip.id}/day`}
          className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl p-3 shadow-md active:scale-[0.98] transition"
        >
          <div className="text-xl mb-0.5">📋</div>
          <div className="font-bold text-[12.5px]">خطة اليوم</div>
          <div className="text-[10px] opacity-90 mt-0.5">٥ مراحل بالتسلسل</div>
        </Link>
      </div>

      <p className="text-[10.5px] text-muted text-center mt-3">
        ✓ بدون أي طلب جديد إلى Google · القرار يُحسب على جهازك
      </p>

      <LiveReplanSheet
        open={replanOpen}
        onClose={() => setReplanOpen(false)}
        trip={trip}
        places={places}
        userHistory={userHistory}
        refLocation={refLocation}
        hotelLocation={hotelLocation}
      />
    </main>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function SubFilterRow<T extends string>({
  chips, active, onToggle,
}: {
  chips: Array<{ key: T; ar: string; emoji: string }>;
  active: Set<T>;
  onToggle: (k: T) => void;
}) {
  return (
    <div className="mb-3 -mx-1">
      <div className="flex gap-2 overflow-x-auto pb-1 px-1">
        {chips.map((c) => {
          const on = active.has(c.key);
          return (
            <button
              key={c.key}
              onClick={() => onToggle(c.key)}
              className={`shrink-0 inline-flex items-center px-3 min-h-[44px] rounded-pill text-[12px] font-bold border transition active:scale-95 ${
                on
                  ? "bg-amber-500 text-white border-amber-500 shadow"
                  : "bg-white text-amber-800 border-amber-200 hover:border-amber-500"
              }`}
            >
              {c.emoji} {c.ar}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({
  intent, onWidenBudget, onSwitchAnchor, hasHotel, tripId,
}: {
  intent: Intent;
  onWidenBudget: () => void;
  onSwitchAnchor: () => void;
  hasHotel: boolean;
  tripId: string;
}) {
  const isCategoryIntent = intent === "coffee" || intent === "food" || intent === "before_hotel";
  return (
    <div className="bg-card border border-line rounded-2xl p-6 text-center mt-4">
      <p className="text-muted text-sm leading-relaxed">
        ما لقيت خياراً ممتازاً مطابقاً.
        <br />
        جرّب أحد هذي:
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          onClick={onWidenBudget}
          className="inline-flex items-center bg-white border border-stone-300 text-stone-800 font-bold text-[13px] px-3.5 min-h-[44px] rounded-pill active:scale-95 transition"
        >
          🔄 تجاهل الميزانية
        </button>
        {hasHotel && (
          <button
            onClick={onSwitchAnchor}
            className="inline-flex items-center bg-white border border-stone-300 text-stone-800 font-bold text-[13px] px-3.5 min-h-[44px] rounded-pill active:scale-95 transition"
          >
            🏨 بدّل نقطة البداية
          </button>
        )}
        {isCategoryIntent && (
          <Link
            href={`/trips/${tripId}/places`}
            className="inline-flex items-center bg-sea text-white font-bold text-[13px] px-3.5 min-h-[44px] rounded-pill active:scale-95 transition"
          >
            🔍 استكشف
          </Link>
        )}
      </div>
    </div>
  );
}
