import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Trip, Place } from "@/lib/supabase/database.types";
import { PLACE_LIST_COLUMNS } from "@/lib/supabase/database.types";
import PlaceCard from "@/components/PlaceCard";
import BottomNav from "@/components/BottomNav";
import ActivitiesDiscovery from "@/components/ActivitiesDiscovery";
import AutoWarmup from "@/components/AutoWarmup";
import PlaceSearchAdd from "@/components/PlaceSearchAdd";
import { computeSmartScore } from "@/lib/scoring/smartScore";
import { loadUserTaste } from "@/lib/scoring/loadUserTaste";
import { regionFilterClauseFor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlacesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ cat?: string; kind?: string; q?: string; gem?: string; trend?: string }>;
}) {
  const { tripId } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: trip } = await supabase
    .from("trips")
    .select("*")
    .eq("id", tripId)
    .single();
  if (!trip) notFound();
  const t = trip as Trip;

  // Region-aware: a Riviera trip pulls all 10 Côte d'Azur cities at once,
  // a Riyadh trip pulls Riyadh, etc. Falls back to single-city ilike when
  // the destination doesn't map to a known region.
  let query = supabase.from("places").select(PLACE_LIST_COLUMNS).limit(120);
  const regionClause = regionFilterClauseFor(t.destination_city);
  if (regionClause) {
    query = query.or(regionClause);
  } else if (t.destination_city) {
    query = query.or(
      `city.ilike.%${t.destination_city.toLowerCase()}%,city_label.ilike.%${t.destination_city}%`
    );
  }
  if (sp.cat && sp.cat !== "all") query = query.eq("category", sp.cat);
  if (sp.kind && sp.kind !== "all") query = query.eq("kind", sp.kind);

  // Run all independent reads in parallel — was 4 sequential round-trips.
  const [
    { data: places },
    { data: saved },
    { data: ratings },
    { data: { user } },
  ] = await Promise.all([
    query,
    supabase.from("user_saved_places").select("place_id"),
    supabase.from("user_place_ratings").select("place_id, stars, verdict"),
    supabase.auth.getUser(),
  ]);
  const savedSet = new Set(saved?.map((s) => s.place_id));
  const ratingByPlace = new Map(ratings?.map((r) => [r.place_id, r]) ?? []);

  const hotelLoc = t.hotel_lat != null && t.hotel_lng != null
    ? { lat: t.hotel_lat, lng: t.hotel_lng } : null;

  const userTaste = user ? await loadUserTaste(user.id) : null;

  // Optional: only hidden gems
  const hiddenGemsOnly = sp.gem === "1";
  // Optional: only trending (TikTok/Instagram verified, score ≥ 50)
  const trendingOnly = sp.trend === "1";
  const baseList = (places ?? []) as Place[];
  let filtered = baseList;
  if (hiddenGemsOnly) {
    filtered = filtered.filter((p) =>
      p.rating != null && p.rating >= 4.5 &&
      p.review_count != null && p.review_count >= 80 && p.review_count <= 1500
    );
  }
  if (trendingOnly) {
    filtered = filtered.filter((p) => (p.trending_score ?? 0) >= 50);
  }

  // Score each place; sort descending.
  const scored = filtered.map((p) => {
    const ur = ratingByPlace.get(p.id);
    const { score, reasonAr } = computeSmartScore(p, {
      hotelLocation: hotelLoc,
      budgetStyle: t.budget_style,
      userSaved: savedSet.has(p.id),
      userRating: ur?.stars ?? null,
      userVerdict: ur?.verdict ?? null,
      preferredCategories: (t.preferences as { categories?: string[] })?.categories,
      userTaste,
    });
    return { p, score, reasonAr, saved: savedSet.has(p.id) };
  });
  scored.sort((a, b) => b.score - a.score);

  const cats = [
    { key: "all", label: "الكل" },
    { key: "food", label: "🍽 مطاعم" },
    { key: "coffee", label: "☕ قهوة" },
    { key: "sight", label: "🏛 معالم" },
    { key: "nature", label: "🌿 طبيعة" },
    { key: "event", label: "🎟 فعاليات" },
    { key: "sweet", label: "🍦 حلا" },
    { key: "bar", label: "🥂 بار" },
  ];

  // Kind sub-filter chips, contextual to active category
  const KIND_OPTIONS: Record<string, Array<{ key: string; label: string }>> = {
    food: [
      { key: "michelin", label: "⭐ ميشلان" },
      { key: "fine_dining", label: "🎩 فاين داينينق" },
      { key: "traditional", label: "🥖 محلي تقليدي" },
      { key: "bistro", label: "🍷 بسترو" },
      { key: "italian", label: "🍝 إيطالي" },
      { key: "seafood", label: "🐟 بحريّات" },
      { key: "fast", label: "⚡ سريع" },
    ],
    coffee: [
      { key: "specialty", label: "☕ اختصاصية" },
      { key: "roastery", label: "🏭 محمصة" },
      { key: "brunch", label: "🍳 برانش" },
      { key: "casual", label: "🍴 يومي" },
    ],
    sight: [
      { key: "landmark", label: "🗿 معلم" },
      { key: "museum", label: "🏛 متحف" },
      { key: "market", label: "🛒 سوق" },
      { key: "village", label: "🏘 قرية" },
      { key: "panorama", label: "🌅 إطلالة" },
    ],
    nature: [
      { key: "beach", label: "🏖 شاطئ" },
      { key: "garden", label: "🌿 حديقة" },
      { key: "hike", label: "🥾 هايكنق" },
      { key: "panorama", label: "🌅 إطلالة" },
    ],
    bar: [{ key: "rooftop", label: "🌃 روفتوب" }, { key: "beach_club", label: "🏖 شاطئ كلوب" }],
  };
  const activeCat = sp.cat ?? "all";
  const kindChips = KIND_OPTIONS[activeCat] ?? [];
  const buildHref = (cat: string, kind?: string, gem?: boolean, trend?: boolean) => {
    const params = new URLSearchParams();
    if (cat !== "all") params.set("cat", cat);
    if (kind && kind !== "all") params.set("kind", kind);
    if (gem) params.set("gem", "1");
    if (trend) params.set("trend", "1");
    const qs = params.toString();
    return `/trips/${tripId}/places${qs ? `?${qs}` : ""}`;
  };
  // How many trending places are available in current scope — drives the
  // 🔥 chip count badge.
  const trendingCount = baseList.filter((p) => (p.trending_score ?? 0) >= 50).length;

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <Link href={`/trips/${tripId}`} className="text-sea text-sm font-bold inline-block mb-3">
        ← {t.name}
      </Link>

      <header className="mb-4 space-y-3">
        <div>
          <h1 className="font-serif font-extrabold text-2xl text-sea">استكشف الأماكن</h1>
          <p className="text-xs text-muted mt-1">
            {scored.length} مكان مرتّب بـ سكور رحلتي · اضغط أي مكان للتفاصيل والصور
          </p>
        </div>

        <PlaceSearchAdd
          cityKey={t.destination_city ?? ""}
          cityLabel={t.destination_city ?? ""}
          lat={t.hotel_lat ?? null}
          lng={t.hotel_lng ?? null}
        />

        <AutoWarmup tripId={tripId} />
      </header>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
        {/* 🔥 ترند — prominent flame chip at the start, always visible
            (matches the map's chip row so users see one consistent surface).
            Tap → filters list to only TikTok/Instagram-verified trending. */}
        <Link
          href={buildHref(activeCat, sp.kind, hiddenGemsOnly, !trendingOnly)}
          className={`shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-pill text-sm font-extrabold border-2 transition active:scale-95 ${
            trendingOnly
              ? "bg-gradient-to-l from-pink-500 to-orange-500 text-white border-rose-600 ring-2 ring-rose-200"
              : "bg-gradient-to-l from-pink-50 to-orange-50 text-rose-700 border-rose-300"
          }`}
        >
          <span>🔥</span>
          <span>ترند</span>
          {trendingCount > 0 && (
            <span className={`text-[10px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-pill ${
              trendingOnly ? "bg-white/25" : "bg-rose-200/70 text-rose-900"
            }`}>{trendingCount}</span>
          )}
        </Link>
        {cats.map((c) => (
          <Link
            key={c.key}
            href={buildHref(c.key, undefined, hiddenGemsOnly, trendingOnly)}
            className={`shrink-0 px-3 py-2 rounded-pill text-sm font-bold border ${
              activeCat === c.key
                ? "bg-coral text-white border-coral"
                : "bg-white text-muted border-line"
            }`}
          >
            {c.label}
          </Link>
        ))}
        <Link
          href={buildHref(activeCat, sp.kind, !hiddenGemsOnly, trendingOnly)}
          className={`shrink-0 px-3 py-2 rounded-pill text-sm font-bold border ${
            hiddenGemsOnly
              ? "bg-purple-600 text-white border-purple-600"
              : "bg-white text-purple-600 border-purple-200"
          }`}
        >
          💎 هيدن جيمز
        </Link>
      </div>

      {/* Kind sub-chips (when a category is active) */}
      {kindChips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-4 px-4 mt-1">
          <Link
            href={buildHref(activeCat)}
            className={`shrink-0 px-2.5 py-1.5 rounded-pill text-[11.5px] font-bold border ${
              !sp.kind || sp.kind === "all"
                ? "bg-sea text-white border-sea"
                : "bg-white text-sea border-sky-200"
            }`}
          >
            كل الأنواع
          </Link>
          {kindChips.map((k) => (
            <Link
              key={k.key}
              href={buildHref(activeCat, k.key)}
              className={`shrink-0 px-2.5 py-1.5 rounded-pill text-[11.5px] font-bold border ${
                sp.kind === k.key
                  ? "bg-sea text-white border-sea"
                  : "bg-white text-sea border-sky-200"
              }`}
            >
              {k.label}
            </Link>
          ))}
        </div>
      )}

      {/* Activities — dynamic Google Nearby Search around hotel */}
      {t.destination_city && (
        <ActivitiesDiscovery
          cityLabel={t.destination_city}
          cityKey={t.destination_city.toLowerCase()}
          lat={t.hotel_lat}
          lng={t.hotel_lng}
        />
      )}

      {scored.length === 0 ? (
        <div className="bg-card border border-line rounded-2xl p-6 text-center mt-4">
          <p className="text-muted text-sm">
            ما لقيت أماكن لـ <b>{t.destination_city}</b>.
            <br />
            البيانات الحالية تشمل: نيس، موناكو، إيز، كان، أنتيب، الرياض، وأخرى.
          </p>
        </div>
      ) : (
        <div className="space-y-3 mt-3">
          {scored.map(({ p, score, reasonAr, saved }) => (
            <PlaceCard
              key={p.id}
              place={p}
              tripId={tripId}
              score={score}
              reasonAr={reasonAr}
              initiallySaved={saved}
              hotel={hotelLoc ? { ...hotelLoc, name: t.hotel_name ?? "فندقك" } : null}
            />
          ))}
        </div>
      )}

      <BottomNav active="trips" />
    </main>
  );
}
