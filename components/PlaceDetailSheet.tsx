"use client";

// Tabbed Place Detail sheet (88dvh) — نظرة · من هنا · تقييمات · صور · معلومات.
// نظرة hosts the match bar + the GEOFENCED check-in flow (≤150m, validated
// server-side — we only ever send the user's real GPS). من هنا shows honest
// presence from /api/places/[id]/social. The old long-scroll sections were
// redistributed across the tabs without losing functionality (hydrate,
// enrich, save, add-to-plan, similar rail, navigateTo history all preserved).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import { fmtKm, fmtMins, estimateTravelTimes, haversineKm, formatOpenStatus, parseIntervals, fmtMinOfDay, DAYS_AR, buildDirectionsUrl, buildPlaceUrl } from "@/lib/utils";
import { getHighlightDisplays, getKindDisplay } from "@/lib/highlights";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { bestTimeFor } from "@/lib/google/bestTime";
import { extractMentions, ratingHistogram } from "@/lib/google/reviewKeywords";
import { arNum } from "@/lib/social/format";
import { photoAtWidth } from "@/lib/images";
import { isSpecificEvidence } from "@/lib/trending/evidence";
import TikTokPreview from "@/components/TikTokPreview";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import PhotoGallery from "@/components/PhotoGallery";
import CheckinSheet, { type CheckinResult } from "@/components/CheckinSheet";
import {
  Sparkles, ClipboardList, Bot, FileText, MessageSquare,
  Lightbulb, Phone, Calendar, Compass, Search,
} from "lucide-react";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

const CAT_LABEL: Record<string, string> = {
  food: "مطاعم", coffee: "قهوة", sight: "معالم", nature: "طبيعة",
  event: "ترفيه", sweet: "حلا", bar: "بار",
};

// Relative Arabic time for "last seen as trending" — accurate enough for
// dates within a few months; older dates fall back to the calendar string.
function fmtTrendingAge(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${arNum(diffMin)}د`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `قبل ${arNum(diffHr)} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "قبل يوم";
  if (diffDay < 30) return `قبل ${arNum(diffDay)} يوم`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo === 1) return "قبل شهر";
  if (diffMo < 12) return `قبل ${arNum(diffMo)} أشهر`;
  return date.toLocaleDateString("ar-SA");
}

// Arabic-aware short review count: ١٢٣ or ١.٢k.
function fmtReviewCount(n: number | null | undefined): string {
  if (n == null) return arNum(0);
  return n >= 1000 ? arNum(`${(n / 1000).toFixed(1)}k`) : arNum(n);
}

// Correct Arabic count for the score-transparency factors («N عامل» was
// grammatically wrong for every N ≠ 1).
function fmtFactors(n: number): string {
  if (n === 1) return "عامل واحد";
  if (n === 2) return "عاملان";
  if (n <= 10) return `${arNum(n)} عوامل`;
  return `${arNum(n)} عاملاً`;
}

// ── Review-mention topic filter ─────────────────────────────────────────────
// extractMentions' stopword list misses common intensifiers/adverbs, so chips
// like «للغاية ×5» و«بشدة ×3» slipped through as NLP noise. We filter (never
// fabricate): drop known intensifiers + any token carrying tanwīn (ً ٌ ٍ —
// «وقتًا», «حقًا»…) which marks adverbial forms, never topic nouns.
const MENTION_NOISE = new Set([
  "للغاية", "بشدة", "كثيرا", "كثيراً", "حقا", "حقاً", "تماما", "تماماً",
  "جدا", "جداً", "فعلا", "فعلاً", "ايضا", "أيضا", "ايضاً", "أيضاً",
  "دائما", "دائماً", "احيانا", "أحيانا", "طبعا", "طبعاً", "خصوصا", "خصوصاً",
  "عموما", "عموماً", "بصراحة", "صراحة", "بالتأكيد", "اكيد", "أكيد",
  "وقتا", "وقتاً", "اكثر", "أكثر", "بعض", "غير", "حيث", "عندما", "بشكل",
]);
function isTopicMention(label: string): boolean {
  // U+064B–U+064D = tanwīn fatḥ/ḍamm/kasr — adverbial markers.
  return !MENTION_NOISE.has(label) && !/[ً-ٍ]/.test(label);
}

const CAT_GRADIENT: Record<string, string> = {
  food: "from-orange-200 via-red-200 to-rose-300",
  coffee: "from-amber-100 via-stone-200 to-amber-300",
  sight: "from-sky-200 via-blue-200 to-indigo-300",
  nature: "from-emerald-200 via-green-200 to-teal-300",
  event: "from-purple-200 via-fuchsia-200 to-violet-300",
  sweet: "from-pink-200 via-rose-200 to-fuchsia-300",
  bar: "from-amber-300 via-yellow-300 to-orange-400",
};

type DTab = "overview" | "here" | "reviews" | "photos" | "info";

const TABS: { id: DTab; label: string }[] = [
  { id: "overview", label: "نظرة" },
  { id: "here", label: "من هنا" },
  { id: "reviews", label: "تقييمات" },
  { id: "photos", label: "صور" },
  { id: "info", label: "معلومات" },
];

// Shape of GET /api/places/[id]/social (place_social RPC).
type SocialState = {
  here_now: number;
  mayor: { name: string; avatar: string | null; visits: number; is_me: boolean } | null;
  friends_here: { user_id: string; name: string; avatar: string | null }[];
  me: { checked_in_today: boolean };
};

export default function PlaceDetailSheet({
  place: initialPlace,
  hotel,
  onClose,
  onAddToPlan,
  onSave,
  savedSet,
  catalogue,
}: {
  place: Place;
  hotel?: { lat: number; lng: number; name: string } | null;
  onClose: () => void;
  onAddToPlan?: () => void;
  /** Called with the CURRENTLY-VIEWED place id (post-navigateTo). Was a
   *  no-arg callback before, which captured the initially-opened place
   *  and so saved the wrong place after navigating to a similar one. */
  onSave?: (placeId: string) => void;
  /** Live saved set — drives the heart state for the CURRENT place, not
   *  the originally-opened one. Pass the same set MapScreen uses. */
  savedSet?: Set<string>;
  /** Full place catalogue — when supplied, "similar places nearby" rail
   *  renders below the fact grid in نظرة. Pure client compute, no API. */
  catalogue?: Place[];
}) {
  const [place, setPlace] = useState<Place>(initialPlace);
  // Derive heart state from the CURRENT place id (post-navigateTo), not the
  // initially-opened place — fixes the save-wrong-place bug from the audit.
  const isSaved = savedSet?.has(place.id) ?? false;
  const [enriching, setEnriching] = useState(false);
  const [arabicOnly, setArabicOnly] = useState(false);
  // Navigation stack — every time the user taps a "similar place" card we
  // push the current place here so they can swipe back instead of losing
  // context. The close button still closes the whole sheet.
  const [history, setHistory] = useState<Place[]>([]);
  // "see all similar" expansion — toggles between 10-card carousel and a
  // bigger grid showing up to 20 places.
  const [showAllSimilar, setShowAllSimilar] = useState(false);
  // Active detail tab. Reset to نظرة when navigating to another place.
  const [tab, setTab] = useState<DTab>("overview");
  // Check-in sheet visibility (only reachable when inside the geofence).
  const [showCheckin, setShowCheckin] = useState(false);
  // Hero photo failed to load (blocked CDN / dead reference) — fall back to
  // the category gradient + emoji instead of showing broken-image alt text.
  const [heroFailed, setHeroFailed] = useState(false);
  useEffect(() => { setHeroFailed(false); }, [place.id, place.photo_url]);
  // Ref to the scrollable tab body so we can snap to top when navigating.
  const scrollRef = useRef<HTMLDivElement>(null);

  function navigateTo(p: Place) {
    setHistory((h) => [...h, place]);
    setPlace(p);
    setShowAllSimilar(false);
    setArabicOnly(false);
    setTab("overview");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function goBack() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setPlace(last);
      setShowAllSimilar(false);
      setTab("overview");
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
      return h.slice(0, -1);
    });
  }

  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Hydrate the FULL DB row on mount / navigation. `initialPlace` comes from
  // MapScreen's slim PLACE_MAP_COLUMNS — it drops address/phone/website/
  // photo_urls/cost_estimate/cost_currency/tip/ai_summary/review_summary/
  // open_status_cache/enriched_at etc. Without this fetch, those fields stay
  // null until /enrich runs, and /enrich is skipped for already-fresh places
  // → the user never sees address/phone/website for cached places. We merge
  // onto current state so the hero photo doesn't flash to null mid-render.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/places/${place.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.place) return;
        setPlace((prev) => ({
          ...data.place,
          // Preserve the photo currently on screen — Google re-issues
          // photo_reference values and we'd otherwise see a flash.
          photo_url: prev.photo_url ?? data.place.photo_url,
        }));
      })
      .catch(() => { /* ignore — initial slim row is still usable */ });
    return () => { cancelled = true; };
  }, [place.id]);

  // Auto-enrich from Google in background (cached 9 months, no-op without API
  // key). Tracks tried IDs in a ref so navigated-to places get enriched too,
  // but the enrich-response setPlace doesn't re-fire the effect into a loop.
  const enrichTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!place.google_place_id) return;
    if (enrichTriedRef.current.has(place.id)) return;
    const enrichedAt = place.enriched_at ? new Date(place.enriched_at) : null;
    const stale = !enrichedAt || (Date.now() - enrichedAt.getTime()) > 270 * 24 * 3600 * 1000;
    const missingCritical = !place.photo_url || !place.google_reviews;
    if (!stale && !missingCritical) return;
    enrichTriedRef.current.add(place.id);
    setEnriching(true);
    const currentPhoto = place.photo_url;
    fetch(`/api/places/${place.id}/enrich`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.place) {
          // Preserve the on-screen photo unless we previously had NONE — Google
          // re-issues photo_reference values, and swapping causes a flash.
          const next = data.place as Place;
          if (currentPhoto && next.photo_url !== currentPhoto) {
            next.photo_url = currentPhoto;
          }
          setPlace(next);
        }
      })
      .catch(() => { /* offline / network error — keep the current row as-is */ })
      .finally(() => setEnriching(false));
  }, [place.id, place.google_place_id, place.enriched_at, place.photo_url, place.google_reviews]);

  // ── Social state (presence / mayor / my check-in) — من هنا + check-in ────
  const [social, setSocial] = useState<SocialState | null>(null);
  const [socialLoading, setSocialLoading] = useState(true);
  // "auth" = signed-out (401) → login prompt; "error" = offline/server failure
  // → retry card. Exactly one of skeleton / error / login / content renders in
  // من هنا at a time (audit fix — the old code co-rendered two states on fail).
  const [socialError, setSocialError] = useState<"auth" | "error" | null>(null);
  // Bumped by the إعادة المحاولة button to re-run the fetch effect.
  const [socialRetry, setSocialRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSocial(null);
    setSocialError(null);
    setSocialLoading(true);
    fetch(`/api/places/${place.id}/social`)
      .then(async (r) => {
        const data = r.ok ? await r.json() : null;
        if (cancelled) return;
        if (data && typeof data.here_now === "number") setSocial(data as SocialState);
        else setSocialError(r.status === 401 ? "auth" : "error");
      })
      .catch(() => { if (!cancelled) setSocialError("error"); })
      .finally(() => { if (!cancelled) setSocialLoading(false); });
    return () => { cancelled = true; };
  }, [place.id, socialRetry]);

  const handleCheckinSuccess = useCallback((c: CheckinResult) => {
    void c;
    setShowCheckin(false);
    // A confirmed check-in IS fresh social truth — clear any stale fetch error
    // so من هنا shows the real content instead of the retry card.
    setSocialError(null);
    setSocial((s) => s
      ? { ...s, here_now: s.here_now + 1, me: { checked_in_today: true } }
      : { here_now: 1, mayor: null, friends_here: [], me: { checked_in_today: true } });
  }, []);

  const status = formatOpenStatus(place.opening_hours);
  const highlights = getHighlightDisplays(place.highlights);
  const kind = getKindDisplay(place.kind);

  // Score breakdown — transparent 0-100 scoring (drives the match bar)
  const scoreResult = computeSmartScore(place, {
    hotelLocation: hotel ? { lat: hotel.lat, lng: hotel.lng } : null,
  });

  const costStr = !place.cost_estimate || place.cost_estimate <= 0
    ? "مجاني"
    : place.cost_currency === "SAR"
    ? `${Math.round(place.cost_estimate)} ر.س للشخص`
    : `~${Math.round(place.cost_estimate)} ${place.cost_currency} للشخص`;

  let fromHotel: { walkMin: number; driveMin: number; km: number } | null = null;
  if (hotel && place.lat != null && place.lng != null) {
    const km = haversineKm({ lat: hotel.lat, lng: hotel.lng }, { lat: place.lat, lng: place.lng });
    const t = estimateTravelTimes(km);
    fromHotel = { walkMin: t.walkMin, driveMin: t.driveMin, km };
  }

  // ── Distance from CURRENT location (geolocation) ────────────────────────
  const geo = useGeoLocation();
  const userLoc = geo.coords ? { lat: geo.coords.lat, lng: geo.coords.lng } : null;
  let fromUser: { walkMin: number; driveMin: number; km: number } | null = null;
  if (userLoc && place.lat != null && place.lng != null) {
    const km = haversineKm(userLoc, { lat: place.lat, lng: place.lng });
    const t = estimateTravelTimes(km);
    fromUser = { walkMin: t.walkMin, driveMin: t.driveMin, km };
  }

  // Geofence — client-side preview only; the server re-validates ≤150m.
  const distToPlaceM = fromUser ? fromUser.km * 1000 : null;
  const withinFence = distToPlaceM != null && distToPlaceM <= 150;
  const checkedInToday = social?.me?.checked_in_today ?? false;

  const dirHref = place.lat != null && place.lng != null
    ? buildDirectionsUrl(place)
    : null;
  const photosHref = buildPlaceUrl(place);

  // ── New best-practice UX bits ────────────────────────────────────────────
  const bestTime = useMemo(() => bestTimeFor(place), [place]);
  const histogram = useMemo(() => ratingHistogram(place.google_reviews), [place.google_reviews]);
  // Extract a wider pool, then keep only real topics (see isTopicMention).
  const mentions = useMemo(
    () => extractMentions(place.google_reviews, 12).filter((m) => isTopicMention(m.label)).slice(0, 6),
    [place.google_reviews],
  );
  const similar = useMemo(() => {
    if (!catalogue || catalogue.length === 0 || place.lat == null || place.lng == null) return [];
    // Same category, same city, sorted by distance + kind affinity.
    // Distance is measured from the USER'S CURRENT location when available
    // (so "nearby" actually means nearby to me), otherwise from the place.
    const anchor = userLoc ?? { lat: place.lat!, lng: place.lng! };
    return catalogue
      .filter((p) => p.id !== place.id && p.lat != null && p.lng != null)
      .filter((p) => p.category === place.category)
      .filter((p) => (p.city_label ?? p.city) === (place.city_label ?? place.city))
      .map((p) => {
        const km = haversineKm(anchor, { lat: p.lat!, lng: p.lng! });
        const t = estimateTravelTimes(km);
        return { p, km, walkMin: t.walkMin, driveMin: t.driveMin };
      })
      // Same kind earns a tiny boost so the carousel feels coherent
      .sort((a, b) => {
        const aw = a.p.kind === place.kind ? -0.5 : 0;
        const bw = b.p.kind === place.kind ? -0.5 : 0;
        return a.km + aw - (b.km + bw);
      })
      .slice(0, 20);
  }, [catalogue, place, userLoc]);

  // Clipboard-fallback copied state — drives the "تم النسخ ✓" toast + button
  // glyph (mirrors ShareStudio's copied affordance; no browser alert).
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  // Share button — navigator.share where available, clipboard fallback.
  async function shareThis() {
    const url = photosHref;
    const text = `${place.name}${place.city_label ? ` · ${place.city_label}` : ""}`;
    try {
      if (typeof navigator !== "undefined" && (navigator as Navigator & { share?: unknown }).share) {
        await (navigator as Navigator & { share: (data: { title?: string; text?: string; url?: string }) => Promise<void> }).share({
          title: place.name, text, url,
        });
        return;
      }
    } catch { /* user canceled or blocked */ }
    try {
      await navigator.clipboard?.writeText(`${text}\n${url}`);
      setLinkCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const heroPhoto = place.photo_url ? photoAtWidth(place.photo_url, 800) : null;
  const emoji = CAT_EMOJI[place.category] ?? "✦";
  const catLabel = kind?.ar ?? CAT_LABEL[place.category] ?? place.category;
  const heroDist = fromUser ? `يبعد ${fmtKm(fromUser.km)}` : fromHotel ? `${fmtKm(fromHotel.km)} من فندقك` : null;

  // ── Geofenced check-in button (نظرة) ─────────────────────────────────────
  function renderCheckinBlock() {
    if (place.lat == null || place.lng == null) return null;
    if (checkedInToday) {
      return (
        <div className="min-h-[52px] rounded-2xl bg-ok/15 text-ok border border-ok font-extrabold text-[15px] flex items-center justify-center gap-2 px-3">
          ✓ سجّلت حضورك هنا
        </div>
      );
    }
    if (withinFence) {
      return (
        <button
          onClick={() => setShowCheckin(true)}
          className="w-full min-h-[52px] rounded-2xl bg-gradient-to-br from-coral to-coral-600 text-white font-extrabold text-[15px] flex items-center justify-center gap-2 shadow-btn active:scale-[0.97] transition"
          aria-label={`سجّل حضورك في ${place.name} — أنت هنا`}
        >
          <span aria-hidden="true">📍</span>
          <span>سجّل حضورك · أنت هنا</span>
        </button>
      );
    }
    if (distToPlaceM != null) {
      return (
        <div className="min-h-[52px] rounded-2xl bg-sand border-[1.5px] border-dashed border-line text-muted font-bold text-[12.5px] leading-relaxed flex items-center justify-center gap-2 px-3.5 py-2 text-center">
          🔒 تبعد {fmtKm(distToPlaceM / 1000)} — لازم تكون عند المكان لتسجّل حضورك
        </div>
      );
    }
    if (geo.status === "denied") {
      return (
        <div className="min-h-[52px] rounded-2xl bg-sand border-[1.5px] border-dashed border-line text-muted font-bold text-[12.5px] leading-relaxed flex items-center justify-center gap-2 px-3.5 py-2 text-center">
          📍 الموقع مرفوض — فعّله من إعدادات المتصفّح لتسجيل حضورك
        </div>
      );
    }
    if (geo.status === "unsupported") return null;
    return (
      <button
        onClick={geo.request}
        disabled={geo.status === "asking"}
        className="w-full min-h-[52px] rounded-2xl bg-sea/10 border border-sea/30 text-sea font-extrabold text-[13.5px] flex items-center justify-center gap-2 active:scale-[0.98] transition disabled:opacity-60"
        aria-label="شارك موقعك لتسجيل الحضور"
      >
        <span aria-hidden="true">📍</span>
        <span>{geo.status === "asking" ? "يحدّد موقعك..." : "شارك موقعك للتسجيل"}</span>
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/45 backdrop-blur-sm flex items-end sm:items-center justify-center animate-backdrop-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`تفاصيل ${place.name}`}
    >
      <div className="bg-sand w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-lg h-[88dvh] overflow-hidden animate-sheet-up flex flex-col">
        {/* ── Hero — real photo cover when available, category gradient fallback ── */}
        <div className={`relative shrink-0 h-44 overflow-hidden bg-gradient-to-br ${CAT_GRADIENT[place.category] ?? "from-sand to-line"}`}>
          {heroPhoto && !heroFailed ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={heroPhoto}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover"
                fetchPriority="high"
                decoding="async"
                onError={() => setHeroFailed(true)}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/25" aria-hidden="true" />
            </>
          ) : (
            <>
              <div className="absolute inset-0 grid place-items-center text-[64px]" aria-hidden="true">{emoji}</div>
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/55 to-transparent" aria-hidden="true" />
            </>
          )}
          {/* grab indicator */}
          <div className="absolute top-3 inset-x-0 flex justify-center z-10">
            <div className="w-9 h-[5px] bg-white/70 rounded-full" />
          </div>
          {/* Close button — large + solid + extra shadow so it's visible
              even on bright photos. Stays clear of dynamic-island top inset. */}
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute top-3 left-3 w-12 h-12 grid place-items-center bg-card hover:bg-sand rounded-full font-extrabold text-ink text-lg shadow-[0_2px_12px_rgba(0,0,0,0.25)] active:scale-90 transition z-20 border border-white/60"
            style={{ marginTop: "env(safe-area-inset-top)" }}
          >
            ✕
          </button>
          {/* Back button — only when navigating from a similar place */}
          {history.length > 0 && (
            <button
              onClick={goBack}
              aria-label="السابق"
              title={`الرجوع إلى ${history[history.length - 1].name}`}
              className="absolute top-3 left-[4.25rem] h-12 px-3 bg-card hover:bg-sand rounded-full font-bold text-ink shadow-[0_2px_12px_rgba(0,0,0,0.25)] text-sm gap-1 flex items-center z-20"
              style={{ marginTop: "env(safe-area-inset-top)" }}
            >
              <span className="text-base">‹</span>
              <span>رجوع</span>
            </button>
          )}
          {/* Status pill */}
          <div className="absolute top-4 right-4 z-10">
            <span className={`text-[11px] font-extrabold px-3 py-1 rounded-pill shadow ${
              status.isOpen ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"
            }`}>
              {status.label}
            </span>
          </div>
          {/* Name + meta */}
          <div className="absolute bottom-3 inset-x-4 z-10">
            <h2 className="font-extrabold tracking-tight text-[22px] text-white leading-tight [text-shadow:0_2px_8px_rgba(0,0,0,0.55)] line-clamp-2">
              {place.name}
            </h2>
            <div className="text-[12.5px] text-white/90 mt-0.5 [text-shadow:0_1px_4px_rgba(0,0,0,0.55)]">
              {catLabel} · {place.city_label ?? place.city}
              {heroDist && <> · {heroDist}</>}
            </div>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex gap-1 px-3 pt-1.5 border-b border-line bg-sand shrink-0" role="tablist" aria-label="أقسام تفاصيل المكان">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex-1 h-[38px] text-[13.5px] font-bold relative transition active:scale-95 ${
                  active ? "text-sea" : "text-muted"
                }`}
              >
                {t.label}
                {t.id === "here" && (social?.here_now ?? 0) > 0 && (
                  <span className="absolute top-1 -translate-x-full text-[9px] font-extrabold text-coral-600" aria-hidden="true">●</span>
                )}
                {active && <span className="absolute bottom-0 inset-x-2 h-[3px] bg-sea rounded-full" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {/* ── Tab content — re-keyed so panels cross-fade on switch ── */}
        <div
          key={`${place.id}-${tab}`}
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4 animate-fade-up"
        >
          {/* ═════════════════ نظرة ═════════════════ */}
          {tab === "overview" && (
            <>
              {/* Rating + match bar */}
              <div className="flex items-center gap-3.5 bg-card border border-line rounded-2xl p-3.5">
                <div className="text-center shrink-0">
                  <div className="text-[30px] font-extrabold text-gold leading-none">
                    {place.rating != null ? place.rating.toFixed(1) : "—"}
                  </div>
                  <div className="text-[11px] text-muted mt-1">
                    ★ {fmtReviewCount(place.review_count)} تقييم
                  </div>
                </div>
                <div className="w-px h-10 bg-line shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-bold text-sea">يناسبك {arNum(scoreResult.score)}٪</span>
                    <span className="text-[10.5px] text-muted">شفافية الاقتراح</span>
                  </div>
                  <div className="h-2 rounded-pill bg-line mt-1.5 overflow-hidden">
                    <div className="h-full bg-sea rounded-pill" style={{ width: `${scoreResult.score}%` }} />
                  </div>
                  <div className="text-[11px] text-muted mt-1.5 leading-relaxed line-clamp-2">✨ {scoreResult.reasonAr}</div>
                  <details className="text-[11px] mt-1">
                    <summary className="cursor-pointer font-bold text-sea min-h-[24px]">
                      ليش هذا التقييم؟ ({fmtFactors(scoreResult.parts.length)})
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {scoreResult.parts.map((p, i) => (
                        <li key={i} className={`flex justify-between items-baseline gap-2 py-0.5 ${
                          p.tone === "good" ? "text-ok" :
                          p.tone === "warn" ? "text-gold" :
                          p.tone === "bad" ? "text-danger" : "text-muted"
                        }`}>
                          <span>{p.label}</span>
                          <span className="font-bold">{p.points > 0 ? `+${arNum(p.points)}` : arNum(p.points)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </div>

              {/* Geofenced check-in */}
              {renderCheckinBlock()}

              {/* Mayor strip */}
              {social?.mayor && (
                <div className="flex items-center gap-3 bg-gold/10 border border-gold rounded-2xl px-3.5 py-3">
                  <span
                    className="w-10 h-10 rounded-full bg-gold text-white grid place-items-center text-lg font-extrabold shrink-0"
                    aria-hidden="true"
                  >
                    {social.mayor.avatar || social.mayor.name.slice(0, 1)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-extrabold text-ink">
                      👑 {social.mayor.is_me ? "أنت العُمدة! 👑" : `عُمدة المكان: ${social.mayor.name}`}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {arNum(social.mayor.visits)} زيارة{social.mayor.is_me ? " · حافظ على لقبك" : " · سجّل أكثر لتاخذ اللقب"}
                    </div>
                  </div>
                </div>
              )}

              {/* 🔥 Trending — append-only per spec; stays even if a later scan
                  doesn't surface this place. The proof link must be VENUE-
                  SPECIFIC (a real post naming this place) — legacy rows whose
                  only evidence is a generic discover/search page get a
                  flagged note instead of a proof link (owner rule 2026-07). */}
              {(place.trending_score ?? 0) >= 50 && (() => {
                const specificEv = place.trending_evidence?.find(
                  (e) => e.url && isSpecificEvidence(e.url),
                );
                const hasOnlyGeneric = !specificEv && (place.trending_evidence?.length ?? 0) > 0;
                const updatedAt = place.trending_updated_at
                  ? new Date(place.trending_updated_at)
                  : null;
                const ageText = updatedAt ? fmtTrendingAge(updatedAt) : null;
                return (
                  <div className="bg-gradient-to-l from-pink-50 to-orange-50 dark:from-pink-500/10 dark:to-orange-500/10 border-2 border-danger/30 rounded-2xl p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 font-extrabold text-danger text-[12px]">
                        <span className="text-[15px]">🔥</span>
                        <span>ترند · {arNum(place.trending_score ?? 0)}/١٠٠</span>
                      </div>
                      {ageText && (
                        <span className="text-[10px] font-bold text-danger bg-card/70 px-2 py-0.5 rounded-pill">
                          {ageText}
                        </span>
                      )}
                    </div>
                    {specificEv?.url && <TikTokPreview url={specificEv.url} />}
                    {hasOnlyGeneric && (
                      <p className="text-[10.5px] font-bold text-muted">
                        بحث عام — غير مؤكد · ما لقينا منشوراً محدداً يذكر المكان
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* 📞 احجز — tap-to-act row for reservation places. */}
              {(place.reservation_level === "required" || place.reservation_level === "recommended") && (() => {
                const required = place.reservation_level === "required";
                const bookSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(
                  `book ${place.name} ${place.city_label ?? place.city ?? ""}`.trim(),
                )}`;
                return (
                  <section className={`rounded-2xl border-2 p-3.5 ${
                    required ? "bg-danger/10 border-danger/30" : "bg-gold/10 border-gold/30"
                  }`}>
                    <div className={`text-[12px] font-extrabold mb-2 inline-flex items-center gap-1.5 ${
                      required ? "text-danger" : "text-gold"
                    }`}>
                      <Phone size={14} aria-hidden="true" />
                      <span>{required ? "هذا المكان يتطلّب حجزاً مسبقاً" : "يُفضّل الحجز المسبق"}</span>
                    </div>
                    <div className="flex gap-2">
                      {place.phone && (
                        <a
                          href={`tel:${place.phone}`}
                          aria-label={`اتصل للحجز على ${place.phone}`}
                          className="flex-1 min-h-[48px] rounded-2xl bg-sea text-white font-extrabold text-[13px] flex items-center justify-center gap-1.5 shadow active:scale-[0.98] transition"
                        >
                          <span aria-hidden="true">📞</span>
                          <span>اتصل الآن</span>
                        </a>
                      )}
                      <a
                        href={bookSearchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`ابحث عن حجز أونلاين لـ${place.name}`}
                        className={`flex-1 min-h-[48px] rounded-2xl font-extrabold text-[13px] flex items-center justify-center gap-1.5 active:scale-[0.98] transition ${
                          place.phone
                            ? "bg-card border-2 border-sea/30 text-sea"
                            : "bg-sea text-white shadow"
                        }`}
                      >
                        <span aria-hidden="true">🌐</span>
                        <span>احجز أونلاين ↗</span>
                      </a>
                    </div>
                  </section>
                );
              })()}

              {/* Best for (highlights) */}
              {highlights.length > 0 && (
                <section className="bg-gold/10 border border-gold/30 rounded-2xl p-3.5">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
                    <Sparkles size={14} aria-hidden="true" />
                    <span>أفضل ما في هذا المكان</span>
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {highlights.map((h) => (
                      <span
                        key={h.ar}
                        className="bg-card border border-gold/30 text-gold-safe text-[11.5px] font-bold px-2.5 py-1 rounded-pill"
                      >
                        {h.emoji} {h.ar}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Practical considerations */}
              {(place.priority === "P1" || place.seasonal || place.reservation_level === "required" || place.practical_warning) && (
                <section className="bg-card border border-line rounded-2xl p-3.5 space-y-2">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide inline-flex items-center gap-1.5">
                    <ClipboardList size={14} aria-hidden="true" />
                    <span>معلومات عملية</span>
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {place.priority === "P1" && (
                      <span className="bg-ok/10 text-ok font-bold px-2.5 py-1 rounded-pill border border-ok/30 text-[11.5px]">
                        ⭐ مميز · مرشّح يدوياً
                      </span>
                    )}
                    {place.reservation_level === "required" && (
                      <span className="bg-danger/10 text-danger font-bold px-2.5 py-1 rounded-pill border border-danger/30 text-[11.5px]">
                        📞 احجز مسبقاً
                      </span>
                    )}
                    {place.reservation_level === "recommended" && (
                      <span className="bg-gold/10 text-gold-safe font-bold px-2.5 py-1 rounded-pill border border-gold/30 text-[11.5px]">
                        📞 يُفضّل الحجز
                      </span>
                    )}
                    {place.seasonal && (
                      <span className="bg-gold/10 text-gold-safe font-bold px-2.5 py-1 rounded-pill border border-gold/30 text-[11.5px]">
                        ☀ موسمي
                      </span>
                    )}
                    {place.best_time && (
                      <span className="bg-sea/10 text-sea font-bold px-2.5 py-1 rounded-pill border border-sea/30 text-[11.5px]">
                        ⏰ {place.best_time}
                      </span>
                    )}
                    {bestTime && (
                      <span className="bg-sea/10 text-sea font-bold px-2.5 py-1 rounded-pill border border-sea/30 text-[11.5px]">
                        {bestTime.emoji} الأفضل: {bestTime.ar}
                      </span>
                    )}
                  </div>
                  {place.practical_warning && (
                    <p className="text-[12.5px] text-ink leading-relaxed bg-gold/10 border border-gold/30 rounded-xl p-2.5 mt-1">
                      ⚠ {place.practical_warning}
                    </p>
                  )}
                </section>
              )}

              {/* Insider tip */}
              {place.tip && place.tip !== place.review_summary && (
                <section className="bg-card border border-line rounded-2xl p-3.5">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-1 inline-flex items-center gap-1.5">
                    <Lightbulb size={14} aria-hidden="true" />
                    <span>نصيحة سريعة</span>
                  </h3>
                  <p className="text-[12.5px] text-ink/85 leading-relaxed">{place.tip}</p>
                </section>
              )}

              {/* Fact grid — status / price / walk-from-hotel / in-plan */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-card border border-line rounded-2xl p-3">
                  <div className="text-[11px] text-muted">الحالة</div>
                  <div className={`text-[13.5px] font-bold mt-1 ${status.isOpen ? "text-ok" : "text-danger"}`}>
                    {status.label}{status.todayHours ? ` · ${status.todayHours}` : ""}
                  </div>
                </div>
                <div className="bg-card border border-line rounded-2xl p-3">
                  <div className="text-[11px] text-muted">متوسط السعر</div>
                  <div className="text-[13.5px] font-bold text-ink mt-1">
                    {costStr}
                    {place.price_level != null && place.price_level > 0 && (
                      <span className="text-muted font-normal"> · {"€".repeat(place.price_level)}</span>
                    )}
                  </div>
                </div>
                <div className="bg-card border border-line rounded-2xl p-3">
                  <div className="text-[11px] text-muted">{fromUser ? "من موقعك" : "من الفندق"}</div>
                  <div className="text-[13.5px] font-bold text-ink mt-1">
                    {fromUser
                      ? `🚶 ${fmtMins(fromUser.walkMin)} · 🚗 ${fmtMins(fromUser.driveMin)}`
                      : fromHotel
                      ? `🚶 ${fmtMins(fromHotel.walkMin)} · 🚗 ${fmtMins(fromHotel.driveMin)}`
                      : "—"}
                  </div>
                </div>
                <div className="bg-card border border-line rounded-2xl p-3">
                  <div className="text-[11px] text-muted">في خطتك</div>
                  {onAddToPlan ? (
                    <button
                      onClick={onAddToPlan}
                      className="mt-1 text-[12.5px] font-extrabold text-sea active:scale-95 transition min-h-[24px]"
                    >
                      ＋ أضِف للخطة
                    </button>
                  ) : (
                    <div className="text-[13.5px] font-bold text-muted mt-1">—</div>
                  )}
                </div>
              </div>

              {/* Similar places nearby — in-app navigation with back button */}
              {similar.length >= 2 && (() => {
                const visible = showAllSimilar ? similar : similar.slice(0, 10);
                return (
                  <section className="bg-card border border-line rounded-2xl p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide inline-flex items-center gap-1.5">
                        <Search size={14} aria-hidden="true" />
                        <span>أماكن مشابهة قريبة</span>
                      </h3>
                      <span className="text-[10.5px] font-bold text-muted">
                        {userLoc ? "📍 من موقعك" : "من هذا المكان"} · {arNum(visible.length)}/{arNum(similar.length)}
                      </span>
                    </div>
                    <div className={
                      showAllSimilar
                        ? "grid grid-cols-2 gap-2"
                        : "flex gap-2 overflow-x-auto -mx-1 px-1 snap-x snap-mandatory pb-1"
                    }>
                      {visible.map(({ p, km, walkMin, driveMin }) => {
                        const photoSrc = p.photo_url ? photoAtWidth(p.photo_url, 320) : null;
                        const priceStr = p.price_level != null && p.price_level > 0
                          ? "€".repeat(Math.min(4, p.price_level))
                          : null;
                        const kindStr = getKindDisplay(p.kind);
                        return (
                          <button
                            key={p.id}
                            onClick={() => navigateTo(p)}
                            className={`${showAllSimilar ? "" : "shrink-0 snap-start w-40"} text-right bg-sand border border-line rounded-xl overflow-hidden active:scale-[0.98] hover:border-sea transition`}
                          >
                            <div className="aspect-[4/3] bg-line overflow-hidden relative">
                              {photoSrc ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={photoSrc}
                                  alt={p.name}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  decoding="async"
                                />
                              ) : (
                                <div className="w-full h-full grid place-items-center text-3xl opacity-40">
                                  {CAT_EMOJI[p.category] ?? "✦"}
                                </div>
                              )}
                              <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill backdrop-blur-sm flex items-center gap-1">
                                <span>{km < 2 ? "🚶" : "🚗"} {fmtMins(km < 2 ? walkMin : driveMin)}</span>
                                <span className="opacity-70">·</span>
                                <span>{fmtKm(km)}</span>
                              </span>
                              {p.rating != null && (
                                <span className="absolute top-1.5 right-1.5 bg-amber-500/95 text-white text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill backdrop-blur-sm">
                                  ⭐ {p.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                            <div className="p-2 space-y-1">
                              <div className="text-[11.5px] font-extrabold leading-tight line-clamp-2 text-ink">
                                {p.name}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 text-[9.5px]">
                                {kindStr && (
                                  <span className="bg-sea/10 text-sea font-bold px-1.5 py-0.5 rounded">
                                    {kindStr.emoji} {kindStr.ar}
                                  </span>
                                )}
                                {priceStr && (
                                  <span className="text-muted font-bold">{priceStr}</span>
                                )}
                                {p.review_count != null && p.review_count > 0 && (
                                  <span className="text-muted">
                                    ({fmtReviewCount(p.review_count)})
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {similar.length > 10 && (
                      <button
                        onClick={() => setShowAllSimilar((s) => !s)}
                        className="mt-2 w-full text-center bg-sea/5 hover:bg-sea/10 border border-sea/20 text-sea font-bold text-[12px] py-2 rounded-xl active:scale-[0.98] transition"
                      >
                        {showAllSimilar ? "↑ اعرض الأقرب فقط" : `↓ شاهد كل المشابهات (${arNum(similar.length)})`}
                      </button>
                    )}
                  </section>
                );
              })()}

              {/* Actions — sticky above the home indicator */}
              <div
                className="pt-2 sticky bottom-0 bg-sand space-y-2 -mx-4 px-4"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
              >
                <div className="flex gap-2">
                  <a
                    href={photosHref}
                    target="_blank"
                    rel="noopener"
                    className="flex-1 bg-sea text-white font-bold text-sm py-3 rounded-2xl text-center min-h-[48px] flex items-center justify-center shadow"
                    title="افتح صفحة المكان في Google Maps"
                  >
                    🗺 المكان
                  </a>
                  {dirHref && (
                    <a
                      href={dirHref}
                      target="_blank"
                      rel="noopener"
                      className="flex-1 bg-coral text-white font-bold text-sm py-3 rounded-2xl text-center min-h-[48px] flex items-center justify-center shadow"
                      title="الاتجاهات في Google Maps"
                    >
                      🧭 اتجاهات
                    </a>
                  )}
                  {onAddToPlan && (
                    <button
                      onClick={onAddToPlan}
                      className="flex-1 bg-card border border-sea text-sea font-bold text-sm py-3 rounded-2xl min-h-[48px]"
                    >
                      ＋ خطّتي
                    </button>
                  )}
                  <button
                    onClick={shareThis}
                    aria-label={linkCopied ? "تم النسخ" : "مشاركة"}
                    title="مشاركة"
                    className={`w-12 h-12 rounded-2xl grid place-items-center text-xl border active:scale-95 shrink-0 transition ${
                      linkCopied ? "bg-ok/10 border-ok/30 text-ok" : "bg-card border-line text-muted"
                    }`}
                  >
                    {linkCopied ? "✓" : "📤"}
                  </button>
                  {onSave && (
                    <button
                      onClick={() => onSave(place.id)}
                      aria-label={isSaved ? "إلغاء الحفظ" : "احفظ"}
                      className={`w-12 h-12 rounded-full grid place-items-center text-xl border active:scale-90 transition shrink-0 ${
                        isSaved ? "bg-coral text-white border-coral shadow" : "bg-card border-line text-muted"
                      }`}
                    >
                      {isSaved ? "❤️" : "🤍"}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ═════════════════ من هنا ═════════════════ */}
          {tab === "here" && (
            <>
              <div className="relative overflow-hidden flex items-center gap-3.5 bg-gradient-to-br from-sea to-sea-700 rounded-2xl p-4">
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "radial-gradient(90px 90px at 88% 12%, rgba(224,101,74,.4), transparent)" }}
                  aria-hidden="true"
                />
                <div className="relative text-center shrink-0">
                  {/* Honest count — "—" until real data arrives (never fake a 0). */}
                  <div className="text-[34px] font-extrabold text-white leading-none">
                    {social ? social.here_now : "—"}
                  </div>
                  <div className="text-[11px] text-white/80 mt-1">سجّلوا حضورهم الآن</div>
                </div>
                <div className="relative w-px h-10 bg-white/25 shrink-0" aria-hidden="true" />
                <p className="relative flex-1 text-[11.5px] text-white/90 leading-relaxed">
                  أشخاص حقيقيون سجّلوا حضورهم هنا عبر GPS — ما فيه حضور وهمي
                </p>
              </div>

              {socialLoading && (
                <div className="space-y-2" aria-label="يحمّل الحضور">
                  <div className="h-16 bg-card border border-line rounded-2xl animate-pulse" />
                  <div className="h-16 bg-card border border-line rounded-2xl animate-pulse" />
                </div>
              )}

              {/* Fetch failed (offline / server) — single error card with retry.
                  Never co-renders with the empty/login states below. */}
              {!socialLoading && socialError === "error" && social == null && (
                <div className="bg-card border border-line rounded-2xl p-5 text-center">
                  <div className="text-3xl mb-2" aria-hidden="true">📡</div>
                  <p className="text-[13px] font-bold text-ink">تعذّر تحميل من هنا</p>
                  <p className="text-[11.5px] text-muted mt-1 leading-relaxed">
                    تأكد من اتصالك ثم جرّب مرة ثانية
                  </p>
                  <button
                    onClick={() => setSocialRetry((n) => n + 1)}
                    className="mt-3 min-h-[44px] px-5 rounded-pill bg-sea/10 border border-sea/30 text-sea font-extrabold text-[12.5px] active:scale-95 transition"
                  >
                    ↻ إعادة المحاولة
                  </button>
                </div>
              )}

              {!socialLoading && checkedInToday && (
                <div className="flex items-center gap-3 bg-ok/10 border-[1.5px] border-ok rounded-2xl px-3.5 py-3">
                  <div className="w-10 h-10 rounded-full bg-gold text-white grid place-items-center font-extrabold shrink-0" aria-hidden="true">
                    أنا
                  </div>
                  <div className="flex-1">
                    <div className="font-extrabold text-[14px] text-ink">أنت هنا</div>
                    <div className="text-[11px] text-ok mt-0.5">سجّلت حضورك اليوم</div>
                  </div>
                  <span className="text-xl" aria-hidden="true">📍</span>
                </div>
              )}

              {!socialLoading && (social?.friends_here?.length ?? 0) > 0 && (
                <>
                  <div className="text-[12.5px] font-extrabold text-ink px-0.5">أصدقاؤك هنا</div>
                  <div className="flex flex-col gap-2">
                    {social!.friends_here.map((f) => (
                      <div key={f.user_id} className="flex items-center gap-3 bg-card border border-line rounded-2xl px-3.5 py-3">
                        <div className="w-10 h-10 rounded-full bg-sea text-white grid place-items-center font-extrabold shrink-0" aria-hidden="true">
                          {f.avatar || f.name.slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[14px] text-ink truncate">{f.name}</div>
                          <div className="text-[11px] text-muted mt-0.5">سجّل حضوره هنا اليوم</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Real empty state — only when the fetch actually SUCCEEDED
                  (social != null), so it can't co-render with error/login. */}
              {!socialLoading && social != null && social.here_now === 0 && !checkedInToday && (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2" aria-hidden="true">👀</div>
                  <p className="text-[13px] font-bold text-ink">ما في أحد سجّل حضوره هنا الحين</p>
                  <p className="text-[11.5px] text-muted mt-1 leading-relaxed">
                    كن أول من يسجّل حضوره — لازم تكون عند المكان (ضمن ١٥٠م)
                  </p>
                </div>
              )}

              {/* Signed-out (401) — login prompt is its own exclusive state. */}
              {!socialLoading && socialError === "auth" && social == null && (
                <p className="text-[11.5px] text-muted text-center leading-relaxed">
                  سجّل دخولك لعرض من هنا الآن
                </p>
              )}

              <p className="text-[10.5px] text-muted text-center leading-relaxed">
                القائمة تُبنى من تسجيلات حضور حقيقية (GPS ≤ ١٥٠م) وتنتهي صلاحيتها تلقائياً
              </p>
            </>
          )}

          {/* ═════════════════ تقييمات ═════════════════ */}
          {tab === "reviews" && (
            <>
              {/* Rating + histogram */}
              <div className="flex items-center gap-4 bg-card border border-line rounded-2xl p-3.5">
                <div className="text-center shrink-0">
                  <div className="text-4xl font-extrabold text-ink leading-none">
                    {place.rating != null ? place.rating.toFixed(1) : "—"}
                  </div>
                  <div className="text-[11px] text-muted mt-1.5">
                    {fmtReviewCount(place.review_count)} تقييم
                  </div>
                </div>
                <div className="flex-1 space-y-1">
                  {(histogram.length > 0 ? histogram : [5, 4, 3, 2, 1].map((s) => ({ stars: s, count: 0, pct: 0 }))).map((h) => (
                    <div key={h.stars} className="flex items-center gap-2 text-[11px]">
                      <span className="w-6 font-bold text-gold-safe">{arNum(h.stars)}★</span>
                      <div className="flex-1 h-2 bg-sand rounded-full overflow-hidden">
                        <div className="h-full bg-gold rounded-full" style={{ width: `${h.pct}%` }} />
                      </div>
                      <span className="w-9 text-left text-muted font-bold tabular-nums">{arNum(h.pct)}٪</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI-summarized review (when Groq key set) */}
              {place.ai_summary && (
                <section className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-500/15 dark:to-purple-500/15 border border-purple-200 dark:border-violet-400/30 rounded-2xl p-4">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
                    <Bot size={14} aria-hidden="true" />
                    <span>ملخّص ذكي لمراجعات Google</span>
                  </h3>
                  <p className="text-[13px] text-ink leading-relaxed">{place.ai_summary}</p>
                </section>
              )}

              {/* Manual analyzed summary (our curated paragraphs) */}
              {place.review_summary && (
                <section className="bg-card border border-line rounded-2xl p-4">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
                    <FileText size={14} aria-hidden="true" />
                    <span>تحليل المكان</span>
                  </h3>
                  <p className="text-[13.5px] text-ink leading-relaxed">{place.review_summary}</p>
                </section>
              )}

              {/* "Reviews mention" keyword chips — hidden entirely when fewer
                  than 2 real topics survive the noise filter */}
              {mentions.length >= 2 && (
                <section className="bg-card border border-line rounded-2xl p-3.5">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
                    <MessageSquare size={14} aria-hidden="true" />
                    <span>الزوار يذكرون</span>
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {mentions.map((m) => (
                      <span
                        key={m.label}
                        className="bg-sea/10 border border-sea/30 text-sea text-[11.5px] font-bold px-2.5 py-1 rounded-pill"
                      >
                        {m.label}
                        <span className="text-[9.5px] opacity-70 mr-1">×{arNum(m.count)}</span>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Google review snippets — Arabic reviews ranked first */}
              {place.google_reviews && place.google_reviews.length > 0 ? (() => {
                const sorted = [...place.google_reviews].sort((a, b) => {
                  const aAr = a.language === "ar" ? 0 : 1;
                  const bAr = b.language === "ar" ? 0 : 1;
                  return aAr - bAr;
                });
                const arabicCount = sorted.filter((r) => r.language === "ar").length;
                const visible = arabicOnly ? sorted.filter((r) => r.language === "ar") : sorted;
                return (
                  <section id="reviews-section" className="bg-card border border-line rounded-2xl p-4">
                    <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                      <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide inline-flex items-center gap-1.5">
                        <MessageSquare size={14} aria-hidden="true" />
                        <span>آراء من Google ({arNum(sorted.length)})</span>
                      </h3>
                      <div className="flex items-center gap-2">
                        {arabicCount > 0 && (
                          <button
                            onClick={() => setArabicOnly(!arabicOnly)}
                            className={`text-[12px] font-bold px-3 min-h-[36px] rounded-pill border transition active:scale-95 ${
                              arabicOnly
                                ? "bg-ok text-white border-ok"
                                : "bg-ok/10 text-ok border-ok/30"
                            }`}
                            aria-pressed={arabicOnly}
                          >
                            <span aria-hidden="true">🇸🇦</span> {arabicOnly ? "✓ بالعربي فقط" : `${arNum(arabicCount)} عربية`}
                          </button>
                        )}
                        {enriching && <span className="text-[10px] text-muted">⏳ يحدّث...</span>}
                      </div>
                    </div>
                    <div className="space-y-3">
                      {visible.length === 0 && (
                        <p className="text-[12px] text-muted text-center py-2">ما فيه آراء بالعربي لهذا المكان.</p>
                      )}
                      {visible.map((r, i) => {
                        const isArabic = r.language === "ar";
                        return (
                          <div key={i} className="pb-3 last:pb-0 border-b border-line-soft last:border-0">
                            <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
                              <span className="text-[12px] font-bold text-ink flex items-center gap-1.5">
                                {isArabic && (
                                  <span className="bg-ok/15 text-ok text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill">
                                    🇸🇦 رأي عربي
                                  </span>
                                )}
                                {r.author_name ?? "زائر"}
                                {r.rating != null && (
                                  <span className="text-gold font-normal mr-0.5">{"★".repeat(r.rating)}</span>
                                )}
                              </span>
                              {r.relative_time && (
                                <span className="text-[10px] text-muted">{r.relative_time}</span>
                              )}
                            </div>
                            <p
                              className={`text-[12px] leading-relaxed line-clamp-4 ${
                                isArabic ? "text-ink" : "text-ink/75"
                              }`}
                              dir={isArabic ? "rtl" : "auto"}
                            >
                              {r.text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })() : (
                <div className="text-center py-6">
                  {enriching ? (
                    <p className="text-xs text-muted">⏳ نجلب أحدث التقييمات من Google...</p>
                  ) : (
                    <p className="text-[12.5px] text-muted">ما فيه تقييمات محفوظة لهذا المكان بعد</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* ═════════════════ صور ═════════════════ */}
          {tab === "photos" && (
            <>
              <PhotoGallery
                photos={place.photo_urls ?? (place.photo_url ? [place.photo_url] : [])}
                fallbackEmoji={emoji}
                alt={place.name}
              />
              {enriching && (
                <p className="text-[11px] text-muted text-center">
                  ⏳ يجلب الصور من Google...
                </p>
              )}
              {(place.photo_urls?.length ?? (place.photo_url ? 1 : 0)) === 0 && !enriching && (
                <p className="text-[12.5px] text-muted text-center py-4">ما فيه صور محفوظة لهذا المكان</p>
              )}
            </>
          )}

          {/* ═════════════════ معلومات ═════════════════ */}
          {tab === "info" && (
            <>
              {/* Cost + Hours */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card border border-line rounded-2xl p-3">
                  <div className="text-[10.5px] text-muted font-bold mb-1">💰 السعر التقريبي</div>
                  <div className="font-extrabold tracking-tight text-base text-ink">{costStr}</div>
                  {place.cost_confidence && (
                    <div className="text-[10px] text-muted mt-0.5">ثقة {place.cost_confidence === "high" ? "عالية" : place.cost_confidence === "medium" ? "متوسطة" : "منخفضة"}</div>
                  )}
                </div>
                <div className="bg-card border border-line rounded-2xl p-3">
                  <div className="text-[10.5px] text-muted font-bold mb-1">🕐 ساعات اليوم</div>
                  <div className="font-bold text-sm text-ink">{status.todayHours || "—"}</div>
                </div>
              </div>

              {/* Weekly hours */}
              {place.opening_hours && place.opening_hours.length === 7 && !status.freeform && (
                <section className="bg-card border border-line rounded-2xl p-3.5">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
                    <Calendar size={14} aria-hidden="true" />
                    <span>ساعات الأسبوع</span>
                  </h3>
                  <ul className="space-y-1 text-[12px]">
                    {place.opening_hours.map((raw, idx) => {
                      const intervals = parseIntervals(raw);
                      const today = idx === new Date().getDay();
                      const label = !intervals || intervals.length === 0
                        ? "مغلق"
                        : intervals.map(([s, e]) => `${fmtMinOfDay(s)}–${fmtMinOfDay(e === 1440 ? 0 : e)}`).join("، ");
                      return (
                        <li key={idx} className={`flex justify-between ${today ? "font-bold text-sea" : "text-muted"}`}>
                          <span>{DAYS_AR[idx]}{today && " (اليوم)"}</span>
                          <span>{label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Contact — phone (tap-to-call) + website */}
              {(place.phone || place.website) && (
                <section className="bg-card border border-line rounded-2xl p-3.5 space-y-2">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide inline-flex items-center gap-1.5">
                    <Phone size={14} aria-hidden="true" />
                    <span>تواصل</span>
                  </h3>
                  {place.phone && (
                    <a
                      href={`tel:${place.phone}`}
                      className="flex items-center justify-between gap-2 min-h-[44px] -mx-1 px-2 rounded-lg active:bg-sea/5 transition"
                      aria-label={`اتصال على ${place.phone}`}
                    >
                      <span className="text-[13px] font-bold text-ink tabular-nums" dir="ltr">
                        {place.phone}
                      </span>
                      <span className="text-[11px] font-bold text-sea inline-flex items-center gap-1">
                        <span>📞</span><span>اتصل</span>
                      </span>
                    </a>
                  )}
                  {place.website && (() => {
                    let host = place.website;
                    try { host = new URL(place.website).host.replace(/^www\./, ""); } catch { /* keep raw */ }
                    return (
                      <a
                        href={place.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 min-h-[44px] -mx-1 px-2 rounded-lg active:bg-sea/5 transition"
                        aria-label={`زر الموقع الرسمي ${host}`}
                      >
                        <span className="text-[13px] font-bold text-ink line-clamp-1" dir="ltr">
                          {host}
                        </span>
                        <span className="text-[11px] font-bold text-sea inline-flex items-center gap-1">
                          <span>🌐</span><span>الموقع ↗</span>
                        </span>
                      </a>
                    );
                  })()}
                </section>
              )}

              {/* Location & distance + embedded OSM mini-map */}
              {(fromUser || fromHotel || (place.lat != null && place.lng != null)) && (
                <section className="bg-card border border-line rounded-2xl p-3.5">
                  <h3 className="text-[11px] font-extrabold text-sea uppercase tracking-wide mb-2 inline-flex items-center gap-1.5">
                    <Compass size={14} aria-hidden="true" />
                    <span>الموقع والمسافة</span>
                  </h3>
                  {fromUser && (
                    <div className="bg-ok/10 border border-ok/30 rounded-xl p-2.5 mb-2.5">
                      <div className="text-[10.5px] font-extrabold text-ok mb-1.5 flex items-center gap-1">
                        <span>📍</span>
                        <span>من موقعك الحالي</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[12px]">
                        <span className="bg-card border border-ok/30 px-2.5 py-1 rounded-pill font-bold text-ok">
                          🚶 {fmtMins(fromUser.walkMin)} مشي
                        </span>
                        <span className="bg-card border border-ok/30 px-2.5 py-1 rounded-pill font-bold text-ok">
                          🚗 {fmtMins(fromUser.driveMin)} سيارة
                        </span>
                        <span className="bg-ok/15 border border-ok/30 px-2.5 py-1 rounded-pill font-bold text-ok">
                          ↔ {fmtKm(fromUser.km)}
                        </span>
                      </div>
                    </div>
                  )}
                  {!fromUser && geo.status === "denied" && place.lat != null && place.lng != null && (
                    <p className="text-[11px] text-muted mb-2.5">
                      <span aria-hidden="true">📍</span> الموقع مرفوض — فعّله من إعدادات Safari ثم أعد فتح الصفحة
                    </p>
                  )}
                  {!fromUser && geo.status !== "granted" && geo.status !== "denied" && place.lat != null && place.lng != null && (
                    <button
                      onClick={geo.request}
                      disabled={geo.status === "asking"}
                      className="w-full mb-2.5 bg-ok/10 border border-ok/30 hover:bg-ok/15 text-ok rounded-xl px-3 py-2.5 text-[12px] font-extrabold flex items-center justify-between min-h-[44px] active:scale-[0.98] transition disabled:opacity-60"
                    >
                      <span className="flex items-center gap-2">
                        <span>📍</span>
                        <span>{geo.status === "asking" ? "يحدّد موقعك..." : "كم يبعد عني الآن؟"}</span>
                      </span>
                      <span className="text-[10px] font-bold opacity-70">شارك موقعك</span>
                    </button>
                  )}
                  {place.lat != null && place.lng != null && (() => {
                    const d = 0.006; // ~600m bounding box
                    const bbox = `${place.lng - d},${place.lat - d},${place.lng + d},${place.lat + d}`;
                    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${place.lat},${place.lng}`;
                    return (
                      <a
                        href={photosHref}
                        target="_blank"
                        rel="noopener"
                        className="block relative rounded-xl overflow-hidden border border-line mb-2 aspect-[16/9] bg-sand"
                        title="افتح في Google Maps"
                      >
                        <iframe
                          src={src}
                          title={`خريطة ${place.name}`}
                          className="w-full h-full pointer-events-none"
                          loading="lazy"
                          sandbox="allow-scripts allow-same-origin"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent text-white text-[10.5px] font-bold px-3 py-1.5 flex items-center justify-between">
                          <span>📍 {place.address ?? `${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}`}</span>
                          <span>افتح في Google Maps ↗</span>
                        </div>
                      </a>
                    );
                  })()}
                  {fromHotel && (
                    <div className="flex flex-wrap gap-2 text-[12px]">
                      <span className="bg-sand border border-line px-2.5 py-1 rounded-pill font-bold text-ink">
                        🚶 {fmtMins(fromHotel.walkMin)} مشي
                      </span>
                      <span className="bg-sand border border-line px-2.5 py-1 rounded-pill font-bold text-ink">
                        🚗 {fmtMins(fromHotel.driveMin)} سيارة
                      </span>
                      <span className="bg-gold/10 border border-gold/30 px-2.5 py-1 rounded-pill font-bold text-gold">
                        🏨 {fmtKm(fromHotel.km)} من فندقك
                      </span>
                    </div>
                  )}
                  {fromHotel && (
                    <p className="text-[10.5px] text-muted mt-2">
                      * تقديري — قد يختلف بحركة المرور الفعلية
                    </p>
                  )}
                </section>
              )}

              {/* Directions CTA */}
              {dirHref && (
                <a
                  href={dirHref}
                  target="_blank"
                  rel="noopener"
                  className="w-full min-h-[50px] rounded-2xl bg-sea text-white font-extrabold text-[14.5px] flex items-center justify-center gap-2 shadow active:scale-[0.98] transition"
                  title="الاتجاهات في Google Maps"
                >
                  🧭 الاتجاهات
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {/* "تم النسخ ✓" toast — clipboard share fallback (no browser alert) */}
      {linkCopied && (
        <div
          className="fixed inset-x-0 z-[1650] flex justify-center pointer-events-none"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
          role="status"
        >
          <span className="bg-ink text-sand text-[12.5px] font-bold px-4 py-2 rounded-pill shadow-lg animate-fade-up">
            تم النسخ ✓
          </span>
        </div>
      )}

      {/* ── Check-in sheet + celebration — only reachable inside the geofence.
          We pass the LIVE GPS coords; the server re-validates ≤150m. ── */}
      {showCheckin && (
        <CheckinSheet
          place={place}
          coords={userLoc}
          onClose={() => setShowCheckin(false)}
          onSuccess={handleCheckinSuccess}
        />
      )}
    </div>
  );
}
