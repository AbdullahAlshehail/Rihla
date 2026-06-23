"use client";

// Per-city trending scan controls. Server hands over the current stats; the
// client offers a "🔥 جلب الترند" button per city that calls POST
// /api/admin/trending-scan and refreshes the data.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type CityRow = {
  city_label: string;
  total: number;
  trending: number;
  last_scan_at: string | null;
  last_scan_status: string | null;
  last_scan_matches: number | null;
  last_scan_cost: number | null;
};

type Focus = "all" | "food" | "coffee" | "brunch" | "breakfast" | "sight" | "nature" | "sweet" | "event" | "bar";

const FOCUS_OPTIONS: Array<{ key: Focus; ar: string; emoji: string }> = [
  { key: "all",       ar: "الكل",      emoji: "✨" },
  { key: "food",      ar: "مطاعم",     emoji: "🍽" },
  { key: "coffee",    ar: "قهاوي",     emoji: "☕" },
  { key: "brunch",    ar: "برانش",     emoji: "🥞" },
  { key: "breakfast", ar: "فطور",      emoji: "🥐" },
  { key: "sight",     ar: "معالم",     emoji: "🏛" },
  { key: "nature",    ar: "طبيعة",     emoji: "🌿" },
  { key: "sweet",     ar: "حلويات",    emoji: "🍰" },
  { key: "event",     ar: "ترفيه",     emoji: "🎭" },
  { key: "bar",       ar: "بار/روف",   emoji: "🍸" },
];

export default function TrendsManagement({ cities }: { cities: CityRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ city: string; text: string; ok: boolean } | null>(null);
  // Per-city focus selection (defaults to "all"). Keyed by city_label so the
  // user can have different focus per row.
  const [focusByCity, setFocusByCity] = useState<Record<string, Focus>>({});

  async function scan(city: string, force = false) {
    if (busy) return;
    setBusy(city);
    setMsg(null);
    const focus = focusByCity[city] ?? "all";
    try {
      const r = await fetch("/api/admin/trending-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_label: city, category_focus: focus, force }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error ?? `http_${r.status}`);
      setMsg({
        city,
        ok: true,
        text: json.empty
          ? `ما في مرشحين كافيين في ${city}`
          : json.cached
            ? `📁 مخزّن قبل ${json.last_scan_days_ago} يوم · ${json.trending_count} ترند · وفّرت $${json.cost_saved_usd?.toFixed(2)} ✨`
            : `✓ ${json.written} ترند جديد · ${json.verified}/${json.matches} متحقّقة · $${(json.costUsd ?? 0).toFixed(3)} · ${(json.durationMs / 1000).toFixed(0)}ث`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ city, ok: false, text: e instanceof Error ? e.message : "خطأ" });
    } finally {
      setBusy(null);
    }
  }

  const totalTrending = cities.reduce((s, c) => s + c.trending, 0);

  return (
    <main className="min-h-dvh bg-sand pb-24" dir="rtl">
      {/* Header */}
      <header className="bg-white border-b border-line sticky top-0 z-10" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/profile"
            className="inline-flex items-center justify-center w-10 h-10 rounded-pill bg-stone-100 text-stone-700 font-bold active:scale-95 transition"
          >←</Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-serif font-extrabold text-lg text-sea leading-tight">🔥 إدارة الترند</h1>
            <p className="text-stone-600 text-[11.5px] font-bold leading-tight">
              {totalTrending > 0 ? `${totalTrending} مكان ترند في ${cities.filter(c=>c.trending>0).length} مدينة` : "اضغط أي مدينة لتجلب ترندها"}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-3">
        {/* Info banner */}
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 text-[12.5px] text-rose-900 leading-relaxed">
          <p className="font-extrabold mb-1.5">📺 تحديث ذكي — يستخدم الكاش لتوفير ٩٠٪</p>
          <ul className="space-y-1 font-bold text-[11.5px] text-rose-800">
            <li>• <b>"تحديث ذكي"</b>: لو المدينة مُسحت آخر ١٤ يوم → <b>$0</b> (يرجع المخزّن)</li>
            <li>• <b>"إجباري"</b>: يتجاوز الكاش ويعمل مسح Claude جديد (~$0.086)</li>
            <li>• كل مكان ترند بياخذ رابط TikTok/Instagram فعلي (مو بحث عام)</li>
            <li>• البيانات append-only — ما تنحذف حتى مع مسح جديد</li>
          </ul>
        </div>

        {/* Per-city cards */}
        {cities.map((c) => {
          const currentFocus = focusByCity[c.city_label] ?? "all";
          return (
          <div key={c.city_label} className="bg-white border border-line rounded-2xl p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[18px]">📍</span>
                  <h3 className="font-extrabold text-[15px] text-ink line-clamp-1">{c.city_label}</h3>
                  {c.trending > 0 && (
                    <span className="bg-gradient-to-l from-pink-500 to-orange-500 text-white text-[10.5px] font-extrabold px-2 py-0.5 rounded-pill inline-flex items-center gap-1">
                      <span>🔥</span><span>{c.trending}</span>
                    </span>
                  )}
                </div>
                <div className="mt-1 text-[11.5px] text-stone-600 font-bold">
                  {c.total} مكان في الكاتالوج
                  {c.last_scan_at && (
                    <span className="text-stone-500"> · آخر مسح {fmtRelative(c.last_scan_at)}</span>
                  )}
                </div>
                {c.last_scan_at && c.last_scan_cost != null && (
                  <div className="mt-1 text-[10.5px] text-stone-500 tabular-nums">
                    ${c.last_scan_cost.toFixed(3)} · {c.last_scan_matches ?? 0} ترند آخر مرة
                  </div>
                )}
              </div>
            </div>

            {/* Category focus chips — pick what to scan FOR in this city */}
            <div className="mt-3 -mx-1 px-1 overflow-x-auto scrollbar-thin">
              <div className="flex gap-1.5 w-max pb-1">
                {FOCUS_OPTIONS.map((f) => {
                  const on = currentFocus === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setFocusByCity((s) => ({ ...s, [c.city_label]: f.key }))}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 min-h-[34px] rounded-pill text-[11px] font-bold border transition active:scale-95 ${
                        on
                          ? "bg-stone-900 text-white border-stone-900 shadow"
                          : "bg-stone-50 text-stone-700 border-stone-200"
                      }`}
                    >
                      <span>{f.emoji}</span>
                      <span>{f.ar}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Smart-cache: if last scan < 14 days, plain tap = $0 (cached);
                "إجباري" override calls Claude regardless. */}
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-1.5">
              <button
                onClick={() => scan(c.city_label, false)}
                disabled={busy != null}
                className={`min-h-[44px] px-4 rounded-pill font-extrabold text-[12.5px] border-2 shadow-md active:scale-95 transition disabled:opacity-50 inline-flex items-center justify-center gap-1.5 ${
                  busy === c.city_label
                    ? "bg-rose-100 text-rose-700 border-rose-300"
                    : "bg-gradient-to-l from-pink-500 to-orange-500 text-white border-rose-600"
                }`}
              >
                {busy === c.city_label ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-rose-200 border-t-rose-700 animate-spin" />
                    <span>جاري البحث…</span>
                  </>
                ) : (
                  <>
                    <span>🔥</span>
                    <span>
                      {currentFocus === "all"
                        ? (c.trending > 0 ? "تحديث ذكي" : "جلب الترند")
                        : `جلب ${FOCUS_OPTIONS.find((f) => f.key === currentFocus)?.ar}`}
                    </span>
                  </>
                )}
              </button>
              {/* إجباري: تجاوز الكاش (يصرف $0.086) */}
              <button
                onClick={() => scan(c.city_label, true)}
                disabled={busy != null}
                title="مسح إجباري (يصرف ~$0.05 حتى لو حديث)"
                aria-label="مسح إجباري — يتجاوز الكاش"
                className="min-h-[44px] px-3 rounded-pill font-extrabold text-[11px] border-2 border-rose-300 bg-white text-rose-700 active:scale-95 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <span>⟳</span><span>إجباري</span>
              </button>
            </div>

            {msg && msg.city === c.city_label && (
              <div className={`mt-3 px-3 py-2 rounded-pill text-[11.5px] font-extrabold ${
                msg.ok ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                       : "bg-rose-50 text-rose-900 border border-rose-200"
              }`}>
                {msg.text}
              </div>
            )}
          </div>
          );
        })}

        {cities.length === 0 && (
          <div className="bg-white border-2 border-dashed border-stone-300 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-2">📭</div>
            <p className="font-extrabold text-stone-700">ما في مدن في الكاتالوج</p>
          </div>
        )}
      </div>
    </main>
  );
}

function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${diffMin} د`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `قبل ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `قبل ${diffDay} يوم`;
  return new Date(iso).toLocaleDateString("ar-SA");
}
