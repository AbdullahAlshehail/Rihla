"use client";

// Check-in sheet — opens from PlaceDetailSheet's نظرة tab when the user is
// physically within the 150 m geofence. Collects rating / vibes / shout,
// POSTs the user's REAL GPS to /api/checkins (the server re-validates the
// geofence — never trust the client), then shows a celebration modal with
// the actual points awarded. Anti-cheat: we never fabricate coordinates.

import { useEffect, useMemo, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

const VIBES: { id: string; label: string }[] = [
  { id: "vibes", label: "🔥 أجواء" },
  { id: "coffee", label: "☕ قهوة زينة" },
  { id: "quiet", label: "🤫 هادئ" },
  { id: "family", label: "👨‍👩‍👧 عوايل" },
  { id: "comfy", label: "💺 مريح" },
  { id: "fast", label: "⚡ سريع" },
  { id: "worth", label: "💸 يستاهل" },
  { id: "photos", label: "📸 صور حلوة" },
];

export type CheckinResult = {
  id: string;
  points_awarded: number;
  is_first_visit: boolean;
  rating: number | null;
  vibes: string[] | null;
  shout: string | null;
};

export default function CheckinSheet({
  place,
  coords,
  onClose,
  onSuccess,
}: {
  place: Place;
  /** LIVE GPS position from useGeoLocation — sent as-is to the server. */
  coords: { lat: number; lng: number } | null;
  onClose: () => void;
  /** Fired after the celebration dismisses (or تمام tapped). */
  onSuccess: (checkin: CheckinResult) => void;
}) {
  const [rating, setRating] = useState<number>(0);
  const [vibes, setVibes] = useState<Set<string>>(() => new Set());
  const [shout, setShout] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);

  const emoji = CAT_EMOJI[place.category] ?? "✦";

  // Live points preview — only the parts we can know client-side (base 5,
  // +2 rated, +2 shout, +1 vibes). First-visit +3 and streak +2 are decided
  // by the server; the celebration shows the real total from the response.
  const estPoints = useMemo(() => {
    let p = 5;
    if (rating > 0) p += 2;
    if (shout.trim().length > 0) p += 2;
    if (vibes.size > 0) p += 1;
    return p;
  }, [rating, shout, vibes]);

  async function confirm() {
    if (!coords) {
      setError("ما قدرنا نحدّد موقعك — فعّل GPS وحاول مرة ثانية");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: place.id,
          lat: coords.lat,
          lng: coords.lng,
          rating: rating > 0 ? rating : null,
          vibes: vibes.size > 0 ? [...vibes] : null,
          shout: shout.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok && data.checkin) {
        setResult(data.checkin as CheckinResult);
        return;
      }
      if (res.status === 422 && data?.error === "too_far") {
        setError(
          data.distance_m != null
            ? `ابتعدت عن المكان — تبعد ${Math.round(data.distance_m)}م الآن. لازم تكون ضمن ١٥٠م لتسجّل حضورك.`
            : "ابتعدت عن المكان — لازم تكون ضمن ١٥٠م لتسجّل حضورك.",
        );
      } else if (res.status === 401) {
        setError("سجّل دخولك أولاً لتسجّل حضورك");
      } else if (data?.error === "no_coordinates") {
        setError("هذا المكان ما له إحداثيات مسجّلة");
      } else if (data?.error === "location_required") {
        setError("نحتاج موقعك الفعلي لتسجيل الحضور");
      } else {
        setError("تعذّر تسجيل الحضور — حاول مرة ثانية");
      }
    } catch {
      setError("خطأ في الاتصال — حاول مرة ثانية");
    } finally {
      setSubmitting(false);
    }
  }

  // Celebration auto-dismiss ~5s.
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => onSuccess(result), 5000);
    return () => clearTimeout(t);
  }, [result, onSuccess]);

  // ── Celebration modal ────────────────────────────────────────────────────
  if (result) {
    const pts = result.points_awarded;
    // Reconstruct the breakdown from what we sent + the server's verdict.
    const lines: { t: string; p: number }[] = [{ t: "تسجيل الحضور", p: 5 }];
    if (result.is_first_visit) lines.push({ t: "أول زيارة 🎖", p: 3 });
    if (result.rating != null) lines.push({ t: "قيّمت المكان", p: 2 });
    if (result.shout) lines.push({ t: "كتبت صيحة", p: 2 });
    if (result.vibes && result.vibes.length > 0) lines.push({ t: "وصفت الأجواء", p: 1 });
    const known = lines.reduce((s, l) => s + l.p, 0);
    if (pts - known >= 2) lines.push({ t: "حافظت على سلسلتك 🔥", p: pts - known });
    return (
      <div
        className="fixed inset-0 z-[1700] bg-black/60 animate-backdrop-fade flex items-center justify-center p-6"
        onClick={() => onSuccess(result)}
        role="dialog"
        aria-modal="true"
        aria-label="تم تسجيل حضورك"
      >
        <div
          className="w-full max-w-sm bg-card rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.45)] animate-pop-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative bg-gradient-to-br from-sea to-sea-700 px-5 pt-7 pb-6 text-center overflow-hidden">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(120px 120px at 82% 8%, rgba(224,101,74,.5), transparent)" }}
            />
            <div className="relative text-5xl mb-1.5" aria-hidden="true">{emoji}</div>
            <div className="relative font-extrabold text-[17px] text-white">سجّلت حضورك! 🎉</div>
            <div className="relative text-[12.5px] text-white/80 mt-0.5">{place.name}</div>
            <div className="relative inline-flex items-baseline gap-1 mt-3 bg-white/15 px-4 py-1.5 rounded-pill">
              <span className="text-[26px] font-extrabold text-gold-400">+{pts}</span>
              <span className="text-[13px] text-white font-bold">نقطة 🪙</span>
            </div>
          </div>
          <div className="p-5 pt-4">
            <div className="flex flex-col gap-2">
              {lines.map((l) => (
                <div key={l.t} className="flex items-center justify-between">
                  <span className="text-[12.5px] text-muted">{l.t}</span>
                  <span className="text-[12.5px] font-bold text-ok">+{l.p}</span>
                </div>
              ))}
            </div>
            {result.is_first_visit && (
              <div className="mt-3.5 bg-gold/10 border border-gold rounded-2xl p-3 flex items-center gap-2.5">
                <span className="text-[22px]" aria-hidden="true">🎖</span>
                <span className="text-[12.5px] text-ink font-bold leading-relaxed">
                  أول زيارة لك هنا — أُضيف لجواز أماكنك!
                </span>
              </div>
            )}
            <button
              onClick={() => onSuccess(result)}
              className="mt-4 w-full min-h-[46px] rounded-2xl border border-line bg-card text-ink font-bold text-[13.5px] active:scale-[0.98] transition"
            >
              تمام
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Check-in form sheet ──────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-[1600] bg-black/50 animate-backdrop-fade flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`تسجيل الحضور في ${place.name}`}
    >
      <div
        className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl px-5 pt-3 pb-7 shadow-[0_-12px_40px_rgba(0,0,0,0.3)] animate-sheet-up max-h-[90dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="w-9 h-[5px] bg-ink/30 rounded-full mx-auto mb-4" />
        <div className="text-center">
          <div
            className="w-[70px] h-[70px] rounded-[22px] bg-gradient-to-br from-coral to-coral-600 grid place-items-center text-[34px] mx-auto mb-3 shadow-[0_10px_24px_rgba(224,101,74,0.4)] animate-float"
            aria-hidden="true"
          >
            {emoji}
          </div>
          <div className="inline-flex items-center gap-1.5 bg-ok/15 text-ok text-[11px] font-extrabold px-3 py-1.5 rounded-pill">
            <span aria-hidden="true">📍</span>
            <span>أنت هنا الآن · موقع مؤكّد</span>
          </div>
          <h2 className="font-extrabold text-[19px] text-ink mt-2.5">{place.name}</h2>
        </div>

        {/* Rating */}
        <div className="text-[12.5px] font-extrabold text-ink mt-5 mb-1">كيف كانت تجربتك؟</div>
        <div className="flex justify-center gap-1" role="radiogroup" aria-label="التقييم من ١ إلى ٥ نجوم">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setRating((r) => (r === n ? 0 : n))}
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} نجوم`}
              className={`w-11 h-11 grid place-items-center text-[30px] leading-none transition active:scale-125 ${
                n <= rating ? "text-gold" : "text-line"
              }`}
            >
              ★
            </button>
          ))}
        </div>

        {/* Vibe tags */}
        <div className="text-[12.5px] font-extrabold text-ink mt-4 mb-2">
          وش الأجواء؟ <span className="text-muted font-medium text-[11px]">(اختياري)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {VIBES.map((v) => {
            const on = vibes.has(v.id);
            return (
              <button
                key={v.id}
                onClick={() => setVibes((s) => {
                  const next = new Set(s);
                  if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                  return next;
                })}
                aria-pressed={on}
                className={`min-h-[44px] px-3.5 rounded-pill text-[13px] font-bold border transition active:scale-95 ${
                  on
                    ? "bg-sea text-white border-sea shadow-btn-sea"
                    : "bg-sand text-ink border-line"
                }`}
              >
                {v.label}
              </button>
            );
          })}
        </div>

        {/* Shout */}
        <label className="block text-[12.5px] font-extrabold text-ink mt-4 mb-2" htmlFor="ci-shout">
          صيحة لأصدقائك
        </label>
        <input
          id="ci-shout"
          value={shout}
          onChange={(e) => setShout(e.target.value)}
          maxLength={280}
          placeholder="وش تبي تقول عن المكان؟"
          className="w-full min-h-[46px] rounded-2xl border border-line bg-sand text-ink text-base px-3.5 outline-none focus:border-sea placeholder:text-muted"
        />

        {error && (
          <p className="mt-3 text-[12.5px] font-bold text-danger bg-danger/10 border border-danger/30 rounded-xl p-3 leading-relaxed" role="alert">
            ⚠ {error}
          </p>
        )}

        <button
          onClick={confirm}
          disabled={submitting || !coords}
          className="w-full min-h-[54px] rounded-2xl bg-gradient-to-br from-coral to-coral-600 text-white font-extrabold text-base mt-4 flex items-center justify-center gap-2 shadow-btn active:scale-[0.98] transition disabled:opacity-60"
        >
          <span>{submitting ? "يسجّل حضورك..." : "سجّل حضوري"}</span>
          {!submitting && (
            <span className="bg-white/20 px-2.5 py-0.5 rounded-pill text-[13px]">+{estPoints} 🪙</span>
          )}
        </button>
      </div>
    </div>
  );
}
