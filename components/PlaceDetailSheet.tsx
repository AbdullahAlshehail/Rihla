"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Place } from "@/lib/supabase/database.types";
import { fmtKm, fmtMins, estimateTravelTimes, haversineKm, formatOpenStatus, parseIntervals, fmtMinOfDay, DAYS_AR, buildDirectionsUrl, buildPlaceUrl } from "@/lib/utils";
import { getHighlightDisplays, getKindDisplay } from "@/lib/highlights";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { bestTimeFor } from "@/lib/google/bestTime";
import { extractMentions, ratingHistogram } from "@/lib/google/reviewKeywords";
import { photoAtWidth } from "@/lib/images";
import TikTokPreview from "@/components/TikTokPreview";
import { useGeoLocation } from "@/lib/geo/useGeoLocation";
import PhotoGallery from "@/components/PhotoGallery";

const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sight: "🏛", nature: "🌿",
  event: "🎭", sweet: "🍰", bar: "🍸",
};

// Relative Arabic time for "last seen as trending" — accurate enough for
// dates within a few months; older dates fall back to the calendar string.
function fmtTrendingAge(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${diffMin}د`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `قبل ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "قبل يوم";
  if (diffDay < 30) return `قبل ${diffDay} يوم`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo === 1) return "قبل شهر";
  if (diffMo < 12) return `قبل ${diffMo} أشهر`;
  return date.toLocaleDateString("ar-SA");
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

export default function PlaceDetailSheet({
  place: initialPlace,
  hotel,
  onClose,
  onAddToPlan,
  onSave,
  saved,
  catalogue,
}: {
  place: Place;
  hotel?: { lat: number; lng: number; name: string } | null;
  onClose: () => void;
  onAddToPlan?: () => void;
  onSave?: () => void;
  saved?: boolean;
  /** Full place catalogue — when supplied, "similar places nearby" rail
   *  renders below the distance section. Pure client compute, no API. */
  catalogue?: Place[];
}) {
  const [place, setPlace] = useState<Place>(initialPlace);
  const [enriching, setEnriching] = useState(false);
  const [arabicOnly, setArabicOnly] = useState(false);
  // Navigation stack — every time the user taps a "similar place" card we
  // push the current place here so they can swipe back instead of losing
  // context. The close button still closes the whole sheet.
  const [history, setHistory] = useState<Place[]>([]);
  // "see all similar" expansion — toggles between 10-card carousel and a
  // bigger grid showing up to 20 places.
  const [showAllSimilar, setShowAllSimilar] = useState(false);
  // Ref to the scrollable sheet body so we can snap to top when navigating.
  const scrollRef = useRef<HTMLDivElement>(null);

  function navigateTo(p: Place) {
    setHistory((h) => [...h, place]);
    setPlace(p);
    setShowAllSimilar(false);
    setArabicOnly(false);
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

  // Auto-enrich from Google in background (cached 30 days, no-op without API key).
  // CRITICAL: only re-fetch when we're genuinely missing the *user-facing*
  // pieces — photo OR reviews. Missing photo_urls (the 2-3 extra gallery
  // shots) is NOT worth a refetch: it forces React to swap the hero img mid-
  // render, which the user sees as a flash of empty space.
  useEffect(() => {
    if (!initialPlace.google_place_id) return;
    const enrichedAt = initialPlace.enriched_at ? new Date(initialPlace.enriched_at) : null;
    // 9-month TTL — places & photos rarely change. User explicitly wants
    // long-life caching to keep Google API spend at $0.
    const stale = !enrichedAt || (Date.now() - enrichedAt.getTime()) > 270 * 24 * 3600 * 1000;
    const missingCritical = !initialPlace.photo_url || !initialPlace.google_reviews;
    if (!stale && !missingCritical) return;
    setEnriching(true);
    fetch(`/api/places/${initialPlace.id}/enrich`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.place) {
          // Preserve the initial photo_url unless we previously had NONE.
          // This stops the hero from flickering when Google returns a
          // different photo_reference on re-enrich.
          const next = data.place as Place;
          if (initialPlace.photo_url && next.photo_url !== initialPlace.photo_url) {
            next.photo_url = initialPlace.photo_url;
          }
          setPlace(next);
        }
      })
      .finally(() => setEnriching(false));
  }, [initialPlace.id, initialPlace.google_place_id, initialPlace.enriched_at, initialPlace.photo_url, initialPlace.google_reviews]);

  const status = formatOpenStatus(place.opening_hours);
  const highlights = getHighlightDisplays(place.highlights);
  const kind = getKindDisplay(place.kind);

  // Score breakdown — transparent 0-100 scoring
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

  const dirHref = place.lat != null && place.lng != null
    ? buildDirectionsUrl(place)
    : null;
  const photosHref = buildPlaceUrl(place);

  // ── New best-practice UX bits ────────────────────────────────────────────
  const bestTime = useMemo(() => bestTimeFor(place), [place]);
  const histogram = useMemo(() => ratingHistogram(place.google_reviews), [place.google_reviews]);
  const mentions = useMemo(() => extractMentions(place.google_reviews, 6), [place.google_reviews]);
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
      alert("نُسخ الرابط ✅");
    } catch { /* ignore */ }
  }

  return (
    <div
      className="fixed inset-0 z-[1500] bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`تفاصيل ${place.name}`}
    >
      <div
        ref={scrollRef}
        className="bg-gradient-to-b from-sand to-card w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-lg max-h-[92dvh] overflow-y-auto overscroll-contain animate-in slide-in-from-bottom-4 duration-200"
      >
        {/* Hero */}
        <div className={`relative bg-gradient-to-br ${CAT_GRADIENT[place.category] ?? "from-stone-200 to-stone-300"} pt-3 pb-6`}>
          {/* grab indicator */}
          <div className="w-12 h-1.5 bg-ink/20 rounded-full mx-auto mb-3" />
          {/* Close button — large + solid + extra shadow so it's visible
              even on bright photos. Stays clear of dynamic-island top inset. */}
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="absolute top-3 left-3 w-12 h-12 grid place-items-center bg-white hover:bg-stone-50 rounded-full font-extrabold text-ink text-lg shadow-[0_2px_12px_rgba(0,0,0,0.25)] active:scale-90 transition z-20 border border-white/80"
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
              className="absolute top-3 left-[4.25rem] h-12 px-3 grid place-items-center bg-white hover:bg-stone-50 rounded-full font-bold text-ink shadow-[0_2px_12px_rgba(0,0,0,0.25)] text-sm gap-1 flex items-center z-20"
              style={{ marginTop: "env(safe-area-inset-top)" }}
            >
              <span className="text-base">‹</span>
              <span>رجوع</span>
            </button>
          )}
          {/* Photo gallery — swipable, real Google photos */}
          <div className="px-4 mt-1">
            <PhotoGallery
              photos={place.photo_urls ?? (place.photo_url ? [place.photo_url] : [])}
              fallbackEmoji={CAT_EMOJI[place.category] ?? "✦"}
              alt={place.name}
            />
            {enriching && (
              <p className="text-[11px] text-muted text-center mt-1">
                ⏳ يجلب الصور والتقييمات من Google...
              </p>
            )}
          </div>
          {/* Status pill */}
          <div className="absolute top-4 right-4">
            <span className={`text-[11px] font-bold px-3 py-1 rounded-pill ${
              status.isOpen ? "bg-emerald-50 text-ok" : "bg-rose-50 text-danger"
            }`}>
              {status.label}
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Name + classification */}
          <div>
            <h2 className="font-serif font-extrabold text-2xl text-ink leading-tight">{place.name}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-sm">
              {kind && (
                <span className="bg-sea text-white font-bold px-3 py-1 rounded-pill text-xs">
                  {kind.emoji} {kind.ar}
                </span>
              )}
              {place.rating != null && (
                <span className="font-bold text-ink">
                  ⭐ {place.rating.toFixed(1)}
                  {place.review_count != null && (
                    <span className="text-muted font-normal text-xs"> · {place.review_count.toLocaleString("en")} مراجعة</span>
                  )}
                </span>
              )}
            </div>
            <div className="text-xs text-muted mt-1">
              {place.city_label ?? place.city}
              {place.price_level != null && <> · {"€".repeat(place.price_level)}</>}
              {bestTime && (
                <> · <span className="font-bold text-ink/80">{bestTime.emoji} الأفضل: {bestTime.ar}</span></>
              )}
            </div>
            {/* 🔥 Trending section — visible only when the place has been
                marked trending. Shows the TikTok preview (thumbnail + title)
                and the last-seen date. Append-only per spec — even if a
                later scan doesn't surface this place, the section stays. */}
            {(place.trending_score ?? 0) >= 50 && (() => {
              const ev = place.trending_evidence?.[0];
              const updatedAt = place.trending_updated_at
                ? new Date(place.trending_updated_at)
                : null;
              const ageText = updatedAt ? fmtTrendingAge(updatedAt) : null;
              return (
                <div className="mt-3 bg-gradient-to-l from-pink-50 to-orange-50 border-2 border-rose-200 rounded-2xl p-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5 font-extrabold text-rose-700 text-[12px]">
                      <span className="text-[15px]">🔥</span>
                      <span>ترند · {place.trending_score}/100</span>
                    </div>
                    {ageText && (
                      <span className="text-[10px] font-bold text-rose-600/80 bg-white/70 px-2 py-0.5 rounded-pill">
                        {ageText}
                      </span>
                    )}
                  </div>
                  {ev?.url && <TikTokPreview url={ev.url} />}
                </div>
              );
            })()}

            {/* Rating distribution histogram — TripAdvisor/Airbnb pattern.
                Renders only when we have ≥3 reviews with star ratings. */}
            {histogram.length > 0 && histogram.reduce((s, h) => s + h.count, 0) >= 3 && (
              <div className="mt-3 bg-white border border-line rounded-xl p-3 space-y-1">
                <div className="text-[10.5px] font-bold text-muted">⭐ توزيع التقييمات</div>
                {histogram.map((h) => (
                  <div key={h.stars} className="flex items-center gap-2 text-[11px]">
                    <span className="w-6 font-bold text-amber-700">{h.stars}★</span>
                    <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full"
                        style={{ width: `${h.pct}%` }}
                      />
                    </div>
                    <span className="w-10 text-left text-muted font-bold tabular-nums">{h.pct}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Best for (highlights) */}
          {highlights.length > 0 && (
            <section className="bg-amber-50/70 border border-amber-200 rounded-2xl p-3.5">
              <h3 className="text-xs font-bold text-amber-900 mb-2">✨ أفضل ما في هذا المكان</h3>
              <div className="flex flex-wrap gap-1.5">
                {highlights.map((h) => (
                  <span
                    key={h.ar}
                    className="bg-white border border-amber-300 text-amber-900 text-[11.5px] font-bold px-2.5 py-1 rounded-pill"
                  >
                    {h.emoji} {h.ar}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Smart score breakdown */}
          <section className="bg-gradient-to-br from-coral/5 to-coral/10 border border-coral/30 rounded-2xl p-4">
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold text-coral-600">🎯 تقييم رحلتي</h3>
              <span className="font-serif font-extrabold text-3xl text-coral-600">
                {scoreResult.score}
                <span className="text-sm font-normal text-muted"> /١٠٠</span>
              </span>
            </div>
            <p className="text-[12.5px] text-ink/85 leading-relaxed mb-3">
              ✨ {scoreResult.reasonAr}
            </p>
            <details className="text-[11.5px]">
              <summary className="cursor-pointer font-bold text-sea">
                ليش هذا التقييم؟ ({scoreResult.parts.length} عامل)
              </summary>
              <ul className="mt-2 space-y-1">
                {scoreResult.parts.map((p, i) => (
                  <li key={i} className={`flex justify-between items-baseline gap-2 py-0.5 ${
                    p.tone === "good" ? "text-ok" :
                    p.tone === "warn" ? "text-amber-700" :
                    p.tone === "bad" ? "text-danger" : "text-muted"
                  }`}>
                    <span>{p.label}</span>
                    <span className="font-bold">{p.points > 0 ? `+${p.points}` : p.points}</span>
                  </li>
                ))}
              </ul>
            </details>
          </section>

          {/* AI-summarized review (when Groq key set) */}
          {place.ai_summary && (
            <section className="bg-gradient-to-br from-violet-50 to-purple-50 border border-purple-200 rounded-2xl p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <h3 className="text-xs font-bold text-purple-700">🤖 ملخّص ذكي لمراجعات Google</h3>
              </div>
              <p className="text-[13px] text-ink leading-relaxed">{place.ai_summary}</p>
            </section>
          )}

          {/* Manual analyzed summary (our curated paragraphs) */}
          {place.review_summary && (
            <section className="bg-white border border-line rounded-2xl p-4">
              <h3 className="text-xs font-bold text-sea mb-2">📝 تحليل المكان</h3>
              <p className="text-[13.5px] text-ink leading-relaxed">{place.review_summary}</p>
            </section>
          )}

          {/* "Reviews mention" keyword chips — TripAdvisor-style word cloud
              distilled from the stored reviews. Only render when we have
              at least 3 mentions to feel substantive. */}
          {mentions.length >= 3 && (
            <section className="bg-white border border-line rounded-2xl p-3.5">
              <h3 className="text-xs font-bold text-sea mb-2">💬 الزوار يذكرون</h3>
              <div className="flex flex-wrap gap-1.5">
                {mentions.map((m) => (
                  <span
                    key={m.label}
                    className="bg-sky-50 border border-sky-200 text-sea text-[11.5px] font-bold px-2.5 py-1 rounded-pill"
                  >
                    {m.label}
                    <span className="text-[9.5px] opacity-70 mr-1">×{m.count}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Google review snippets — Arabic reviews ranked first */}
          {place.google_reviews && place.google_reviews.length > 0 && (() => {
            const sorted = [...place.google_reviews].sort((a, b) => {
              const aAr = a.language === "ar" ? 0 : 1;
              const bAr = b.language === "ar" ? 0 : 1;
              return aAr - bAr;
            });
            const arabicCount = sorted.filter((r) => r.language === "ar").length;
            const visible = arabicOnly ? sorted.filter((r) => r.language === "ar") : sorted;
            return (
              <section id="reviews-section" className="bg-white border border-line rounded-2xl p-4">
                <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
                  <h3 className="text-xs font-bold text-sea">
                    💬 آراء من Google ({sorted.length})
                  </h3>
                  <div className="flex items-center gap-2">
                    {arabicCount > 0 && (
                      <button
                        onClick={() => setArabicOnly(!arabicOnly)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-pill border transition active:scale-95 ${
                          arabicOnly
                            ? "bg-ok text-white border-ok"
                            : "bg-emerald-50 text-ok border-emerald-200"
                        }`}
                        aria-pressed={arabicOnly}
                      >
                        🇸🇦 {arabicOnly ? "✓ بالعربي فقط" : `${arabicCount} عربية`}
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
                      <div
                        key={i}
                        className={`pb-3 last:pb-0 border-b border-line-soft last:border-0 ${
                          isArabic ? "" : ""
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2 mb-1 flex-wrap">
                          <span className="text-[12px] font-bold text-ink flex items-center gap-1.5">
                            {isArabic && (
                              <span className="bg-emerald-100 text-ok text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill">
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
          })()}

          {/* Enriching indicator (first load) */}
          {enriching && !place.google_reviews && (
            <div className="text-center text-xs text-muted py-2">
              ⏳ نجلب أحدث المعلومات من Google...
            </div>
          )}

          {/* Insider tip */}
          {place.tip && place.tip !== place.review_summary && (
            <section className="bg-stone-50 border border-stone-200 rounded-2xl p-3.5">
              <h3 className="text-xs font-bold text-muted mb-1">💡 نصيحة سريعة</h3>
              <p className="text-[12.5px] text-ink/85 leading-relaxed">{place.tip}</p>
            </section>
          )}

          {/* Cost + Hours */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-line rounded-xl p-3">
              <div className="text-[10.5px] text-muted font-bold mb-1">💰 السعر التقريبي</div>
              <div className="font-serif font-extrabold text-base text-ink">{costStr}</div>
              {place.cost_confidence && (
                <div className="text-[10px] text-muted mt-0.5">ثقة {place.cost_confidence === "high" ? "عالية" : place.cost_confidence === "medium" ? "متوسطة" : "منخفضة"}</div>
              )}
            </div>
            <div className="bg-white border border-line rounded-xl p-3">
              <div className="text-[10.5px] text-muted font-bold mb-1">🕐 ساعات اليوم</div>
              <div className="font-bold text-sm text-ink">{status.todayHours || "—"}</div>
            </div>
          </div>

          {/* Weekly hours */}
          {place.opening_hours && place.opening_hours.length === 7 && !status.freeform && (
            <section className="bg-white border border-line rounded-2xl p-3.5">
              <h3 className="text-xs font-bold text-sea mb-2">📅 ساعات الأسبوع</h3>
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

          {/* Distance from user (GPS) + from hotel + embedded OSM mini-map */}
          {(fromUser || fromHotel || (place.lat != null && place.lng != null)) && (
            <section className="bg-white border border-line rounded-2xl p-3.5">
              <h3 className="text-xs font-bold text-sea mb-2">🧭 الموقع والمسافة</h3>
              {/* From CURRENT location — highest priority, prominent purple chips */}
              {fromUser && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mb-2.5">
                  <div className="text-[10.5px] font-extrabold text-emerald-700 mb-1.5 flex items-center gap-1">
                    <span>📍</span>
                    <span>من موقعك الحالي</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[12px]">
                    <span className="bg-white border border-emerald-300 px-2.5 py-1 rounded-pill font-bold text-emerald-900">
                      🚶 {fmtMins(fromUser.walkMin)} مشي
                    </span>
                    <span className="bg-white border border-emerald-300 px-2.5 py-1 rounded-pill font-bold text-emerald-900">
                      🚗 {fmtMins(fromUser.driveMin)} سيارة
                    </span>
                    <span className="bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-pill font-bold text-emerald-900">
                      ↔ {fmtKm(fromUser.km)}
                    </span>
                  </div>
                </div>
              )}
              {/* GPS opt-in CTA when not granted yet — encourages enabling */}
              {!fromUser && geo.status !== "granted" && place.lat != null && place.lng != null && (
                <button
                  onClick={geo.request}
                  disabled={geo.status === "asking"}
                  className="w-full mb-2.5 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-900 rounded-xl px-3 py-2.5 text-[12px] font-extrabold flex items-center justify-between min-h-[44px] active:scale-[0.98] transition disabled:opacity-60"
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
                    className="block relative rounded-xl overflow-hidden border border-stone-200 mb-2 aspect-[16/9] bg-stone-100"
                    title="افتح في Google Maps"
                  >
                    <iframe
                      src={src}
                      title={`خريطة ${place.name}`}
                      className="w-full h-full pointer-events-none"
                      loading="lazy"
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
                  <span className="bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-pill font-bold">
                    🚶 {fmtMins(fromHotel.walkMin)} مشي
                  </span>
                  <span className="bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-pill font-bold">
                    🚗 {fmtMins(fromHotel.driveMin)} سيارة
                  </span>
                  <span className="bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-pill font-bold text-amber-900">
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

          {/* "Similar places nearby" — pure client compute, in-app navigation.
              Click any card → the sheet navigates to that place (back button
              appears in the hero). "See all" toggles a 20-card grid below. */}
          {similar.length >= 2 && (() => {
            const visible = showAllSimilar ? similar : similar.slice(0, 10);
            return (
              <section className="bg-white border border-line rounded-2xl p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-bold text-sea">🔍 أماكن مشابهة قريبة</h3>
                  <span className="text-[10.5px] font-bold text-muted">
                    {userLoc ? "📍 من موقعك" : "من هذا المكان"} · {visible.length}/{similar.length}
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
                        className={`${showAllSimilar ? "" : "shrink-0 snap-start w-40"} text-right bg-stone-50 border border-stone-200 rounded-xl overflow-hidden active:scale-[0.98] hover:border-sea transition`}
                      >
                        <div className="aspect-[4/3] bg-stone-200 overflow-hidden relative">
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
                          {/* Distance + walk/drive badge top-left of photo */}
                          <span className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-pill backdrop-blur-sm flex items-center gap-1">
                            <span>{km < 2 ? "🚶" : "🚗"} {fmtMins(km < 2 ? walkMin : driveMin)}</span>
                            <span className="opacity-70">·</span>
                            <span>{fmtKm(km)}</span>
                          </span>
                          {/* Rating badge top-right */}
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
                              <span className="text-stone-500 font-bold">{priceStr}</span>
                            )}
                            {p.review_count != null && p.review_count > 0 && (
                              <span className="text-muted">
                                ({p.review_count >= 1000 ? `${(p.review_count / 1000).toFixed(1)}k` : p.review_count})
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
                    {showAllSimilar ? "↑ اعرض الأقرب فقط" : `↓ شاهد كل المشابهات (${similar.length})`}
                  </button>
                )}
              </section>
            );
          })()}

          {/* Actions — stacked on small screens to keep tap targets generous.
              Safe-area-inset-bottom keeps actions above the iPhone home indicator. */}
          <div
            className="pt-2 sticky bottom-0 bg-sand space-y-2"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
          >
            {/* Row 1 — both Google Maps shortcuts side by side */}
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
            </div>
            {/* Row 2 — plan add + share + save heart */}
            <div className="flex gap-2">
              {onAddToPlan && (
                <button
                  onClick={onAddToPlan}
                  className="flex-1 bg-white border border-sea text-sea font-bold text-sm py-3 rounded-2xl min-h-[48px]"
                >
                  ＋ خطّتي
                </button>
              )}
              <button
                onClick={shareThis}
                aria-label="مشاركة"
                title="مشاركة"
                className="w-12 h-12 rounded-xl grid place-items-center text-xl border bg-white border-line text-muted active:scale-95"
              >
                📤
              </button>
              {onSave && (
                <button
                  onClick={onSave}
                  aria-label={saved ? "إلغاء الحفظ" : "احفظ"}
                  className={`w-12 h-12 rounded-full grid place-items-center text-xl border active:scale-90 transition ${
                    saved ? "bg-coral text-white border-coral shadow" : "bg-white border-line text-muted"
                  }`}
                >
                  {saved ? "❤️" : "🤍"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
