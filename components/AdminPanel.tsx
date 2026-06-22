"use client";

// Admin-only console (gated by /profile/admin/page.tsx).
//
//   ▸ Live API usage panel — auto-refreshes every 30 s, shows last-call ts.
//   ▸ Bulk-places fetcher — runs textsearch per (city × query) and inserts new
//     rows. Loops in the client so each request stays under Netlify's timeout.
//   ▸ Bulk-photos tool — preview cost first; execute downloads photo bytes
//     once and stores them in Supabase Storage so future views skip Google.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type SkuRow = {
  op: string;
  ar: string;
  emoji: string;
  month_real: number;
  month_cache: number;
  day_real: number;
  day_cache: number;
  free_tier_monthly: number;
  pct_of_free: number;
  billable_calls: number;
  month_cost_usd: number;
  full_value_usd: number;
};

type UsageDetail = {
  asOf: string;
  monthStart: string;
  dayStart: string;
  skus: SkuRow[];
  totals: {
    real_calls_month: number;
    actual_cost_usd: number;
    value_at_full_price_usd: number;
    monthly_soft_cap_usd: number;
  };
  last_call: { at: string; operation: string; cache_hit: boolean } | null;
};

const CITY_LABEL_AR: Record<string, string> = {
  nice: "نيس", cannes: "كان", monaco: "موناكو",
};

// Categories to sweep per city — chosen to cover the bulk of what Google
// indexes in tourist-heavy Riviera cities. Ordered by likely yield.
const BULK_QUERIES: string[] = [
  "restaurant", "cafe", "bakery", "pastry", "ice cream",
  "bar", "rooftop", "wine bar",
  "museum", "art gallery", "monument",
  "park", "garden", "viewpoint", "beach",
  "fast food", "pizza", "sushi",
];

const PHOTO_CATEGORIES = [
  { key: "", ar: "كل الفئات", emoji: "✨" },
  { key: "food", ar: "مطاعم", emoji: "🍽" },
  { key: "coffee", ar: "قهاوي", emoji: "☕" },
  { key: "sweet", ar: "حلويات", emoji: "🍰" },
  { key: "sight", ar: "معالم", emoji: "🏛" },
  { key: "nature", ar: "طبيعة", emoji: "🌿" },
  { key: "event", ar: "ترفيه", emoji: "🎭" },
  { key: "bar", ar: "بارات", emoji: "🍸" },
] as const;

function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return `قبل ${Math.round(diffMs / 1000)} ثانية`;
  if (diffMs < 3600_000) return `قبل ${Math.round(diffMs / 60_000)} دقيقة`;
  if (diffMs < 86400_000) return `قبل ${Math.round(diffMs / 3600_000)} ساعة`;
  return `قبل ${Math.round(diffMs / 86400_000)} يوم`;
}

export default function AdminPanel() {
  return (
    <main
      className="max-w-3xl mx-auto px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 10px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
      }}
    >
      <div
        className="sticky z-20 -mx-4 px-4 pb-2 bg-sand/85 backdrop-blur-sm"
        style={{ top: "env(safe-area-inset-top)" }}
      >
        <Link
          href="/profile"
          className="inline-flex items-center gap-1.5 bg-white border border-line text-sea text-sm font-bold px-3 py-2 rounded-pill shadow-sm min-h-[44px] active:scale-95 transition"
        >
          <span>←</span><span>حسابي</span>
        </Link>
      </div>

      <header className="bg-gradient-to-br from-stone-900 via-stone-800 to-stone-700 text-white rounded-2xl p-4 shadow-md mb-4 mt-1">
        <h1 className="font-serif font-extrabold text-2xl">لوحة الإدارة</h1>
        <p className="text-[12px] opacity-90 mt-1 leading-relaxed">
          استهلاك Google API، جلب أماكن، تحميل صور — كل شي بالعدّاد الفعلي.
        </p>
      </header>

      <UsagePanel />
      <BulkPlacesPanel />
      <BulkPhotosPanel />
    </main>
  );
}

// ─── Usage panel ──────────────────────────────────────────────────────────

function UsagePanel() {
  const [usage, setUsage] = useState<UsageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/admin/usage-detail", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "fetch_failed");
      setUsage(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "خطأ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <section className="bg-white border border-line rounded-2xl p-4 mb-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-serif font-extrabold text-lg text-ink">📊 استهلاك Google API</h2>
        <button
          onClick={refresh}
          className="bg-white border border-line text-stone-800 text-[12px] font-bold px-3 min-h-[44px] rounded-pill active:scale-95"
        >
          🔄 حدّث
        </button>
      </div>

      {error && <p className="text-rose-700 text-[12px]">⚠ {error}</p>}
      {!usage && loading && <p className="text-muted text-[12px]">جارٍ التحميل…</p>}

      {usage && (
        <>
          <div className="text-[10.5px] text-muted mb-2">
            آخر تحديث: {fmtAgo(usage.asOf)} · آخر طلب: {usage.last_call ? `${fmtAgo(usage.last_call.at)} (${usage.last_call.operation}${usage.last_call.cache_hit ? " · cache" : ""})` : "—"}
          </div>
          <div className="space-y-1.5">
            {usage.skus.map((s) => (
              <SkuRowView key={s.op} sku={s} />
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-line grid grid-cols-3 gap-2 text-[12px]">
            <div className="bg-stone-50 rounded-xl p-2">
              <div className="text-[10px] text-muted">طلبات حقيقية هذا الشهر</div>
              <div className="font-extrabold text-ink mt-0.5">{usage.totals.real_calls_month}</div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-2">
              <div className="text-[10px] text-muted">التكلفة الفعلية</div>
              <div className="font-extrabold text-emerald-800 mt-0.5">${usage.totals.actual_cost_usd.toFixed(4)}</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-2">
              <div className="text-[10px] text-muted">قيمة لو ما في free tier</div>
              <div className="font-extrabold text-amber-800 mt-0.5">${usage.totals.value_at_full_price_usd.toFixed(2)}</div>
            </div>
          </div>
          <p className="text-[10.5px] text-muted mt-2">
            الـ soft cap الشهري: ${usage.totals.monthly_soft_cap_usd.toFixed(2)}
            {usage.totals.actual_cost_usd >= usage.totals.monthly_soft_cap_usd && " · 🚫 تم بلوغ السقف"}
          </p>
        </>
      )}
    </section>
  );
}

function SkuRowView({ sku }: { sku: SkuRow }) {
  const pct = Math.min(100, Math.max(0, sku.pct_of_free));
  const barColor = pct >= 80 ? "bg-rose-500" : pct >= 50 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="border border-line rounded-xl p-2.5">
      <div className="flex items-center justify-between text-[12px] mb-1.5">
        <span className="font-bold text-stone-800 inline-flex items-center gap-1.5">
          <span>{sku.emoji}</span><span>{sku.ar}</span>
        </span>
        <span className="text-stone-600 font-mono">
          {sku.month_real} / {sku.free_tier_monthly.toLocaleString()} ({pct.toFixed(1)}٪)
        </span>
      </div>
      <div className="h-1.5 bg-stone-100 rounded-pill overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[10.5px] text-muted flex justify-between">
        <span>اليوم: {sku.day_real} · cache: {sku.month_cache}</span>
        <span>تكلفة فعلية: ${sku.month_cost_usd.toFixed(4)}</span>
      </div>
    </div>
  );
}

// ─── Bulk places panel ────────────────────────────────────────────────────

type BulkResult = { city: string; query: string; inserted: number; duplicates: number; unclassified: number; candidates: number };

function BulkPlacesPanel() {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const cancelRef = useRef(false);

  function log(msg: string) {
    setLogs((prev) => [`${new Date().toLocaleTimeString("en")} · ${msg}`, ...prev].slice(0, 60));
  }

  async function runForCity(city: "nice" | "cannes" | "monaco") {
    setRunning(true);
    cancelRef.current = false;
    const cityResults: BulkResult[] = [];
    log(`🚀 بدء ${CITY_LABEL_AR[city]}...`);

    for (const q of BULK_QUERIES) {
      if (cancelRef.current) break;
      // 1st page + up to 2 follow-up pagetoken pages
      let token: string | null = null;
      for (let page = 0; page < 3; page++) {
        if (cancelRef.current) break;
        try {
          const resp: Response = await fetch("/api/admin/bulk-places-fetch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ city, query: q, pageToken: token }),
          });
          const data: { error?: string; inserted?: number; duplicates?: number; unclassified?: number; candidates?: number; next_page_token?: string | null } = await resp.json();
          if (!resp.ok) {
            log(`⚠ ${q} p${page}: ${data.error ?? "fail"}`);
            break;
          }
          cityResults.push({ city, query: q, inserted: data.inserted ?? 0, duplicates: data.duplicates ?? 0, unclassified: data.unclassified ?? 0, candidates: data.candidates ?? 0 });
          log(`✓ ${q} p${page}: +${data.inserted ?? 0} new (dup ${data.duplicates ?? 0}, class× ${data.unclassified ?? 0})`);
          setTotals((prev) => ({ ...prev, [city]: (prev[city] ?? 0) + (data.inserted ?? 0) }));

          token = data.next_page_token ?? null;
          if (!token) break;
          // Google requires a small delay before pagetoken is usable
          await new Promise((res) => setTimeout(res, 2500));
        } catch (e: unknown) {
          log(`✗ ${q}: ${e instanceof Error ? e.message : "خطأ"}`);
          break;
        }
      }
    }
    const total = cityResults.reduce((s, r) => s + r.inserted, 0);
    log(`🏁 انتهى ${CITY_LABEL_AR[city]} — +${total} مكان جديد`);
    setRunning(false);
  }

  async function runAll() {
    for (const c of ["nice", "cannes", "monaco"] as const) {
      if (cancelRef.current) break;
      await runForCity(c);
    }
  }

  return (
    <section className="bg-white border border-line rounded-2xl p-4 mb-4 shadow-sm">
      <h2 className="font-serif font-extrabold text-lg text-ink mb-1">🗺 جلب أماكن جديدة</h2>
      <p className="text-[12px] text-muted leading-relaxed mb-3">
        يبحث في Google Places عن ~١٨ فئة لكل مدينة (مطاعم/قهاوي/معالم...) ويُدخل الجديد فقط.
        ضمن الـ free tier تماماً. خذها ٥-١٠ دقائق لكل مدينة.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-2">
        {(["nice", "cannes", "monaco"] as const).map((c) => (
          <button
            key={c}
            disabled={running}
            onClick={() => runForCity(c)}
            className="bg-white border border-stone-300 text-stone-900 font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 transition disabled:opacity-50"
          >
            🌍 جلب {CITY_LABEL_AR[c]} {totals[c] ? `(+${totals[c]})` : ""}
          </button>
        ))}
        <button
          disabled={running}
          onClick={runAll}
          className="bg-sea text-white font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 transition disabled:opacity-50"
        >
          🚀 الكل
        </button>
      </div>

      {running && (
        <button
          onClick={() => { cancelRef.current = true; setRunning(false); }}
          className="w-full mb-2 bg-rose-50 border border-rose-200 text-rose-700 font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl"
        >
          ⏹ إيقاف
        </button>
      )}

      {logs.length > 0 && (
        <div className="bg-stone-50 border border-line rounded-xl p-2 max-h-48 overflow-y-auto text-[11px] font-mono text-stone-700 space-y-0.5">
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </section>
  );
}

// ─── Bulk photos panel ────────────────────────────────────────────────────

function BulkPhotosPanel() {
  const [city, setCity] = useState("cannes");
  const [category, setCategory] = useState<string>("");
  const [minRating, setMinRating] = useState("");
  const [minReviews, setMinReviews] = useState("");
  const [maxN, setMaxN] = useState("10");
  const [preview, setPreview] = useState<{ eligible_count: number; planned_count: number; estimated_cost_usd: number; estimated_cost_label: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ fetched: number; uploaded: number; skipped: number; errors: number; actual_cost_usd: number; error_samples: string[] } | null>(null);

  const filters = useMemo(() => ({
    city, category: category || undefined,
    min_rating: minRating ? Number(minRating) : undefined,
    min_reviews: minReviews ? Number(minReviews) : undefined,
    max: Math.max(1, Math.min(20, Number(maxN) || 10)),
  }), [city, category, minRating, minReviews, maxN]);

  async function fetchPreview() {
    setRunning(true); setPreview(null); setResult(null);
    try {
      const params = new URLSearchParams();
      params.set("city", filters.city);
      if (filters.category) params.set("category", filters.category);
      if (filters.min_rating != null) params.set("min_rating", String(filters.min_rating));
      if (filters.min_reviews != null) params.set("min_reviews", String(filters.min_reviews));
      params.set("max", String(filters.max));
      const r = await fetch(`/api/admin/bulk-photos-fetch?${params.toString()}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "fail");
      setPreview(data);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "خطأ");
    } finally {
      setRunning(false);
    }
  }

  async function execute() {
    if (!preview || preview.planned_count === 0) return;
    if (!confirm(`سيتم تحميل ${preview.planned_count} صورة بتكلفة ~$${preview.estimated_cost_usd.toFixed(4)}. متأكد؟`)) return;
    setRunning(true); setResult(null);
    try {
      const r = await fetch("/api/admin/bulk-photos-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filters),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "fail");
      setResult(data);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "خطأ");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="bg-white border border-line rounded-2xl p-4 mb-4 shadow-sm">
      <h2 className="font-serif font-extrabold text-lg text-ink mb-1">📸 تحميل صور بالـ filter</h2>
      <p className="text-[12px] text-muted leading-relaxed mb-3">
        يحمّل صورة واحدة من Google لكل مكان مطابق ويحفظها على Supabase Storage —
        فما تنطلب من Google مرة ثانية أبداً. الـ free tier: 1,000 صورة/شهر.
      </p>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <Field label="المدينة">
          <select value={city} onChange={(e) => setCity(e.target.value)} className="w-full bg-white border border-line rounded-xl px-2 py-2.5 text-[13px]">
            <option value="nice">نيس</option>
            <option value="cannes">كان</option>
            <option value="monaco">موناكو</option>
            <option value="riyadh">الرياض</option>
          </select>
        </Field>
        <Field label="الفئة">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-white border border-line rounded-xl px-2 py-2.5 text-[13px]">
            {PHOTO_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.ar}</option>)}
          </select>
        </Field>
        <Field label="أقل تقييم">
          <input type="number" inputMode="decimal" min="0" max="5" step="0.1" value={minRating} onChange={(e) => setMinRating(e.target.value)} placeholder="4.0" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 text-[14px]" />
        </Field>
        <Field label="أقل مراجعات">
          <input type="number" inputMode="numeric" min="0" value={minReviews} onChange={(e) => setMinReviews(e.target.value)} placeholder="100" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 text-[14px]" />
        </Field>
        <Field label="عدد أقصى لكل دفعة (1-20)">
          <input type="number" inputMode="numeric" min="1" max="20" value={maxN} onChange={(e) => setMaxN(e.target.value)} className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 text-[14px]" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-1">
        <button onClick={fetchPreview} disabled={running} className="bg-white border border-sea/30 text-sea font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 disabled:opacity-50">
          🔢 احسب التكلفة
        </button>
        <button onClick={execute} disabled={running || !preview || preview.planned_count === 0} className="bg-coral text-white font-bold text-[13px] py-2.5 min-h-[44px] rounded-xl active:scale-95 disabled:opacity-50">
          ⬇ نفّذ
        </button>
      </div>

      {preview && (
        <div className="mt-3 bg-amber-50/60 border border-amber-200 rounded-xl p-3 text-[12.5px]">
          <div>✓ مرشّحين: <b>{preview.eligible_count}</b> مكان</div>
          <div>سيُحمَّل: <b>{preview.planned_count}</b> صورة</div>
          <div>التكلفة: <b className="text-amber-900">{preview.estimated_cost_label}</b></div>
        </div>
      )}

      {result && (
        <div className="mt-3 bg-emerald-50/60 border border-emerald-200 rounded-xl p-3 text-[12.5px] space-y-0.5">
          <div>📸 جُلبت: <b>{result.fetched}</b></div>
          <div>💾 رُفعت لـ Storage: <b>{result.uploaded}</b></div>
          <div>⏭ مُتخطّى: {result.skipped}</div>
          <div>⚠ أخطاء: {result.errors}</div>
          <div className="text-[11px] text-emerald-900 mt-1">تكلفة فعلية: ${result.actual_cost_usd.toFixed(4)}</div>
          {result.error_samples.length > 0 && (
            <details className="mt-1 text-[11px]">
              <summary className="cursor-pointer text-rose-700">تفاصيل أخطاء</summary>
              {result.error_samples.map((s, i) => <div key={i} className="font-mono">{s}</div>)}
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold text-stone-700 mb-1">{label}</div>
      {children}
    </label>
  );
}
