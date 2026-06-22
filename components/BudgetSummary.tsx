import Link from "next/link";
import type { BudgetOutput } from "@/lib/budget/estimator";
import { confidenceLabel, confidenceColor } from "@/lib/budget/estimator";
import { fmtMoneySAR } from "@/lib/utils";

export default function BudgetSummary({
  summary, tripId,
}: {
  summary: BudgetOutput;
  tripId: string;
}) {
  const items: Array<{ key: string; icon: string; label: string; total: number; perPerson: number }> = [
    { key: "flight", icon: "✈️", label: "طيران", total: summary.perPerson.flight * summary.travelers, perPerson: summary.perPerson.flight },
    { key: "hotel", icon: "🏨", label: "فندق", total: summary.perPerson.hotel * summary.travelers, perPerson: summary.perPerson.hotel },
    { key: "activities", icon: "🍽", label: "مطاعم + أنشطة", total: summary.perPerson.activities * summary.travelers, perPerson: summary.perPerson.activities },
    { key: "transport", icon: "🚗", label: "مواصلات", total: summary.perPerson.transport * summary.travelers, perPerson: summary.perPerson.transport },
    { key: "misc", icon: "🛍", label: "مصروف يومي", total: summary.perPerson.misc * summary.travelers, perPerson: summary.perPerson.misc },
  ];

  return (
    <section className="bg-card border border-line rounded-2xl p-4 shadow">
      <header className="flex items-baseline justify-between mb-3">
        <h2 className="font-serif font-extrabold text-lg text-sea">💰 إجمالي الرحلة</h2>
        <span className={`text-[11px] font-bold ${confidenceColor(summary.confidence)}`}>
          {confidenceLabel(summary.confidence)}
        </span>
      </header>

      <div className="space-y-1.5 mb-3">
        {items.map((it) => (
          <div
            key={it.key}
            className="flex items-baseline justify-between text-sm py-1.5 border-b border-line-soft last:border-0"
          >
            <span className="text-muted text-[13px] flex items-center gap-1.5">
              <span>{it.icon}</span>{it.label}
            </span>
            <div className="text-left flex flex-col items-end">
              <span className="font-bold text-ink">{fmtMoneySAR(it.total)}</span>
              {summary.travelers > 1 && it.total > 0 && (
                <span className="text-[10.5px] text-muted">
                  {fmtMoneySAR(it.perPerson)} للشخص
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t-2 border-sea flex items-baseline justify-between">
        <span className="font-serif font-extrabold text-base">الإجمالي</span>
        <div className="text-left flex flex-col items-end">
          <span className="font-serif font-extrabold text-2xl text-coral-600">
            {fmtMoneySAR(summary.total)}
          </span>
          {summary.travelers > 1 && (
            <span className="text-xs text-muted">
              {fmtMoneySAR(summary.perPerson.total)} للشخص × {summary.travelers}
            </span>
          )}
        </div>
      </div>

      {summary.assumptions.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="text-muted cursor-pointer font-bold">
            ℹ {summary.assumptions.length} ملاحظة على هذا التقدير
          </summary>
          <ul className="mt-2 space-y-1 text-muted leading-relaxed">
            {summary.assumptions.map((a, i) => (
              <li key={i}>· {a}</li>
            ))}
          </ul>
        </details>
      )}

      <Link
        href={`/trips/${tripId}/settings`}
        className="block mt-4 text-center text-sm font-bold bg-white border border-line text-sea py-2.5 rounded-xl"
      >
        ⚙ عدّل الميزانية والافتراضات
      </Link>
    </section>
  );
}
