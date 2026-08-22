"use client";

// Canonical reservation-style PlaceCard (P2 of the redesign).
// Structure — max 8 elements, top → bottom:
//   1. Photo 4:3 (heart + status pill overlays ONLY)
//   2. Title + one badge (editor-pick > verdict)
//   3. One meta line: category · area · price [· distance-when-nearby]
//   4. One "why" line (2-line clamp)
//   5. One primary CTA (أضِف للخطة / في خطتك ✓)
// Everything else — offering chips, review snippet, facts strip, planning meta,
// photo carousel, map link, hide — lives in PlaceDetailSheet now. Card tap opens
// the sheet; the button is the one decisive action.

import { useState, useTransition, memo } from "react";
import dynamic from "next/dynamic";
import type { ItineraryDay, ItineraryItem, Place } from "@/lib/supabase/database.types";
import { fmtKm, nearbyKm, isOpenNow } from "@/lib/utils";
import { getCategoryDisplay } from "@/lib/highlights";
import { scoreVerdict } from "@/lib/google/inferKind";
import type { Offering } from "@/lib/discover/offerings";
import { photoAtWidth } from "@/lib/images";
import { useRouter } from "next/navigation";
import { Card, CardPhoto, Button, StatusPill } from "@/components/ui";
import { CategoryIcon, Icon } from "@/lib/ui/icons";

// Lazy-load the heavy modal — only ships ~25 KB to the client when actually opened
const PlaceDetailSheet = dynamic(() => import("@/components/PlaceDetailSheet"), {
  ssr: false,
});
// QuickAddPicker is light but only mounted on demand
const QuickAddPicker = dynamic(() => import("@/components/QuickAddPicker"), {
  ssr: false,
});

export type PlaceCardAddedInfo = {
  placeName: string;
  dayLabel: string;
  phaseLabel: string;
  phaseEmoji: string;
};

function PlaceCardImpl({
  place,
  tripId,
  score,
  reasonAr,
  initiallySaved = false,
  initiallyHidden = false,
  hotel = null,
  days = [],
  items = [],
  onAdded,
  onHidden,
  precomputedOfferings,
  catalogue,
  userLocation = null,
}: {
  place: Place;
  tripId: string;
  score: number;
  reasonAr: string;
  initiallySaved?: boolean;
  hotel?: { lat: number; lng: number; name: string } | null;
  /** User's current GPS. When nearby (≤100km, nearbyKm guard) the meta line
   *  shows the live distance; far-away users see no misleading "٤٢٠٠كم". */
  userLocation?: { lat: number; lng: number } | null;
  /** Full trip catalogue — forwarded to PlaceDetailSheet's "similar nearby". */
  catalogue?: Place[];
  /** When supplied, "أضف للخطة" opens a quick inline picker instead of navigating. */
  days?: ItineraryDay[];
  items?: ItineraryItem[];
  onAdded?: (info: PlaceCardAddedInfo) => void;
  /** Retained for API compatibility — hide now lives in the detail sheet. */
  initiallyHidden?: boolean;
  onHidden?: (placeId: string, hidden: boolean) => void;
  /** Retained for API compatibility — offerings now render in the detail sheet. */
  precomputedOfferings?: Offering[];
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [open, setOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const cat = getCategoryDisplay(place.category);
  const verdict = scoreVerdict(score, place.category);
  const oh = isOpenNow(place.opening_hours);

  // Single hero photo — CSS-cropped to 4:3 (same URL, no new fetch).
  const heroRaw = place.photo_url ?? (place.photo_urls && place.photo_urls[0]) ?? null;
  const hero = heroRaw ? photoAtWidth(heroRaw, 640) : null;

  // Price — cost estimate when known, else null.
  let priceShort: string | null = null;
  if (place.cost_estimate != null && place.cost_estimate > 0) {
    priceShort = place.cost_currency === "SAR"
      ? `${Math.round(place.cost_estimate)} ر.س`
      : `${Math.round(place.cost_estimate)} ${place.cost_currency}`;
  } else if (place.cost_estimate === 0) {
    priceShort = "مجاني";
  }

  // Live distance ONLY when the user is plausibly in the same area (guard).
  const anchor = userLocation ?? (hotel ? { lat: hotel.lat, lng: hotel.lng } : null);
  const nearKm = nearbyKm(anchor, place);

  // Where is this place already scheduled?
  const scheduledOn = (() => {
    const matches = items.filter((it) => it.place_id === place.id);
    if (matches.length === 0) return null;
    const first = matches[0];
    const dayIdx = days.findIndex((d) => d.id === first.day_id);
    return {
      count: matches.length,
      label: dayIdx >= 0 ? `يوم ${dayIdx + 1}` : "اليوم",
    };
  })();

  async function toggleSave() {
    const prev = saved;
    setSaved(!prev);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/trips/${tripId}/places`, {
          method: prev ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place_id: place.id }),
        });
        if (!r.ok) setSaved(prev);
      } catch {
        setSaved(prev);
      }
    });
  }

  return (
    <>
      {open && (
        <PlaceDetailSheet
          place={place}
          hotel={hotel}
          onClose={() => setOpen(false)}
          onSave={() => toggleSave()}
          savedSet={saved ? new Set([place.id]) : new Set()}
          onAddToPlan={() => router.push(`/trips/${tripId}/map?add=${place.id}`)}
          catalogue={catalogue}
        />
      )}

      <Card>
        {/* ─── Photo (tap → detail sheet) ─── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
          className="cursor-pointer"
          title={reasonAr || undefined}
        >
          <CardPhoto
            src={hero}
            alt={place.name}
            fallback={<CategoryIcon category={place.category} className="w-10 h-10 opacity-40" />}
          >
            {/* Save heart — physical top-right (platform convention) */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleSave(); }}
              aria-label={saved ? "إلغاء الحفظ" : "احفظ"}
              className={`absolute top-3 right-3 w-10 h-10 rounded-full grid place-items-center shadow-lg backdrop-blur-sm transition active:scale-90 ${
                saved ? "bg-coral text-white" : "bg-white/95 text-muted hover:bg-white"
              }`}
            >
              <Icon name="save" fill={saved} className="w-5 h-5" />
            </button>

            {/* Open/closed status — the only other photo overlay */}
            {oh.kind !== "free" && (
              <div className="absolute bottom-3 right-3">
                <StatusPill isOpen={oh.kind === "open"} closeAt={oh.closeAt} />
              </div>
            )}
          </CardPhoto>
        </div>

        {/* ─── Body (tap → detail sheet) ─── */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen(true); }}
          className="text-right px-4 pt-3.5 pb-1 cursor-pointer"
        >
          {/* Title + one badge (editor-pick > verdict) */}
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-serif text-title line-clamp-2 text-ink">
              {place.name}
            </h3>
            {place.is_editor_pick ? (
              <span className="shrink-0 mt-1 inline-flex items-center gap-1 text-micro font-extrabold px-2 py-0.5 rounded-pill bg-gold/15 text-gold-safe">
                <Icon name="editor" className="w-3.5 h-3.5" />
                النخبة
              </span>
            ) : (
              <span className={`shrink-0 mt-1 text-micro font-extrabold px-2 py-0.5 rounded-pill ${verdict.gradientBg} ${verdict.textColor}`}>
                {verdict.ar}
              </span>
            )}
          </div>

          {/* One meta line: category · area · price [· distance-when-nearby] */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted">
            <span className="inline-flex items-center gap-1 font-bold text-ink">
              <CategoryIcon category={place.category} className="w-4 h-4" />
              {cat.ar}
            </span>
            {place.city_label && (
              <><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                <Icon name="area" className="w-3.5 h-3.5" />{place.city_label}
              </span></>
            )}
            {priceShort && (
              <><span aria-hidden>·</span><span className="font-bold text-ink">{priceShort}</span></>
            )}
            {nearKm != null && (
              <><span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5">{fmtKm(nearKm)}</span></>
            )}
          </p>

          {/* One "why" line */}
          {reasonAr && reasonAr.trim().length > 4 && (
            <p className="mt-2 text-subhead text-ink/80 leading-snug line-clamp-2">
              <span className="font-extrabold text-sea">ليش مناسب؟</span> {reasonAr}
            </p>
          )}
        </div>

        {/* ─── One primary action ─── */}
        <div className="px-4 pt-2.5 pb-4">
          {scheduledOn ? (
            <Button
              variant="secondary"
              block
              onClick={(e) => { e.stopPropagation(); setOpen(true); }}
              leftIcon={<Icon name="check" className="w-4 h-4 text-ok" />}
              className="!text-ok !border-ok/40"
            >
              في خطتك · {scheduledOn.label}
            </Button>
          ) : (
            <Button
              variant="primary"
              block
              onClick={(e) => {
                e.stopPropagation();
                if (days.length > 0) setQuickOpen((q) => !q);
                else router.push(`/trips/${tripId}/map?add=${place.id}`);
              }}
              leftIcon={!quickOpen ? <span className="text-base leading-none">＋</span> : undefined}
            >
              {quickOpen ? "إغلاق" : "أضِف للخطة"}
            </Button>
          )}
        </div>

        {/* Inline quick-add picker — only mounted when actually open */}
        {quickOpen && days.length > 0 && (
          <QuickAddPicker
            place={place}
            tripId={tripId}
            days={days}
            items={items}
            saved={saved}
            onSaveToggle={toggleSave}
            onChooseAnother={() => {
              setQuickOpen(false);
              router.push(`/trips/${tripId}/map?add=${place.id}`);
            }}
            onClose={() => setQuickOpen(false)}
            onAdded={onAdded}
          />
        )}
      </Card>
    </>
  );
}

const PlaceCard = memo(PlaceCardImpl);
export default PlaceCard;
