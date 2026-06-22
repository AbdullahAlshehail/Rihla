"use client";

// Unified trip experience — two tabs: خطتي + اكتشف.
// خطتي embeds the multi-day phase plan; اكتشف embeds search + scored catalogue.
// Small ✨ button in the header for the live decision view (/now).
// All extra routes (/now, /day, /plan, /places) still work as deep links.

import { useState, useMemo } from "react";
import Link from "next/link";
import type {
  Trip, ItineraryDay, ItineraryItem, Place, BudgetAssumptions, Currency,
} from "@/lib/supabase/database.types";
import type { UserTaste } from "@/lib/scoring/userTaste";
import { fmtDayLong, fmtMoneySAR, getRegionForCity } from "@/lib/utils";
import { estimateBudget } from "@/lib/budget/estimator";
import PlanScreen from "@/components/PlanScreen";
import DiscoverPanel from "@/components/DiscoverPanel";
import BudgetSummary from "@/components/BudgetSummary";

type ItemWithPlace = ItineraryItem & { places: Place };
type Tab = "plan" | "discover";

export default function TripScreen({
  trip,
  days,
  items,
  catalogue,
  savedSet,
  hiddenSet,
  userRatings,
  userTaste,
  regionPlacesCount,
  regionPhotoCount,
  budget,
  initialTab = "plan",
}: {
  trip: Trip;
  days: ItineraryDay[];
  items: ItemWithPlace[];
  catalogue: Place[];
  savedSet: Set<string>;
  hiddenSet?: Set<string>;
  userRatings: Map<string, { stars: number | null; verdict: "love" | "meh" | "skip" | null }>;
  userTaste: UserTaste | null;
  regionPlacesCount: number;
  regionPhotoCount: number;
  budget: BudgetAssumptions | null;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const region = getRegionForCity(trip.destination_city);

  // ── Dynamic trip totals ───────────────────────────────────────────────
  const tripStats = useMemo(() => {
    const start = trip.start_date ? new Date(trip.start_date) : null;
    const end = trip.end_date ? new Date(trip.end_date) : null;
    let nDays = days.length;
    if (start && end && nDays === 0) {
      nDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    }

    // Items cost rolled up by currency → SAR via trip rates
    const rates = (trip.rates ?? {}) as Partial<Record<Currency, number>>;
    let placesSar = 0;
    for (const it of items) {
      const cost = it.places.cost_estimate ?? 0;
      if (cost <= 0) continue;
      const rate = rates[it.places.cost_currency] ?? 1;
      placesSar += cost * rate;
    }

    return { nDays, placesSar: Math.round(placesSar) };
  }, [trip.start_date, trip.end_date, trip.rates, days.length, items]);

  // Full budget summary (used by the BudgetSummary widget in the plan tab)
  const budgetSummary = useMemo(() => {
    const placesByDay = days.map((d) =>
      items.filter((x) => x.day_id === d.id).map((it) => ({
        place: {
          cost_estimate: it.places.cost_estimate,
          cost_currency: it.places.cost_currency,
          cost_confidence: it.places.cost_confidence,
        },
        customCostSar: it.custom_cost_sar,
      })),
    );
    return estimateBudget({
      trip: { rates: trip.rates ?? { SAR: 1 }, travelers: trip.travelers },
      flightSar: budget?.flight_total_sar,
      hotelPerNightSar: budget?.hotel_per_night_sar,
      nights: budget?.nights ?? Math.max(0, tripStats.nDays - 1),
      transportDailySar: budget?.transport_daily_sar,
      miscDailySar: budget?.misc_daily_sar,
      placesByDay,
    });
  }, [days, items, trip.rates, trip.travelers, budget, tripStats.nDays]);

  return (
    <main
      className="max-w-2xl mx-auto px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 12px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
      }}
    >
      <Link
        href="/trips"
        className="inline-flex items-center gap-1.5 text-sea text-sm font-bold mb-3 px-3 py-2 min-h-[44px] -mx-3"
      >
        ← رحلاتي
      </Link>

      {/* Compact trip header */}
      <header className="bg-gradient-to-br from-sea via-sea-600 to-sea-700 text-white rounded-2xl p-4 shadow-lg mb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h1 className="font-serif font-extrabold text-2xl leading-tight">{trip.name}</h1>
            <p className="text-[11.5px] opacity-90 mt-0.5">
              📍 {region ? region.ar : (trip.destination_city ?? "—")}
              {trip.start_date && <> · {fmtDayLong(trip.start_date)}</>}
              {trip.travelers && <> · {trip.travelers} شخص</>}
            </p>
            {trip.hotel_name && (
              <p className="text-[11px] opacity-80 mt-1 truncate">🏨 {trip.hotel_name}</p>
            )}
          </div>
          {/* Live "Now" CTA (small, top-right) */}
          <Link
            href={`/trips/${trip.id}/now`}
            className="shrink-0 inline-flex items-center bg-coral text-white font-bold text-[12px] px-3.5 min-h-[44px] rounded-pill border border-white/30 shadow active:scale-95 transition"
            title="٣ خيارات سريعة"
          >
            ✨ الآن
          </Link>
        </div>
        {/* Dynamic stats: duration + total estimated cost + catalogue */}
        <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-white/15 border border-white/20 rounded-xl px-2.5 py-2">
            <div className="opacity-80 text-[10px]">المدة</div>
            <div className="font-extrabold text-base">
              {tripStats.nDays} <span className="text-[11px] font-bold opacity-90">يوم</span>
            </div>
          </div>
          <div className="bg-white/15 border border-white/20 rounded-xl px-2.5 py-2">
            <div className="opacity-80 text-[10px]">إجمالي الخطة</div>
            <div className="font-extrabold text-base">
              {budgetSummary.total > 0
                ? fmtMoneySAR(budgetSummary.total)
                : (tripStats.placesSar > 0 ? fmtMoneySAR(tripStats.placesSar) : "—")}
            </div>
          </div>
        </div>
        {regionPlacesCount > 0 && (
          <div className="mt-2 flex items-center gap-2 text-[10.5px] opacity-95 flex-wrap">
            <span>📚 {regionPlacesCount} مكان جاهز{regionPhotoCount > 0 ? ` · ${regionPhotoCount} بصور` : ""}</span>
            <div className="ms-auto flex items-center gap-2 flex-wrap">
              <Link
                href={`/trips/${trip.id}/bookings`}
                className="inline-flex items-center text-[11.5px] bg-amber-500/30 border border-amber-300/40 px-3 min-h-[36px] rounded-pill active:scale-95 transition"
                title="الحجوزات والتكاليف — طيران، فنادق، تذاكر، مصاريف"
              >
                💼 الحجوزات
              </Link>
              <Link
                href="/profile"
                className="inline-flex items-center text-[11.5px] bg-emerald-500/30 border border-emerald-300/40 px-3 min-h-[36px] rounded-pill active:scale-95 transition"
                title="مراقب التكلفة من Google API"
              >
                💰 التكلفة
              </Link>
              <Link
                href={`/trips/${trip.id}/settings`}
                className="inline-flex items-center text-[11.5px] bg-white/20 border border-white/30 px-3 min-h-[36px] rounded-pill active:scale-95 transition"
              >
                ⚙ تعديل
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Two-tab switcher — sticky for easy thumb access while scrolling */}
      <div
        className="sticky z-20 bg-sand/95 backdrop-blur rounded-2xl shadow-sm border border-line mb-3 flex p-1 gap-2"
        style={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <button
          onClick={() => setTab("plan")}
          className={`flex-1 text-center font-bold text-[13px] py-3 min-h-[44px] rounded-xl transition active:scale-[0.98] ${
            tab === "plan"
              ? "bg-sea text-white shadow"
              : "text-muted hover:text-ink"
          }`}
        >
          📋 خطتي
        </button>
        <button
          onClick={() => setTab("discover")}
          className={`flex-1 text-center font-bold text-[13px] py-3 min-h-[44px] rounded-xl transition active:scale-[0.98] ${
            tab === "discover"
              ? "bg-sea text-white shadow"
              : "text-muted hover:text-ink"
          }`}
        >
          🔍 اكتشف
        </button>
      </div>

      {/* Tab body */}
      {tab === "plan" ? (
        <>
          <PlanScreen
            trip={trip}
            days={days}
            items={items}
            catalogue={catalogue}
            savedSet={savedSet}
            userRatings={userRatings}
            embedded
          />
          {days.length > 0 && (
            <div className="mt-3">
              <BudgetSummary summary={budgetSummary} tripId={trip.id} />
            </div>
          )}
        </>
      ) : (
        <DiscoverPanel
          trip={trip}
          catalogue={catalogue}
          savedSet={savedSet}
          hiddenSet={hiddenSet ?? new Set()}
          userRatings={userRatings}
          userTaste={userTaste}
          days={days}
          items={items}
        />
      )}
    </main>
  );
}
