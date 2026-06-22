"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  { key: "food", label: "🍽 مطاعم" },
  { key: "coffee", label: "☕ قهاوي" },
  { key: "sight", label: "🏛 معالم" },
  { key: "nature", label: "🌿 طبيعة" },
  { key: "event", label: "🎟 فعاليات" },
  { key: "sweet", label: "🍦 حلا" },
  { key: "bar", label: "🥂 بار" },
];

export default function NewTripPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({
    name: "رحلتي",
    destination_city: "",
    start_date: "",
    end_date: "",
    travelers: 2,
    budget_style: "mid",
    hotel_name: "",
    hotel_address: "",
    preferences: [] as string[],
  });

  function toggle(cat: string) {
    setForm((f) => ({
      ...f,
      preferences: f.preferences.includes(cat)
        ? f.preferences.filter((c) => c !== cat)
        : [...f.preferences, cat],
    }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSubmitting(true);
    const resp = await fetch("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!resp.ok) {
      setErr((await resp.json()).error ?? "تعذّر الحفظ");
      setSubmitting(false);
      return;
    }
    const { id } = await resp.json();
    router.push(`/trips/${id}`);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <header className="mb-5">
        <h1 className="font-serif font-extrabold text-2xl text-sea">رحلة جديدة</h1>
        <p className="text-xs text-muted mt-1">٤ خطوات بسيطة — تقدر تعدّل أي وقت</p>
      </header>

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="اسم الرحلة">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input"
            required
          />
        </Field>

        <Field label="الوجهة (مدينة أو منطقة)">
          <input
            value={form.destination_city}
            onChange={(e) => setForm({ ...form, destination_city: e.target.value })}
            placeholder="مثال: الرياض، نيس، كان"
            className="input"
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="تاريخ البداية">
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="تاريخ النهاية">
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="input"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="عدد المسافرين">
            <input
              type="number"
              min={1}
              max={20}
              value={form.travelers}
              onChange={(e) => setForm({ ...form, travelers: +e.target.value || 1 })}
              className="input"
            />
          </Field>
          <Field label="مستوى الميزانية">
            <select
              value={form.budget_style}
              onChange={(e) => setForm({ ...form, budget_style: e.target.value })}
              className="input unstyled"
            >
              <option value="economical">اقتصادي</option>
              <option value="mid">متوسط</option>
              <option value="luxury">فاخر</option>
            </select>
          </Field>
        </div>

        <Field label="اسم الفندق (اختياري)">
          <input
            value={form.hotel_name}
            onChange={(e) => setForm({ ...form, hotel_name: e.target.value })}
            placeholder="Four Seasons Riyadh"
            className="input"
          />
        </Field>
        <Field label="عنوان أو رابط Google Maps للفندق (اختياري)">
          <input
            value={form.hotel_address}
            onChange={(e) => setForm({ ...form, hotel_address: e.target.value })}
            placeholder="الصق العنوان أو رابط ماب"
            className="input"
            dir="ltr"
          />
          <p className="text-[11px] text-muted mt-1">سنحوّل العنوان لإحداثيات تلقائياً</p>
        </Field>

        <Field label="ما الذي تهتم به؟ (اختر واحد أو أكثر)">
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => toggle(c.key)}
                className={`px-3 py-2 rounded-pill text-sm font-bold border ${
                  form.preferences.includes(c.key)
                    ? "bg-coral text-white border-coral"
                    : "bg-white text-muted border-line"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        {err && <p className="text-danger text-sm font-bold">{err}</p>}

        <div className="flex gap-2 pt-4">
          <button
            type="button"
            onClick={() => history.back()}
            className="flex-1 bg-white border border-line text-muted font-bold py-3 rounded-xl"
          >
            رجوع
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-[2] bg-coral text-white font-bold py-3 rounded-xl disabled:opacity-60 min-h-[48px]"
          >
            {submitting ? "⏳ جاري الحفظ..." : "✓ احفظ الرحلة"}
          </button>
        </div>
      </form>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          background: #fff;
          border: 1px solid #e3d7c3;
          border-radius: 12px;
          padding: 11px 14px;
          color: #1b2a2f;
          font-size: 16px;
          outline: none;
        }
        :global(.input:focus) {
          border-color: #0c4a63;
          box-shadow: 0 0 0 3px rgba(12,74,99,.12);
        }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-sea mb-1.5">{label}</label>
      {children}
    </div>
  );
}
