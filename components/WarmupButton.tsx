"use client";

// Bulk-enrich button — pulls photos + Arabic reviews + AI summary for places
// in the trip's destination city. Cost: ~$0.10 per batch of 8, capped daily.

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function WarmupButton({ tripId }: { tripId: string }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  const router = useRouter();

  async function run() {
    setBusy(true);
    setLast(null);
    try {
      const r = await fetch(`/api/trips/${tripId}/warmup`, { method: "POST" });
      const data = await r.json();
      if (data.error) {
        setLast(`خطأ: ${data.error}`);
      } else if (data.enriched === 0) {
        setLast("الصور كلها جاهزة ✓");
      } else {
        setLast(`جلبت ${data.enriched} صور${data.ai_summaries ? ` + ${data.ai_summaries} ملخص ذكي` : ""}${data.remaining > 0 ? ` · ${data.remaining} باقي` : ""}`);
      }
      router.refresh();
    } catch {
      setLast("تعذر الاتصال");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-purple-200 rounded-2xl p-3 mt-3">
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={busy}
          className="bg-violet-600 text-white font-bold text-xs px-4 py-2 rounded-xl disabled:opacity-50 active:bg-violet-700"
        >
          {busy ? "⏳ يجلب..." : "🖼 جلب الصور والتقييمات"}
        </button>
        <div className="text-[11.5px] text-violet-900 flex-1">
          {last ?? "يجلب ٨ أماكن في المرة (~$0.10) · ضمن المجاني"}
        </div>
      </div>
    </div>
  );
}
