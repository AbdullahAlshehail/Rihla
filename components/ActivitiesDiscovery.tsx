"use client";

// Dynamic activity discovery — calls /api/activities/discover ONCE on mount,
// shows only categories that exist in this city (Google says so).
// Click a category → expand its top places inline.

import { useEffect, useState } from "react";

type DiscoverPlace = {
  google_place_id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  review_count?: number;
  open_now?: boolean;
  google_maps_url?: string;
};

type DiscoverGroup = {
  type: string;
  label_ar: string;
  emoji: string;
  count: number;
  places: DiscoverPlace[];
};

type DiscoverResponse = {
  mock: boolean;
  cached: boolean;
  total: number;
  groups: DiscoverGroup[];
};

export default function ActivitiesDiscovery({
  cityLabel,
  lat,
  lng,
  cityKey,
}: {
  cityLabel: string;
  lat?: number | null;
  lng?: number | null;
  cityKey?: string;
}) {
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lng == null) {
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lng),
      ...(cityKey && { city: cityKey }),
    });
    fetch(`/api/activities/discover?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch(() => setErr("تعذّر الاكتشاف"))
      .finally(() => setLoading(false));
  }, [lat, lng, cityKey]);

  // No hotel coordinates — can't run nearby search
  if (lat == null || lng == null) {
    return (
      <section className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-purple-200 rounded-2xl p-4 mt-4">
        <h3 className="font-serif font-extrabold text-base text-violet-700">🎟 فعاليات وأنشطة</h3>
        <p className="text-xs text-muted mt-2 leading-relaxed">
          أضِف موقع فندقك في إعدادات الرحلة → نكتشف لك تلقائياً كل الفعاليات حواليه.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-purple-200 rounded-2xl p-4 mt-4">
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h3 className="font-serif font-extrabold text-base text-violet-700">🎟 فعاليات وأنشطة في {cityLabel}</h3>
        {data?.cached && <span className="text-[10.5px] text-muted">من الكاش · ٠$</span>}
      </div>

      {loading && (
        <div className="text-center text-xs text-muted py-6">⏳ يكتشف الفعاليات المتاحة حواليك...</div>
      )}

      {err && (
        <div className="text-center text-xs text-danger py-4">{err}</div>
      )}

      {data?.mock && (
        <div className="text-[12px] text-muted bg-white border border-line rounded-xl p-3">
          ℹ يحتاج <code className="bg-stone-100 px-1 rounded text-[11px]">GOOGLE_MAPS_API_KEY</code> في <code className="bg-stone-100 px-1 rounded text-[11px]">.env.local</code> ليكتشف Google الفعاليات والأنشطة المتاحة قرب فندقك.
          <br />
          <span className="text-[11px] mt-1 block">التكلفة: ~$0.03 لكل مدينة (cache ٣٠ يوم).</span>
        </div>
      )}

      {data && !data.mock && data.groups.length === 0 && (
        <p className="text-center text-xs text-muted py-3">
          ما في فعاليات قريبة من فندقك (نطاق ١٥كم).
        </p>
      )}

      {data && data.groups.length > 0 && (
        <>
          <p className="text-[11.5px] text-muted mb-3">
            وجدت {data.total} مكان في {data.groups.length} تصنيف. اضغط لتشوف الأفضل:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.groups.map((g) => (
              <button
                key={g.type}
                onClick={() => setActiveType((cur) => (cur === g.type ? null : g.type))}
                className={`text-[12.5px] font-bold px-3 py-1.5 rounded-pill border transition flex items-center gap-1 ${
                  activeType === g.type
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-white text-violet-700 border-violet-200"
                }`}
              >
                <span>{g.emoji}</span>
                <span>{g.label_ar}</span>
                <span className={`text-[10px] font-extrabold rounded-pill px-1.5 ${
                  activeType === g.type ? "bg-white/30" : "bg-violet-100 text-violet-700"
                }`}>
                  {g.count}
                </span>
              </button>
            ))}
          </div>

          {/* Expanded group */}
          {activeType && (() => {
            const group = data.groups.find((g) => g.type === activeType);
            if (!group) return null;
            return (
              <div className="mt-3 pt-3 border-t border-purple-200 space-y-2">
                {group.places.map((p) => (
                  <a
                    key={p.google_place_id}
                    href={p.google_maps_url ?? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
                    target="_blank"
                    rel="noopener"
                    className="block bg-white border border-purple-100 rounded-xl p-3 active:bg-violet-50"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="text-xl shrink-0">{group.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-serif font-extrabold text-[13.5px] leading-tight">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-muted mt-0.5 flex flex-wrap items-center gap-x-2">
                          {p.rating != null && (
                            <span><b className="text-ink">{p.rating}</b>★{p.review_count ? ` · ${p.review_count >= 1000 ? (p.review_count / 1000).toFixed(1) + "k" : p.review_count}` : ""}</span>
                          )}
                          {p.open_now === true && <span className="text-ok font-bold">🟢 مفتوح</span>}
                          {p.open_now === false && <span className="text-danger font-bold">🔴 مغلق</span>}
                        </div>
                        {p.address && (
                          <p className="text-[11px] text-muted mt-0.5 line-clamp-1" dir="auto">{p.address}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-violet-700 text-base">🧭</span>
                    </div>
                  </a>
                ))}
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}
