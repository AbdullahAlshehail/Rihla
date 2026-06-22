"use client";

// Paste-a-Google-Maps-URL → preview → save sheet.
//
// Flow (~1-3s on 4G):
//   1. User pastes URL (auto-pastes from clipboard if granted permission).
//   2. POST /api/places/from-url with { url, save: false } — preview only.
//   3. Show a polished card with photo, name, rating, distance, kind.
//   4. User taps "أضف لرحلتي" → second POST with { url, save: true }.
//
// Net cost on cache hit (place already exists in our catalogue):
//   ~150 ms total — 0 Google API calls.
// Cost on miss:
//   ~1.5s total — 1 short-link redirect + 1 Find-Place + 1 Place-Details.

import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import { photoAtWidth } from "@/lib/images";
import { fmtKm, haversineKm } from "@/lib/utils";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sweet: "🍰",
  sight: "🏛", nature: "🌿", event: "🎭", bar: "🍸",
};
const CAT_AR: Record<string, string> = {
  food: "مطعم", coffee: "قهوة", sweet: "حلويات",
  sight: "معلم", nature: "طبيعة", event: "ترفيه", bar: "بار",
};

type Status =
  | { kind: "idle" }
  | { kind: "loading"; phase: "resolving" | "fetching" }
  | { kind: "preview"; place: Place; source: string; ms: number }
  | { kind: "saved"; place: Place }
  | { kind: "error"; message: string };

export default function AddPlaceFromUrlSheet({
  tripId,
  userLocation,
  hotelLocation,
  onClose,
  onSaved,
}: {
  tripId: string;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  onClose: () => void;
  /** Fired after a successful save so the parent map can re-fetch the saved
   *  set and show the new place's heart immediately. */
  onSaved: (p: Place) => void;
}) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input on mount — keyboard pops up so paste-from-iOS-keyboard
  // suggestion lands immediately above the keyboard.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  async function lookup(targetUrl: string) {
    setStatus({ kind: "loading", phase: "resolving" });
    try {
      // Tiny optimistic-phase swap so the spinner shows "جارٍ التعرف…" for a
      // second before switching to "جارٍ جلب التفاصيل". Pure cosmetic — gives
      // a sense of progress on 4G where the whole call takes ~1.5s.
      const flipPhase = setTimeout(
        () => setStatus({ kind: "loading", phase: "fetching" }),
        400,
      );
      const r = await fetch("/api/places/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, trip_id: tripId, save: false }),
      });
      clearTimeout(flipPhase);
      const data = await r.json();
      if (!r.ok) {
        setStatus({
          kind: "error",
          message:
            data?.error === "not_google_maps_url" ? "الرابط ليس من خرائط جوجل."
            : data?.error === "could_not_parse_url" ? "تعذّر فهم الرابط. جرّب نسخ رابط آخر من Google Maps."
            : data?.error === "place_not_found" ? "ما لقينا المكان. تأكد من الرابط أو جرّب نسخه من جديد."
            : data?.error === "api_unavailable" ? "خدمة الأماكن مؤقتاً غير متاحة. حاول لاحقاً."
            : "حصل خطأ غير متوقّع.",
        });
        return;
      }
      setStatus({
        kind: "preview",
        place: data.place,
        source: data.source,
        ms: data.meta?.ms ?? 0,
      });
    } catch {
      setStatus({ kind: "error", message: "تعذّر الاتصال. تحقق من الإنترنت." });
    }
  }

  async function save() {
    if (status.kind !== "preview") return;
    setStatus({ kind: "loading", phase: "fetching" });
    try {
      const r = await fetch("/api/places/from-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, trip_id: tripId, save: true }),
      });
      const data = await r.json();
      if (!r.ok) {
        setStatus({ kind: "error", message: "فشل الحفظ. حاول مرة ثانية." });
        return;
      }
      setStatus({ kind: "saved", place: data.place });
      onSaved(data.place);
      // Auto-dismiss after a brief celebratory beat.
      setTimeout(onClose, 900);
    } catch {
      setStatus({ kind: "error", message: "تعذّر الحفظ — حاول مرة ثانية." });
    }
  }

  async function tryPasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && /maps\.app\.goo\.gl|google\.com\/maps|goo\.gl\/maps/i.test(text)) {
        setUrl(text);
        // Auto-lookup the moment we have a valid-looking URL — saves a tap.
        void lookup(text);
      }
    } catch {
      // permission denied — fine, the user can paste manually
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1400] bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="إضافة مكان من رابط خرائط جوجل"
    >
      <div
        className="bg-sand w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[88dvh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-sand/95 backdrop-blur-sm border-b border-line-soft px-5 py-3 flex items-center justify-between z-10">
          <h2 className="font-serif font-extrabold text-lg text-ink inline-flex items-center gap-2">
            <span>📍</span>
            <span>أضف مكاناً من Google Maps</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="bg-white border border-line text-stone-700 font-extrabold w-10 h-10 grid place-items-center rounded-full active:scale-95"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Input + paste */}
          <div>
            <label htmlFor="gmap-url" className="block text-[12px] font-bold text-stone-700 mb-2">
              الصق رابط الخرائط
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                id="gmap-url"
                type="url"
                inputMode="url"
                dir="ltr"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://maps.app.goo.gl/…"
                className="flex-1 bg-white border border-line rounded-xl px-3 py-3 min-h-[48px] text-[13px] outline-none focus:border-coral focus:ring-2 focus:ring-coral/20"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={tryPasteFromClipboard}
                aria-label="لصق من الحافظة"
                className="bg-stone-900 text-white font-extrabold text-[12px] px-3 min-h-[48px] rounded-xl active:scale-95 transition shadow-md whitespace-nowrap"
              >
                📋 لصق
              </button>
            </div>
            <p className="text-[10.5px] text-stone-500 mt-2 leading-snug">
              من تطبيق Google Maps: مشاركة → نسخ الرابط. ثم الصقه هنا.
            </p>
          </div>

          {/* Lookup CTA — primary action when URL filled but not yet looked up */}
          {status.kind === "idle" && url.trim().length > 0 && (
            <button
              type="button"
              onClick={() => lookup(url.trim())}
              className="w-full bg-coral text-white font-extrabold text-[14px] py-3 min-h-[48px] rounded-xl active:scale-95 transition shadow-lg"
            >
              🔍 اعرض التفاصيل
            </button>
          )}

          {/* Loading */}
          {status.kind === "loading" && (
            <div className="bg-white border border-line rounded-2xl p-5 flex items-center gap-3">
              <span className="w-5 h-5 rounded-full border-2 border-stone-300 border-t-coral animate-spin" />
              <div className="flex-1">
                <div className="font-bold text-[13px] text-stone-800">
                  {status.phase === "resolving" ? "جارٍ التعرف على الرابط…" : "جارٍ جلب التفاصيل…"}
                </div>
                <div className="text-[10.5px] text-stone-500 mt-0.5">عادة أقل من ثانيتين</div>
              </div>
            </div>
          )}

          {/* Error */}
          {status.kind === "error" && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl px-3 py-3 text-[12.5px] text-rose-900 leading-snug">
              ⚠ {status.message}
              <button
                onClick={() => setStatus({ kind: "idle" })}
                className="block mt-2 text-rose-700 font-bold underline"
              >
                حاول مرة ثانية
              </button>
            </div>
          )}

          {/* Preview card */}
          {status.kind === "preview" && (
            <PreviewCard
              place={status.place}
              source={status.source}
              ms={status.ms}
              userLocation={userLocation}
              hotelLocation={hotelLocation}
              onSave={save}
              onReset={() => { setUrl(""); setStatus({ kind: "idle" }); }}
            />
          )}

          {/* Saved confirmation */}
          {status.kind === "saved" && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-4 text-center">
              <div className="text-3xl mb-1">✨</div>
              <div className="font-extrabold text-[14px] text-emerald-900">
                تم إضافة <span className="text-emerald-700">{status.place.name}</span> إلى محفوظاتك
              </div>
              <div className="text-[11px] text-emerald-700 mt-1">سيظهر على الخريطة فوراً</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Polished preview card ─────────────────────────────────────────────

function PreviewCard({
  place, source, ms, userLocation, hotelLocation, onSave, onReset,
}: {
  place: Place;
  source: string;
  ms: number;
  userLocation: { lat: number; lng: number } | null;
  hotelLocation: { lat: number; lng: number } | null;
  onSave: () => void;
  onReset: () => void;
}) {
  const photo = photoAtWidth(place.photo_url, 600);
  const emoji = CAT_EMOJI[place.category] ?? "📍";
  const catLabel = CAT_AR[place.category] ?? "";
  const anchor = userLocation ?? hotelLocation;
  const km = (anchor && place.lat != null && place.lng != null)
    ? haversineKm(anchor, { lat: place.lat, lng: place.lng })
    : null;
  const sourceBadge = source === "cache" || source === "ftid_match" || source === "near_coords"
    ? "موجود مسبقاً في رحلتك"
    : "تم جلبه من جوجل";

  return (
    <div className="bg-white border border-line rounded-2xl overflow-hidden shadow-lg">
      {/* Photo */}
      <div className={`aspect-[16/9] relative ${photo ? "bg-stone-100" : "bg-gradient-to-br from-stone-100 to-stone-200"} grid place-items-center`}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt={place.name} className="w-full h-full object-cover" loading="eager" decoding="async" />
        ) : (
          <span className="text-6xl opacity-60">{emoji}</span>
        )}
        <span className="absolute top-2 left-2 text-[10px] font-extrabold px-2 py-1 rounded-pill bg-white/95 backdrop-blur text-stone-700 shadow-sm">
          {sourceBadge} · {ms}ms
        </span>
      </div>

      {/* Body */}
      <div className="p-4 text-right space-y-2">
        <div className="flex items-start gap-2 justify-between">
          <h3 className="font-extrabold text-base text-ink leading-snug flex-1">
            {place.name}
          </h3>
          <span className="text-2xl shrink-0">{emoji}</span>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="bg-stone-100 text-stone-700 font-bold px-2 py-1 rounded-pill">
            {emoji} {catLabel}
          </span>
          {place.rating != null && (
            <span className="bg-amber-100 text-amber-900 font-extrabold px-2 py-1 rounded-pill">
              ⭐ {place.rating.toFixed(1)}
              {place.review_count != null && place.review_count > 0 && (
                <span className="text-amber-700 font-normal"> ({place.review_count.toLocaleString("en")})</span>
              )}
            </span>
          )}
          {place.price_level != null && place.price_level > 0 && (
            <span className="bg-stone-100 text-stone-700 font-extrabold px-2 py-1 rounded-pill">
              {"€".repeat(Math.min(4, place.price_level))}
            </span>
          )}
          {km != null && (
            <span className="bg-sky-100 text-sky-900 font-bold px-2 py-1 rounded-pill">
              {userLocation ? "📍" : "🏨"} {fmtKm(km)}
            </span>
          )}
        </div>

        {place.address && (
          <div className="text-[11.5px] text-stone-600 line-clamp-2 leading-snug">
            {place.address}
          </div>
        )}

        {place.ai_summary && (
          <div className="text-[12px] text-stone-700 bg-stone-50 border border-line-soft rounded-xl px-3 py-2 leading-relaxed">
            {place.ai_summary}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={onReset}
            className="bg-white border border-line text-stone-700 font-bold text-[12.5px] py-2.5 min-h-[44px] rounded-xl active:scale-95"
          >
            رابط آخر
          </button>
          <button
            type="button"
            onClick={onSave}
            className="bg-coral text-white font-extrabold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 shadow-lg"
          >
            ✓ أضف لرحلتي
          </button>
        </div>
      </div>
    </div>
  );
}
