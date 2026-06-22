"use client";

// Budget meter — per-SKU usage vs Google's monthly free tier (post-March-2025).
// Shows the user exactly how close each API is to billing kick-in, with a
// monthly soft cap as the paranoia ceiling.

import { useEffect, useState } from "react";

type OpUsage = {
  op: string;
  usedToday: number;
  dailyCap: number;
  pctDaily: number;
  usedThisMonth: number;
  monthlyFreeTier: number;
  pctMonthlyFree: number;
  pricePer1000Usd: number;
  billableThisMonth: number;
  monthlyCostUsd: number;
};

type Usage = {
  byOp: OpUsage[];
  globalUsedToday: number;
  globalDailyCap: number;
  monthlyCostUsd: number;
  monthlySoftCapUsd: number;
  safe: boolean;
};

const OP_LABELS_AR: Record<string, string> = {
  places_search: "بحث",
  place_details: "تفاصيل",
  places_nearby_discover: "اكتشاف",
  routes_matrix: "مسارات",
  geocode: "إحداثيات",
  place_photo: "صور",
};

export default function BudgetMeter({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Usage | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/usage")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setData(d);
      })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const usdToSar = 3.75;
  const monthSar = (data.monthlyCostUsd * usdToSar).toFixed(2);
  const capSar = (data.monthlySoftCapUsd * usdToSar).toFixed(0);
  const pctMonthlyBudget = Math.round((data.monthlyCostUsd / data.monthlySoftCapUsd) * 100);

  if (compact) {
    return (
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-[11px] font-bold rounded-pill px-2.5 py-1 border ${
          data.safe
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        }`}
      >
        {data.safe ? "🟢" : "🟡"} الشهر: ${data.monthlyCostUsd.toFixed(2)}
      </button>
    );
  }

  return (
    <section className="bg-white border border-line rounded-2xl p-4 mt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between"
      >
        <div className="text-right">
          <h3 className="font-serif font-extrabold text-base">
            {data.safe ? "🟢" : "🟡"} مراقب التكلفة
          </h3>
          <p className="text-[11px] text-muted mt-0.5">
            هذا الشهر: <b className="text-ink">{monthSar} ر.س</b> من سقف {capSar} ر.س
          </p>
        </div>
        <span className="text-muted text-sm">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-line space-y-3">
          {/* Monthly cost vs soft cap */}
          <div>
            <div className="flex justify-between text-[11.5px] font-bold mb-1">
              <span className="text-muted">تكلفة هذا الشهر</span>
              <span className="text-ink">
                ${data.monthlyCostUsd.toFixed(2)} / ${data.monthlySoftCapUsd}
              </span>
            </div>
            <div className="h-2 bg-stone-100 rounded-pill overflow-hidden">
              <div
                className={`h-full ${pctMonthlyBudget > 80 ? "bg-rose-500" : pctMonthlyBudget > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, pctMonthlyBudget)}%` }}
              />
            </div>
          </div>

          {/* Per-SKU breakdown vs monthly free tier */}
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-bold text-muted">الاستخدام مقابل الحد المجاني الشهري لكل API:</p>
            {data.byOp.map((o) => {
              const free = o.monthlyFreeTier;
              const used = o.usedThisMonth;
              const pct = free > 0 ? Math.round((used / free) * 100) : 0;
              const overFree = used > free;
              return (
                <div key={o.op}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span className="text-muted">
                      {OP_LABELS_AR[o.op] ?? o.op}
                      <span className="text-[9.5px] mr-1">${o.pricePer1000Usd}/1000 بعد المجاني</span>
                    </span>
                    <span className="text-ink font-bold">
                      {used} / {free.toLocaleString("en")}
                    </span>
                  </div>
                  <div className="h-1 bg-stone-100 rounded-pill overflow-hidden">
                    <div
                      className={`h-full ${overFree ? "bg-rose-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  {overFree && (
                    <div className="text-[10px] text-rose-700 mt-0.5">
                      ⚠️ تجاوز المجاني · ${o.monthlyCostUsd.toFixed(2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Today's call total */}
          <div className="pt-1">
            <div className="flex justify-between text-[11px] mb-0.5">
              <span className="text-muted">إجمالي الطلبات اليوم</span>
              <span className="text-ink font-bold">{data.globalUsedToday} / {data.globalDailyCap}</span>
            </div>
            <div className="h-1 bg-stone-100 rounded-pill overflow-hidden">
              <div
                className="h-full bg-sky-500"
                style={{ width: `${Math.min(100, (data.globalUsedToday / data.globalDailyCap) * 100)}%` }}
              />
            </div>
          </div>

          <div className="text-[10.5px] text-muted bg-stone-50 rounded-xl p-2.5 leading-relaxed">
            <p className="font-bold mb-1">📌 الواقع التسعيري (مارس ٢٠٢٥):</p>
            <p>لا يوجد رصيد $200 شامل بعد الآن. كل API له حد مجاني مستقل (مثلاً: تفاصيل ٥٠٠٠/شهر، صور ١٠٠٠/شهر فقط). التطبيق يرفض المكالمات تلقائياً قبل أي صرف ملموس.</p>
          </div>
        </div>
      )}
    </section>
  );
}
