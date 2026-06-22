"use client";

// "الحجوزات والتكاليف" — Bookings & Costs page.
//
// Single screen that handles 6 booking types (flight/hotel/event/transport/
// expense/file). Local file uploads go straight to Supabase Storage (private
// bucket "booking-files") under bookings/{user_id}/{trip_id}/{booking_id}/.
// All API calls go through /api/trips/[tripId]/bookings/*.

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  Trip, TripBooking, BookingType, PaidStatus, Currency,
} from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { fmtDayLong, fmtMins } from "@/lib/utils";

// ─── Types & labels ───────────────────────────────────────────────────────

const TYPE_META: Record<BookingType, { ar: string; emoji: string; accent: string }> = {
  flight:    { ar: "طيران",       emoji: "✈️", accent: "border-sky-300 bg-sky-50/40" },
  hotel:     { ar: "فندق",        emoji: "🏨", accent: "border-amber-300 bg-amber-50/40" },
  event:     { ar: "تذكرة/فعالية", emoji: "🎫", accent: "border-violet-300 bg-violet-50/40" },
  transport: { ar: "مواصلات",     emoji: "🚆", accent: "border-emerald-300 bg-emerald-50/40" },
  expense:   { ar: "مصروف",       emoji: "💳", accent: "border-stone-300 bg-stone-50" },
  file:      { ar: "ملف",          emoji: "📎", accent: "border-stone-300 bg-stone-50" },
};

const PAID_META: Record<PaidStatus, { ar: string; cls: string }> = {
  paid:    { ar: "مدفوع",          cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  unpaid:  { ar: "غير مدفوع",      cls: "bg-rose-50 text-rose-700 border-rose-200" },
  partial: { ar: "مدفوع جزئياً",   cls: "bg-amber-50 text-amber-800 border-amber-200" },
  unknown: { ar: "غير محدد",       cls: "bg-stone-50 text-stone-700 border-stone-200" },
};

const CURRENCIES: Currency[] = ["SAR", "EUR", "USD", "GBP", "AED"];

const BUDGET_DEFAULTS_SAR: Record<NonNullable<Trip["budget_style"]>, number> = {
  economical: 250,
  mid: 600,
  luxury: 1500,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtAmount(amount: number | null, currency: Currency | null): string {
  if (amount == null) return "—";
  const c = currency ?? "SAR";
  const rounded = Math.round(amount);
  if (c === "SAR") return `${rounded.toLocaleString("en")} ر.س`;
  return `${rounded.toLocaleString("en")} ${c}`;
}

function maskRef(ref: string | null): string | null {
  if (!ref) return null;
  if (ref.length <= 4) return ref;
  return `${ref.slice(0, 2)}•••${ref.slice(-3)}`;
}

function toSAR(amount: number, currency: Currency, rates: Record<string, number>): number {
  if (currency === "SAR") return amount;
  const fallback: Record<Currency, number> = { SAR: 1, EUR: 4.1, USD: 3.75, GBP: 4.8, AED: 1.02 };
  const r = rates[currency] ?? fallback[currency] ?? 1;
  return amount * r;
}

function nightsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!isFinite(da) || !isFinite(db) || db <= da) return null;
  return Math.round((db - da) / 86_400_000);
}

function tripDurationDays(trip: Trip): number {
  if (!trip.start_date || !trip.end_date) return 1;
  const a = new Date(trip.start_date).getTime();
  const b = new Date(trip.end_date).getTime();
  if (!isFinite(a) || !isFinite(b) || b < a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

// ─── Main screen ──────────────────────────────────────────────────────────

export default function BookingsScreen({
  trip,
  initialBookings,
}: {
  trip: Trip;
  initialBookings: TripBooking[];
}) {
  const [bookings, setBookings] = useState(initialBookings);
  const [sheetType, setSheetType] = useState<BookingType | null>(null);
  const [editing, setEditing] = useState<TripBooking | null>(null);
  const [initialFile, setInitialFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  async function downscaleImage(file: File, maxDim: number, quality: number): Promise<File> {
  if (typeof window === "undefined") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image_decode_failed"));
      i.src = url;
    });
    const { width: w, height: h } = img;
    if (Math.max(w, h) <= maxDim && file.size < 1_200_000) return file; // already small enough
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const targetW = Math.round(w * scale);
    const targetH = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Smart upload — sends an image to /api/.../extract, pre-fills the form.
  async function handleSmartUpload(rawFile: File) {
    setExtractError(null);
    setExtracting(true);
    try {
      if (!rawFile.type.startsWith("image/")) {
        throw new Error("نوع الملف غير مدعوم. ارفع صورة JPG أو PNG.");
      }
      // Downscale large phone photos client-side: keeps us under the 5MB API
      // cap, cuts upload time 5–10×, and OCR-quality stays high at 1600px.
      // Sent file kept in the form (for attachment) is the downscaled version.
      const file = await downscaleImage(rawFile, 1600, 0.85).catch(() => rawFile);
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("الملف أكبر من 5MB حتى بعد الضغط. اختر صورة أوضح.");
      }
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/trips/${trip.id}/bookings/extract`, {
        method: "POST",
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(
          data?.error === "ai_unavailable" ? "خدمة الاستخراج غير مفعّلة الآن. أضف يدوياً."
          : data?.error === "file_too_large" ? "الملف أكبر من 5MB."
          : data?.error === "anthropic_http" || data?.error === "no_tool_use" ? "تعذّر تحليل الصورة. حاول صورة أوضح."
          : data?.error === "anthropic_network" ? "تعذّر الاتصال بالخدمة. جرّب مرة ثانية."
          : "خطأ في استخراج البيانات.",
        );
      }
      const e = data.extracted ?? {};
      const t: BookingType = (["flight","hotel","event","transport","expense","file"] as BookingType[])
        .includes(e.type) ? e.type : "expense";

      // Build a synthetic TripBooking shell to drive the form via `editing`.
      const draft: TripBooking = {
        id: "", user_id: "", trip_id: trip.id,
        type: t,
        title: e.title ?? "",
        subtitle: e.subtitle ?? null,
        start_at: e.start_at ?? null,
        end_at: e.end_at ?? null,
        location_name: e.location_name ?? null,
        address: e.address ?? null,
        lat: null, lng: null,
        amount: typeof e.amount === "number" ? e.amount : null,
        currency: ["SAR","EUR","USD","GBP","AED"].includes(e.currency) ? e.currency : null,
        paid_status: ["paid","unpaid","partial","unknown"].includes(e.paid_status) ? e.paid_status : "unknown",
        reference: e.reference ?? null,
        metadata: (e.metadata && typeof e.metadata === "object") ? e.metadata as Record<string, unknown> : {},
        file_path: null, file_mime: file.type,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setEditing(draft);
      setInitialFile(file);
      setSheetType(t);
    } catch (err: unknown) {
      setExtractError(err instanceof Error ? err.message : "خطأ غير متوقّع");
    } finally {
      setExtracting(false);
    }
  }

  const rates = (trip.rates as Record<string, number>) ?? {};
  const totals = useMemo(() => computeTotals(bookings, rates), [bookings, rates]);
  const days = tripDurationDays(trip);
  const dailyEstimateSar = trip.budget_style ? BUDGET_DEFAULTS_SAR[trip.budget_style] : 600;
  const tripBudgetSar = dailyEstimateSar * days;
  const remaining = tripBudgetSar - totals.totalSar;

  function upsertLocal(b: TripBooking) {
    setBookings((prev) => {
      const exists = prev.some((p) => p.id === b.id);
      const next = exists ? prev.map((p) => (p.id === b.id ? b : p)) : [...prev, b];
      return next.sort((a, c) => {
        if (a.start_at && c.start_at) return a.start_at.localeCompare(c.start_at);
        if (a.start_at) return -1;
        if (c.start_at) return 1;
        return c.created_at.localeCompare(a.created_at);
      });
    });
  }

  function removeLocal(id: string) {
    setBookings((prev) => prev.filter((b) => b.id !== id));
  }

  return (
    <main
      className="max-w-2xl mx-auto px-4"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 10px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
      }}
    >
      {/* Sticky back chip — same pattern as NowScreen */}
      <div
        className="sticky z-20 -mx-4 px-4 pb-2 bg-sand/85 backdrop-blur-sm"
        style={{ top: "env(safe-area-inset-top)" }}
      >
        <Link
          href={`/trips/${trip.id}`}
          className="inline-flex items-center gap-1.5 bg-white border border-line text-sea text-sm font-bold px-3 py-2 rounded-pill shadow-sm min-h-[44px] active:scale-95 transition"
        >
          <span>←</span>
          <span className="line-clamp-1 max-w-[200px]">{trip.name}</span>
        </Link>
      </div>

      {/* Header */}
      <header className="bg-gradient-to-br from-sea via-sea-600 to-sea-700 text-white rounded-2xl p-4 shadow-md mb-3 mt-1">
        <h1 className="font-serif font-extrabold text-2xl">الحجوزات والتكاليف</h1>
        <p className="text-[12px] opacity-90 mt-1 leading-relaxed">
          احفظ حجوزاتك المهمة وشوف تكلفة الرحلة بوضوح.
        </p>
      </header>

      {/* Summary cards */}
      <section className="grid grid-cols-2 gap-2 mb-3">
        <SummaryCard label="إجمالي" value={fmtAmount(totals.totalSar, "SAR")} accent="bg-white border-line" />
        <SummaryCard label="مدفوع" value={fmtAmount(totals.paidSar, "SAR")} accent="bg-emerald-50/50 border-emerald-200" />
        <SummaryCard label="غير مدفوع" value={fmtAmount(totals.unpaidSar, "SAR")} accent="bg-rose-50/50 border-rose-200" />
        <SummaryCard
          label={trip.budget_style ? "الميزانية المتبقية" : "تقدير يومي"}
          value={trip.budget_style ? fmtAmount(remaining, "SAR") : fmtAmount(dailyEstimateSar, "SAR")}
          accent={remaining < 0 ? "bg-rose-50/50 border-rose-200" : "bg-white border-line"}
        />
      </section>

      {/* Breakdown — only show categories with values */}
      {totals.byType.length > 0 && (
        <section className="bg-white border border-line rounded-2xl p-3 mb-3">
          <div className="text-[10.5px] font-bold text-muted mb-2">حسب الفئة</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px]">
            {totals.byType.map(({ type, sar }) => (
              <div key={type} className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <span>{TYPE_META[type].emoji}</span>
                  <span className="font-bold text-stone-700">{TYPE_META[type].ar}</span>
                </span>
                <span className="font-bold text-ink">{fmtAmount(sar, "SAR")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Smart upload — primary CTA. AI reads ticket/invoice photo and
            pre-fills the form, so the user just confirms and saves. ─── */}
      <section className="mb-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleSmartUpload(f);
            e.target.value = ""; // allow re-select same file
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={extracting}
          className="w-full bg-gradient-to-br from-violet-600 via-fuchsia-600 to-rose-500 text-white rounded-2xl p-3.5 shadow-md active:scale-[0.99] transition disabled:opacity-70 disabled:scale-100"
        >
          <div className="flex items-center gap-3 text-right">
            <div className="text-3xl shrink-0">
              {extracting ? (
                <span className="inline-block w-7 h-7 rounded-full border-3 border-white/30 border-t-white animate-spin" />
              ) : "📸"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-[14.5px]">
                {extracting ? "جارٍ قراءة التذكرة…" : "ارفع صورة تذكرة أو فاتورة"}
              </div>
              <div className="text-[11.5px] opacity-95 mt-0.5">
                {extracting
                  ? "نستخرج العنوان والتاريخ والمبلغ تلقائياً"
                  : "نعبّي البيانات لك تلقائياً · مجاناً"}
              </div>
            </div>
            <span className="text-xl shrink-0 opacity-90">←</span>
          </div>
        </button>
        {extractError && (
          <div className="mt-2 bg-rose-50 border border-rose-200 text-rose-900 text-[12px] rounded-xl px-3 py-2 leading-snug">
            ⚠ {extractError}
          </div>
        )}
      </section>

      {/* Manual quick actions — kept as a secondary path */}
      <section className="mb-3">
        <div className="text-[11px] font-bold text-muted mb-2">أو أضف يدوياً</div>
        <div className="grid grid-cols-3 gap-2">
          <QuickAction emoji="✈️" ar="طيران" onClick={() => { setEditing(null); setInitialFile(null); setSheetType("flight"); }} />
          <QuickAction emoji="🏨" ar="فندق"  onClick={() => { setEditing(null); setInitialFile(null); setSheetType("hotel"); }} />
          <QuickAction emoji="🎫" ar="تذكرة" onClick={() => { setEditing(null); setInitialFile(null); setSheetType("event"); }} />
          <QuickAction emoji="🚆" ar="مواصلات" onClick={() => { setEditing(null); setInitialFile(null); setSheetType("transport"); }} />
          <QuickAction emoji="💳" ar="مصروف"   onClick={() => { setEditing(null); setInitialFile(null); setSheetType("expense"); }} />
          <QuickAction emoji="📎" ar="ملف"     onClick={() => { setEditing(null); setInitialFile(null); setSheetType("file"); }} />
        </div>
      </section>

      {/* Sections — group by type, hide empty */}
      {bookings.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          {(["upcoming", "hotel", "flight", "event", "transport", "expense", "file"] as const).map((sec) => {
            const rows = filterSection(bookings, sec);
            if (rows.length === 0) return null;
            return (
              <Section
                key={sec}
                title={sectionTitle(sec)}
                emoji={sectionEmoji(sec)}
                rows={rows}
                onEdit={(b) => { setEditing(b); setSheetType(b.type); }}
                onDelete={async (id) => {
                  if (!confirm("حذف الحجز؟")) return;
                  const r = await fetch(`/api/trips/${trip.id}/bookings/${id}`, { method: "DELETE" });
                  if (r.ok) {
                    removeLocal(id);
                    router.refresh();
                  } else alert("فشل الحذف");
                }}
                onUseAsHotel={async (id) => {
                  const r = await fetch(`/api/trips/${trip.id}/bookings/${id}/use-as-hotel`, { method: "POST" });
                  if (r.ok) {
                    alert("✓ صار هذا فندق الرحلة. يظهر في صفحة 'وين أروح الآن' وحسابات المسافة.");
                    router.refresh();
                  } else alert("فشل الربط بالرحلة");
                }}
                onAddToPlan={async (b) => {
                  // For events only — store metadata for now; future: insert into itinerary_items
                  if (b.type !== "event") return;
                  alert("سيتم ربط الفعالية بالخطة في تحديث قريب. مؤقتاً تظهر في صفحة الحجوزات.");
                }}
              />
            );
          })}
        </div>
      )}

      {/* Bank-import placeholder */}
      <div className="mt-5 bg-white border border-line rounded-2xl p-3 text-center text-[12px] text-muted">
        🏦 استيراد من كشف بنك — قريباً
      </div>

      {/* Sheet — single component handles all types via prop */}
      {sheetType && (
        <BookingFormSheet
          trip={trip}
          type={sheetType}
          editing={editing}
          initialFile={initialFile}
          onClose={() => { setSheetType(null); setEditing(null); setInitialFile(null); }}
          onSaved={(b) => {
            upsertLocal(b);
            setSheetType(null);
            setEditing(null);
            setInitialFile(null);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className={`rounded-2xl border p-3 ${accent}`}>
      <div className="text-[10.5px] font-bold text-muted mb-0.5">{label}</div>
      <div className="font-extrabold text-base text-ink leading-none">{value}</div>
    </div>
  );
}

function QuickAction({ emoji, ar, onClick }: { emoji: string; ar: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-white border border-line rounded-2xl p-3 text-center active:scale-[0.97] transition min-h-[64px]"
    >
      <div className="text-xl leading-none">{emoji}</div>
      <div className="font-bold text-[12px] text-stone-800 mt-1">{ar}</div>
    </button>
  );
}

function EmptyState() {
  return (
    <div className="bg-white border border-line rounded-2xl p-5 text-center text-[13px] text-stone-700 leading-relaxed">
      أضف حجوزاتك المهمة مثل السكن والطيران والتذاكر، ونحسب لك تكلفة الرحلة ونربطها بالخطة.
    </div>
  );
}

function Section({
  title, emoji, rows, onEdit, onDelete, onUseAsHotel, onAddToPlan,
}: {
  title: string;
  emoji: string;
  rows: TripBooking[];
  onEdit: (b: TripBooking) => void;
  onDelete: (id: string) => void;
  onUseAsHotel: (id: string) => void;
  onAddToPlan: (b: TripBooking) => void;
}) {
  return (
    <section>
      <h2 className="text-[13px] font-extrabold text-ink mb-2 flex items-center gap-1.5">
        <span>{emoji}</span>
        <span>{title}</span>
        <span className="text-[10.5px] font-bold text-muted">· {rows.length}</span>
      </h2>
      <div className="space-y-2">
        {rows.map((b) => (
          <BookingCard
            key={b.id}
            booking={b}
            onEdit={() => onEdit(b)}
            onDelete={() => onDelete(b.id)}
            onUseAsHotel={() => onUseAsHotel(b.id)}
            onAddToPlan={() => onAddToPlan(b)}
          />
        ))}
      </div>
    </section>
  );
}

function BookingCard({
  booking, onEdit, onDelete, onUseAsHotel, onAddToPlan,
}: {
  booking: TripBooking;
  onEdit: () => void;
  onDelete: () => void;
  onUseAsHotel: () => void;
  onAddToPlan: () => void;
}) {
  const meta = TYPE_META[booking.type];
  const paid = PAID_META[booking.paid_status];
  const nights = booking.type === "hotel" ? nightsBetween(booking.start_at, booking.end_at) : null;
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [, startTx] = useTransition();

  async function openFile() {
    if (!booking.file_path) return;
    if (fileUrl) { window.open(fileUrl, "_blank", "noopener"); return; }
    startTx(async () => {
      const sb = createClient();
      const { data, error } = await sb.storage
        .from("booking-files")
        .createSignedUrl(booking.file_path!, 60); // 1 minute window
      if (data?.signedUrl) {
        setFileUrl(data.signedUrl);
        window.open(data.signedUrl, "_blank", "noopener");
      } else {
        alert(error?.message ?? "تعذّر فتح الملف");
      }
    });
  }

  return (
    <article className={`bg-white border-2 rounded-2xl p-3 ${meta.accent}`}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none">{meta.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-[14px] text-ink leading-tight line-clamp-2">{booking.title}</h3>
            <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-pill border whitespace-nowrap ${paid.cls}`}>
              {paid.ar}
            </span>
          </div>
          {booking.subtitle && (
            <p className="text-[11.5px] text-stone-600 mt-0.5 line-clamp-1">{booking.subtitle}</p>
          )}
          <p className="text-[11.5px] text-stone-700 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {booking.start_at && (
              <span>
                {fmtDayLong(booking.start_at.slice(0, 10))}
                {booking.end_at && booking.end_at !== booking.start_at && (
                  <> → {fmtDayLong(booking.end_at.slice(0, 10))}</>
                )}
                {nights != null && <> · {nights} ليلة</>}
              </span>
            )}
            {booking.location_name && <span>📍 {booking.location_name}</span>}
          </p>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px]">
            <span className="font-extrabold text-ink">{fmtAmount(booking.amount, booking.currency)}</span>
            {booking.reference && (
              <span className="text-stone-500 font-mono text-[10.5px]">Ref: {maskRef(booking.reference)}</span>
            )}
          </div>

          {/* Actions */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button onClick={onEdit} className="text-[12px] font-bold bg-white border border-line text-stone-800 px-3 min-h-[44px] rounded-pill active:scale-95 transition">✏ تعديل</button>
            {booking.file_path && (
              <button onClick={openFile} className="text-[12px] font-bold bg-sea text-white px-3 min-h-[44px] rounded-pill active:scale-95 transition">📎 افتح الملف</button>
            )}
            {booking.type === "hotel" && (
              <button onClick={onUseAsHotel} className="text-[12px] font-bold bg-amber-500 text-white px-3 min-h-[44px] rounded-pill active:scale-95 transition">🏨 اعتبره فندق الرحلة</button>
            )}
            {booking.type === "event" && (
              <button onClick={onAddToPlan} className="text-[12px] font-bold bg-violet-500 text-white px-3 min-h-[44px] rounded-pill active:scale-95 transition">＋ أضف للخطة</button>
            )}
            <button onClick={onDelete} className="text-[12px] font-bold bg-white border border-rose-200 text-rose-700 px-3 min-h-[44px] rounded-pill active:scale-95 transition ms-auto">🗑 حذف</button>
          </div>
        </div>
      </div>
    </article>
  );
}

// ─── Form Sheet ───────────────────────────────────────────────────────────

function BookingFormSheet({
  trip, type, editing, initialFile, onClose, onSaved,
}: {
  trip: Trip;
  type: BookingType;
  editing: TripBooking | null;
  initialFile?: File | null;
  onClose: () => void;
  onSaved: (b: TripBooking) => void;
}) {
  // `editing` is "real" only if it carries a saved DB id. Smart-upload passes
  // an empty-id shell as a pre-fill vehicle — that's still a CREATE, not edit.
  const isEdit = editing != null && editing.id !== "";
  const [title, setTitle] = useState(editing?.title ?? "");
  const [subtitle, setSubtitle] = useState(editing?.subtitle ?? "");
  const [startAt, setStartAt] = useState(editing?.start_at?.slice(0, 16) ?? "");
  const [endAt, setEndAt] = useState(editing?.end_at?.slice(0, 16) ?? "");
  const [locationName, setLocationName] = useState(editing?.location_name ?? "");
  const [address, setAddress] = useState(editing?.address ?? "");
  const [amount, setAmount] = useState<string>(editing?.amount != null ? String(editing.amount) : "");
  const [currency, setCurrency] = useState<Currency>(editing?.currency ?? "SAR");
  const [paidStatus, setPaidStatus] = useState<PaidStatus>(editing?.paid_status ?? "unknown");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [metaRaw, setMetaRaw] = useState<Record<string, string>>(
    () => {
      const m = (editing?.metadata ?? {}) as Record<string, unknown>;
      const out: Record<string, string> = {};
      // Preserve original primitive types via String() not JSON.stringify
      // (audit fix 2026-06-15 — JSON.stringify(2) → "2", JSON.stringify("a")
      // → "\"a\"", which leaked quotes back to the form).
      for (const [k, v] of Object.entries(m)) {
        out[k] = v == null ? "" : typeof v === "string" ? v : String(v);
      }
      return out;
    },
  );
  // Smart-upload pre-attaches the photo so the user doesn't re-pick it.
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [, startTx] = useTransition();

  const supabase = createClient();

  function setMeta(k: string, v: string) {
    setMetaRaw((m) => ({ ...m, [k]: v }));
  }

  async function uploadFileIfNeeded(bookingId: string, userId: string): Promise<{ path: string; mime: string } | null> {
    if (!file) return null;
    // Client-side guard — server has 10MB limit on the bucket but UX is
    // friendlier if we reject early (audit fix 2026-06-15).
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("الملف أكبر من 10MB — اختر ملفاً أصغر");
    }
    // Editing a booking that already had a file → remove the old one first
    // so storage doesn't accumulate orphans.
    if (editing?.file_path && editing.file_path !== file.name) {
      await supabase.storage.from("booking-files").remove([editing.file_path]).catch(() => {});
    }
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
    const path = `bookings/${userId}/${trip.id}/${bookingId}/${Date.now()}_${safe}`;
    const { error } = await supabase.storage.from("booking-files").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
    if (error) throw new Error(error.message);
    return { path, mime: file.type };
  }

  async function submit() {
    if (!title.trim()) {
      alert("اكتب عنوان الحجز");
      return;
    }
    setSubmitting(true);
    try {
      // Get user id once for file path
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("غير مسجّل");

      const payload: Record<string, unknown> = {
        type,
        title: title.trim(),
        subtitle: subtitle.trim() || null,
        start_at: startAt ? new Date(startAt).toISOString() : null,
        end_at: endAt ? new Date(endAt).toISOString() : null,
        location_name: locationName.trim() || null,
        address: address.trim() || null,
        amount: amount.trim() ? Number(amount) : null,
        currency: amount.trim() ? currency : null,
        paid_status: paidStatus,
        reference: reference.trim() || null,
        metadata: metaRaw,
      };

      const url = isEdit
        ? `/api/trips/${trip.id}/bookings/${editing!.id}`
        : `/api/trips/${trip.id}/bookings`;
      const method = isEdit ? "PATCH" : "POST";

      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "فشل الحفظ");

      let saved: TripBooking = data.booking;

      // Upload file (after row exists so we can put it under bookings/{user}/{trip}/{id}/)
      if (file) {
        const up = await uploadFileIfNeeded(saved.id, user.id);
        if (up) {
          const r2 = await fetch(`/api/trips/${trip.id}/bookings/${saved.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: up.path, file_mime: up.mime }),
          });
          const d2 = await r2.json();
          if (r2.ok) saved = d2.booking;
        }
      }

      onSaved(saved);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "خطأ غير متوقّع";
      alert(message);
    } finally {
      setSubmitting(false);
    }
  }

  const meta = TYPE_META[type];
  const typeSpecific = renderTypeFields(type, metaRaw, setMeta);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 grid items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-sand rounded-t-3xl shadow-2xl border-t border-line max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}
      >
        <div className="sticky top-0 bg-sand/95 backdrop-blur-sm border-b border-line-soft px-5 py-3 flex items-center justify-between">
          <h2 className="font-serif font-extrabold text-lg text-ink inline-flex items-center gap-2">
            <span>{meta.emoji}</span>
            <span>{isEdit ? "تعديل" : "إضافة"} — {meta.ar}</span>
          </h2>
          <button
            onClick={onClose}
            className="bg-white border border-line text-muted font-bold text-[12px] px-3 min-h-[44px] rounded-pill active:scale-95"
          >
            ✕ إلغاء
          </button>
        </div>

        <div className="p-5 space-y-3">
          {/* Smart-prefill notice — shown only when AI extracted data and the
              booking hasn't been saved yet, so the user knows what to verify. */}
          {!isEdit && initialFile && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-[12.5px] text-emerald-900 flex items-start gap-2">
              <span className="text-base leading-none">✨</span>
              <div className="flex-1 leading-snug">
                <div className="font-bold">تم تعبئة البيانات تلقائياً</div>
                <div className="opacity-85">راجع وعدّل ما يلزم ثم احفظ. الصورة مرفقة مسبقاً.</div>
              </div>
            </div>
          )}

          <Field label="العنوان" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={typeTitlePlaceholder(type)}
              className="w-full bg-white border border-line rounded-xl px-3 py-2.5 min-h-[44px] text-[14px]"
            />
          </Field>

          <Field label="ملاحظة قصيرة">
            <input
              type="text"
              value={subtitle ?? ""}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="مثال: درجة أولى · غرفة بإطلالة · مقعد A12"
              className="w-full bg-white border border-line rounded-xl px-3 py-2.5 min-h-[44px] text-[14px]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label={type === "hotel" ? "تسجيل الدخول" : "البداية"}>
              <input
                type="datetime-local"
                dir="ltr"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[12.5px]"
              />
            </Field>
            <Field label={type === "hotel" ? "تسجيل الخروج" : "النهاية"}>
              <input
                type="datetime-local"
                dir="ltr"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[12.5px]"
              />
            </Field>
          </div>

          {type !== "expense" && (
            <>
              <Field label="المكان">
                <input
                  type="text"
                  value={locationName ?? ""}
                  onChange={(e) => setLocationName(e.target.value)}
                  placeholder="اسم الفندق / المطار / الموقع"
                  className="w-full bg-white border border-line rounded-xl px-3 py-2.5 min-h-[44px] text-[14px]"
                />
              </Field>
              <Field label="العنوان">
                <input
                  type="text"
                  value={address ?? ""}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="اختياري"
                  className="w-full bg-white border border-line rounded-xl px-3 py-2.5 min-h-[44px] text-[14px]"
                />
              </Field>
            </>
          )}

          {typeSpecific}

          <div className="grid grid-cols-3 gap-2">
            <Field label="المبلغ">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]"
              />
            </Field>
            <Field label="العملة">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="w-full bg-white border border-line rounded-xl px-2 py-2.5 min-h-[44px] text-[13px]"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="حالة الدفع">
              <select
                value={paidStatus}
                onChange={(e) => setPaidStatus(e.target.value as PaidStatus)}
                className="w-full bg-white border border-line rounded-xl px-2 py-2.5 min-h-[44px] text-[13px]"
              >
                {(Object.keys(PAID_META) as PaidStatus[]).map((p) => (
                  <option key={p} value={p}>{PAID_META[p].ar}</option>
                ))}
              </select>
            </Field>
          </div>

          {type !== "expense" && (
            <Field label="رقم الحجز / المرجع">
              <input
                type="text"
                value={reference ?? ""}
                onChange={(e) => setReference(e.target.value)}
                placeholder="اختياري"
                className="w-full bg-white border border-line rounded-xl px-3 py-2.5 min-h-[44px] text-[14px]"
              />
            </Field>
          )}

          {/* File upload */}
          {type !== "expense" && (
            <Field label="ملف مرفق (PDF / صورة) — اختياري">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-[12px] bg-white border border-line rounded-xl px-2.5 py-2"
              />
              <p className="text-[10.5px] text-muted mt-1 leading-snug">
                يحفظ بشكل آمن. لا يظهر إلا لك. الحد الأقصى 10 MB.
              </p>
            </Field>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full bg-coral text-white font-bold text-[14px] py-3 rounded-xl active:scale-[0.98] transition disabled:opacity-60"
          >
            {submitting ? "جارٍ الحفظ..." : isEdit ? "✓ حفظ التعديلات" : "✓ احفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold text-stone-700 mb-1">
        {label} {required && <span className="text-rose-600">*</span>}
      </div>
      {children}
    </label>
  );
}

function renderTypeFields(
  type: BookingType,
  meta: Record<string, string>,
  setMeta: (k: string, v: string) => void,
) {
  if (type === "flight") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="من (مطار)">
          <input type="text" value={meta.from ?? ""} onChange={(e) => setMeta("from", e.target.value)} placeholder="RUH / CDG" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]" />
        </Field>
        <Field label="إلى (مطار)">
          <input type="text" value={meta.to ?? ""} onChange={(e) => setMeta("to", e.target.value)} placeholder="NCE" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]" />
        </Field>
        <Field label="رقم الرحلة">
          <input type="text" value={meta.flight_number ?? ""} onChange={(e) => setMeta("flight_number", e.target.value)} placeholder="SV123" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]" />
        </Field>
        <Field label="الأمتعة">
          <input type="text" value={meta.baggage ?? ""} onChange={(e) => setMeta("baggage", e.target.value)} placeholder="2× 23kg" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]" />
        </Field>
      </div>
    );
  }
  if (type === "event") {
    return (
      <Field label="عدد الأشخاص">
        <input type="number" inputMode="numeric" value={meta.people ?? ""} onChange={(e) => setMeta("people", e.target.value)} placeholder="2" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]" />
      </Field>
    );
  }
  if (type === "transport") {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="النوع">
          <select value={meta.kind ?? ""} onChange={(e) => setMeta("kind", e.target.value)} className="w-full bg-white border border-line rounded-xl px-2 py-2.5 min-h-[44px] text-[13px]">
            <option value="">اختر…</option>
            <option value="train">قطار</option>
            <option value="car_rental">تأجير سيارة</option>
            <option value="driver">سائق</option>
            <option value="transfer">ترانسفر</option>
            <option value="other">آخر</option>
          </select>
        </Field>
        <Field label="الشركة">
          <input type="text" value={meta.provider ?? ""} onChange={(e) => setMeta("provider", e.target.value)} placeholder="SNCF / Hertz" className="w-full bg-white border border-line rounded-xl px-2.5 py-2.5 min-h-[44px] text-[14px]" />
        </Field>
      </div>
    );
  }
  if (type === "expense") {
    return (
      <Field label="الفئة">
        <select value={meta.category ?? "food"} onChange={(e) => setMeta("category", e.target.value)} className="w-full bg-white border border-line rounded-xl px-2 py-2.5 min-h-[44px] text-[13px]">
          <option value="food">طعام</option>
          <option value="coffee">قهوة</option>
          <option value="transport">مواصلات</option>
          <option value="shopping">تسوّق</option>
          <option value="activity">نشاط</option>
          <option value="other">آخر</option>
        </select>
      </Field>
    );
  }
  return null;
}

function typeTitlePlaceholder(t: BookingType): string {
  switch (t) {
    case "flight":    return "السعودية SV1234 RUH→NCE";
    case "hotel":     return "Hotel Martinez Cannes";
    case "event":     return "تذكرة متحف أوسي";
    case "transport": return "قطار TGV نيس → باريس";
    case "expense":   return "غداء في La Petite Maison";
    case "file":      return "اسم الملف";
  }
}

// ─── Totals & grouping ────────────────────────────────────────────────────

function computeTotals(bookings: TripBooking[], rates: Record<string, number>) {
  let totalSar = 0, paidSar = 0, unpaidSar = 0;
  const byTypeMap: Partial<Record<BookingType, number>> = {};
  for (const b of bookings) {
    if (b.amount == null || b.amount < 0) continue;
    const sar = toSAR(b.amount, b.currency ?? "SAR", rates);
    totalSar += sar;
    // partial → half-paid heuristic. Better than counting twice (audit fix
    // 2026-06-15). Future: add a partial_paid_amount column for exact splits.
    if (b.paid_status === "paid") paidSar += sar;
    else if (b.paid_status === "unpaid") unpaidSar += sar;
    else if (b.paid_status === "partial") { paidSar += sar / 2; unpaidSar += sar / 2; }
    byTypeMap[b.type] = (byTypeMap[b.type] ?? 0) + sar;
  }
  const byType = (Object.keys(byTypeMap) as BookingType[])
    .map((type) => ({ type, sar: byTypeMap[type] ?? 0 }))
    .sort((a, c) => c.sar - a.sar);
  return { totalSar, paidSar, unpaidSar, byType };
}

function filterSection(
  bookings: TripBooking[],
  sec: "upcoming" | "hotel" | "flight" | "event" | "transport" | "expense" | "file",
): TripBooking[] {
  if (sec === "upcoming") {
    const now = Date.now();
    return bookings.filter((b) => {
      if (!b.start_at) return false;
      const t = new Date(b.start_at).getTime();
      return isFinite(t) && t > now && (t - now) < 1000 * 60 * 60 * 24 * 30;
    }).slice(0, 4);
  }
  return bookings.filter((b) => b.type === sec);
}

function sectionTitle(s: "upcoming" | BookingType): string {
  switch (s) {
    case "upcoming":  return "قريباً";
    case "hotel":     return "الفنادق";
    case "flight":    return "الطيران";
    case "event":     return "التذاكر والفعاليات";
    case "transport": return "المواصلات";
    case "expense":   return "المصاريف";
    case "file":      return "الملفات";
  }
}

function sectionEmoji(s: "upcoming" | BookingType): string {
  if (s === "upcoming") return "⏳";
  return TYPE_META[s].emoji;
}
