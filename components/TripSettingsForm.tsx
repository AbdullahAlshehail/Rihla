"use client";

import type { Trip, BudgetAssumptions } from "@/lib/supabase/database.types";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { estimateBudget, confidenceLabel, confidenceColor } from "@/lib/budget/estimator";
import { fmtMoneySAR } from "@/lib/utils";

export default function TripSettingsForm({
  trip,
  budget,
}: {
  trip: Trip;
  budget: BudgetAssumptions | null;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const [f, setF] = useState({
    name: trip.name,
    destination_city: trip.destination_city ?? "",
    start_date: trip.start_date ?? "",
    end_date: trip.end_date ?? "",
    travelers: trip.travelers,
    budget_style: trip.budget_style,
    hotel_name: trip.hotel_name ?? "",
    hotel_address: trip.hotel_address ?? "",
  });
  const [b, setB] = useState<BudgetAssumptions>({
    trip_id: trip.id,
    flight_total_sar: budget?.flight_total_sar ?? 0,
    hotel_per_night_sar: budget?.hotel_per_night_sar ?? 0,
    nights: budget?.nights ?? 0,
    transport_daily_sar: budget?.transport_daily_sar ?? 0,
    misc_daily_sar: budget?.misc_daily_sar ?? 0,
    confidence: budget?.confidence ?? "medium",
    notes: budget?.notes ?? null,
  });

  // Quick live preview using current inputs (without actual places).
  const preview = estimateBudget({
    trip: { rates: trip.rates ?? { SAR: 1 }, travelers: f.travelers },
    flightSar: b.flight_total_sar,
    hotelPerNightSar: b.hotel_per_night_sar,
    nights: b.nights,
    transportDailySar: b.transport_daily_sar,
    miscDailySar: b.misc_daily_sar,
    placesByDay: [],
  });

  async function save() {
    setSaving(true);
    setErr("");
    setMsg("");
    const resp = await fetch(`/api/trips/${trip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trip: f, budget: b }),
    });
    setSaving(false);
    if (!resp.ok) {
      setErr((await resp.json()).error ?? "تعذّر الحفظ");
      return;
    }
    setMsg("✓ انحفظت التغييرات");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="bg-card border border-line rounded-2xl p-4 shadow space-y-3">
        <h2 className="font-bold text-sm text-sea">معلومات الرحلة</h2>
        <Input label="اسم الرحلة" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
        <Input label="الوجهة" value={f.destination_city} onChange={(v) => setF({ ...f, destination_city: v })} />
        <div className="grid grid-cols-2 gap-2">
          <Input label="بداية" type="date" value={f.start_date} onChange={(v) => setF({ ...f, start_date: v })} />
          <Input label="نهاية" type="date" value={f.end_date} onChange={(v) => setF({ ...f, end_date: v })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="عدد المسافرين" type="number" value={String(f.travelers)} onChange={(v) => setF({ ...f, travelers: +v || 1 })} />
          <Select label="مستوى الميزانية" value={f.budget_style} onChange={(v) => setF({ ...f, budget_style: v as Trip["budget_style"] })}>
            <option value="economical">اقتصادي</option>
            <option value="mid">متوسط</option>
            <option value="luxury">فاخر</option>
          </Select>
        </div>
        <Input label="اسم الفندق" value={f.hotel_name} onChange={(v) => setF({ ...f, hotel_name: v })} />
        <Input label="عنوان أو رابط Maps للفندق" value={f.hotel_address} onChange={(v) => setF({ ...f, hotel_address: v })} dir="ltr" />
        <p className="text-[11px] text-muted">سنحوّل العنوان لإحداثيات تلقائياً عند الحفظ.</p>
      </section>

      <section className="bg-card border border-line rounded-2xl p-4 shadow space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-sm text-sea">الميزانية (ر.س)</h2>
          <span className={`text-[11px] font-bold ${confidenceColor(preview.confidence)}`}>
            {confidenceLabel(preview.confidence)}
          </span>
        </div>
        <p className="text-[11px] text-muted">
          كل المبالغ بالريال. الأماكن الأوروبية تتحوّل تلقائياً بسعر صرف رحلتك.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Input label="طيران (إجمالي)" type="number" value={String(b.flight_total_sar)} onChange={(v) => setB({ ...b, flight_total_sar: +v || 0 })} />
          <Input label="فندق/ليلة" type="number" value={String(b.hotel_per_night_sar)} onChange={(v) => setB({ ...b, hotel_per_night_sar: +v || 0 })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input label="عدد الليالي" type="number" value={String(b.nights)} onChange={(v) => setB({ ...b, nights: +v || 0 })} />
          <Input label="مواصلات/يوم/شخص" type="number" value={String(b.transport_daily_sar)} onChange={(v) => setB({ ...b, transport_daily_sar: +v || 0 })} />
        </div>
        <Input label="مصروف يومي/شخص" type="number" value={String(b.misc_daily_sar)} onChange={(v) => setB({ ...b, misc_daily_sar: +v || 0 })} />

        <div className="bg-sand/40 rounded-xl p-3 mt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted">إجمالي تقديري</span>
            <b className="font-serif text-xl">{fmtMoneySAR(preview.total)}</b>
          </div>
          {preview.assumptions.length > 0 && (
            <ul className="text-[11px] text-muted mt-2 space-y-0.5">
              {preview.assumptions.map((a, i) => (
                <li key={i}>· {a}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {err && <p className="text-danger font-bold text-sm">{err}</p>}
      {msg && <p className="text-ok font-bold text-sm">{msg}</p>}

      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-coral text-white font-bold py-3 rounded-xl disabled:opacity-60 min-h-[48px] shadow"
      >
        {saving ? "⏳ جاري الحفظ..." : "✓ احفظ"}
      </button>

      <DangerZone tripId={trip.id} tripName={trip.name} />
    </div>
  );
}

function DangerZone({ tripId, tripName }: { tripId: string; tripName: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  async function doDelete() {
    setDeleting(true); setErr("");
    try {
      const r = await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error ?? "تعذّر الحذف");
      }
      router.push("/trips");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذّر الحذف");
      setDeleting(false);
    }
  }

  return (
    <section className="mt-8 pt-5 border-t border-line">
      <h2 className="font-serif font-extrabold text-base text-danger mb-2">منطقة الخطر</h2>
      {!confirm ? (
        <button
          onClick={() => setConfirm(true)}
          className="w-full bg-white border-2 border-danger text-danger font-bold py-3 rounded-xl active:bg-danger/5 min-h-[48px]"
        >
          🗑 حذف الرحلة
        </button>
      ) : (
        <div className="rounded-xl bg-danger/5 border-2 border-danger p-4">
          <p className="text-sm font-bold text-ink mb-2">
            متأكد تبي تحذف <span className="text-danger">{tripName}</span>؟
          </p>
          <p className="text-[12px] text-muted mb-3">
            بنحذف الخطة كاملة وكل عناصرها. ما يقدر يرجع.
          </p>
          {err && <p className="text-danger font-bold text-sm mb-2">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={doDelete}
              disabled={deleting}
              className="flex-1 bg-danger text-white font-bold py-2.5 rounded-xl disabled:opacity-60 min-h-[44px]"
            >
              {deleting ? "⏳ جاري الحذف..." : "نعم، احذف"}
            </button>
            <button
              onClick={() => setConfirm(false)}
              disabled={deleting}
              className="flex-1 bg-white border border-line font-bold py-2.5 rounded-xl min-h-[44px]"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Input({ label, value, onChange, type = "text", dir }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; dir?: "ltr" | "rtl";
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-sea mb-1">{label}</label>
      <input
        type={type}
        value={value}
        dir={dir}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-line rounded-xl px-3 py-2 text-[15px] outline-none focus:border-sea focus:ring-2 focus:ring-sea/15"
      />
    </div>
  );
}

function Select({ label, value, onChange, children }: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-sea mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-line rounded-xl px-3 py-2 text-[15px] outline-none focus:border-sea focus:ring-2 focus:ring-sea/15"
      >
        {children}
      </select>
    </div>
  );
}
