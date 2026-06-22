"use client";

// Auto-warmup: when the Explore page mounts, this fires the warmup endpoint
// in a loop (max 3 batches = 24 places enriched per visit). Shows a tiny
// status pill — no button required.

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Status =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "blocked"; apis: { name: string; enabled: boolean; reason?: string; api_id?: string }[] }
  | { phase: "running"; enriched: number; remaining: number; aiSummaries: number; batch: number }
  | { phase: "done"; enriched: number; aiSummaries: number }
  | { phase: "error"; message: string };

// 10 batches × 6 places = 60 places per visit (covers a whole regional
// catalogue like Côte d'Azur in one go). router.refresh() between batches
// so photos appear progressively. Each batch is gated by checkBudget so
// soft cap $10 still wins if something goes wrong.
const MAX_BATCHES = 10;

export default function AutoWarmup({ tripId }: { tripId: string }) {
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const startedRef = useRef(false);
  const router = useRouter();

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      setStatus({ phase: "checking" });

      // 1) Diagnose Google APIs first — fail fast with actionable message
      try {
        const d = await fetch("/api/admin/diagnose").then((r) => r.json());
        if (!d.ok) {
          setStatus({ phase: "blocked", apis: d.apis ?? [] });
          return;
        }
      } catch {
        setStatus({ phase: "error", message: "تعذّر التشخيص" });
        return;
      }

      // 2) Run warmup batches until either all done or hit cap
      let totalEnriched = 0;
      let totalAi = 0;
      for (let batch = 1; batch <= MAX_BATCHES; batch++) {
        setStatus({ phase: "running", enriched: totalEnriched, remaining: 0, aiSummaries: totalAi, batch });
        try {
          const r = await fetch(`/api/trips/${tripId}/warmup`, { method: "POST" });
          const data = await r.json();
          if (data.error) {
            setStatus({ phase: "error", message: data.error });
            return;
          }
          totalEnriched += data.enriched ?? 0;
          totalAi += data.ai_summaries ?? 0;
          // Refresh server data so user sees newly fetched photos progressively
          if ((data.enriched ?? 0) > 0) router.refresh();
          if ((data.enriched ?? 0) === 0 || (data.remaining ?? 0) === 0) {
            break;
          }
        } catch {
          setStatus({ phase: "error", message: "فشل الاتصال" });
          return;
        }
      }

      setStatus({ phase: "done", enriched: totalEnriched, aiSummaries: totalAi });
      if (totalEnriched > 0) router.refresh();
    })();
  }, [tripId, router]);

  if (status.phase === "idle" || status.phase === "checking") {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-2.5 mt-3 text-[11.5px] text-blue-900 flex items-center gap-2">
        <span className="animate-pulse">⏳</span>
        <span>يفحص الاتصال بـ Google...</span>
      </div>
    );
  }

  if (status.phase === "blocked") {
    const blocked = status.apis.filter((a) => !a.enabled);
    return (
      <div className="bg-rose-50 border-2 border-rose-300 rounded-xl p-3 mt-3 text-[12px] text-rose-900">
        <div className="flex items-start gap-2">
          <span className="text-lg shrink-0">⚠️</span>
          <div className="flex-1">
            <div className="font-bold mb-1">
              {blocked.map((b) => b.name).join(" + ")} مُعطّل في Google Cloud
            </div>
            <p className="leading-relaxed mb-2">
              لتظهر الصور والتقييمات، فعّل الـ API:
            </p>
            <ol className="list-decimal pr-4 space-y-1 mb-2 leading-relaxed">
              {blocked.map((b) => (
                <li key={b.api_id}>
                  افتح{" "}
                  <a
                    href={`https://console.cloud.google.com/apis/library/${b.api_id}?project=rihlaapp-498219`}
                    target="_blank"
                    rel="noopener"
                    className="underline font-bold text-rose-700"
                  >
                    {b.name} في Google Cloud
                  </a>
                  <div className="text-[10px] text-rose-700 mt-0.5">
                    Service: {b.api_id}
                  </div>
                </li>
              ))}
              <li>اضغط <b>Enable</b> ثم ارجع هنا وحدّث الصفحة</li>
            </ol>
            <div className="text-[10.5px] text-rose-700 bg-rose-100 rounded p-1.5">
              ضمن الحد المجاني الشهري لـ Google · حدود يومية صارمة + سقف شهري $1.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status.phase === "running") {
    return (
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-2.5 mt-3 text-[11.5px] text-violet-900 flex items-center gap-2">
        <span className="animate-pulse">🖼</span>
        <span>
          يجلب الصور والتقييمات تلقائياً... (دفعة {status.batch}/{MAX_BATCHES})
        </span>
      </div>
    );
  }

  if (status.phase === "done") {
    if (status.enriched === 0) return null;
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mt-3 text-[11.5px] text-emerald-900 flex items-center gap-2">
        <span>✓</span>
        <span>
          جلبت {status.enriched} صور
          {status.aiSummaries > 0 ? ` + ${status.aiSummaries} ملخص ذكي بالعربي` : ""}
        </span>
      </div>
    );
  }

  if (status.phase === "error") {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 mt-3 text-[11.5px] text-amber-900">
        ⚠️ {status.message}
      </div>
    );
  }

  return null;
}
