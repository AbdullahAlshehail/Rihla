"use client";

// Onboarding — 3 welcome slides (gradient, floating icon, dots, skip).
// Shown ONCE per device (localStorage `rihla_onboarded`, per design README),
// auto-mounted on the passport landing; replayable from حسابي → الإعدادات
// via <ReplayOnboardingRow />.

import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";

const KEY = "rihla_onboarded";

const SLIDES = [
  {
    icon: "🧭",
    bg: "linear-gradient(165deg,#0c4a63 0%,#0a3a4f 55%,#072a3a 100%)",
    title: "اكتشف أماكن ترند حقيقية",
    body: "أماكن يتكلم عنها الناس فعلاً هالأسبوع — مطاعم، قهوة، معالم — مو إعلانات.",
  },
  {
    icon: "📍",
    bg: "linear-gradient(165deg,#e0654a 0%,#b4452c 55%,#7a2d1a 100%)",
    title: "سجّل حضورك واجمع نقاط",
    body: "حضورك موثّق بموقعك الحقيقي. كل تسجيل يكسبك نقاط ويبني سلسلتك اليومية 🔥",
  },
  {
    icon: "👥",
    bg: "linear-gradient(165deg,#c08a1e 0%,#8a5f10 55%,#4a3208 100%)",
    title: "تابع أصدقاءك وارتقِ",
    body: "شوف وين يسجّلون حضورهم، نافسهم على الأماكن، وارتقِ من برونزي إلى بلاتيني.",
  },
];

export default function Onboarding({
  forceOpen,
  onClose,
}: {
  /** Pass true to replay regardless of localStorage (settings replay). */
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const controlled = forceOpen !== undefined;
  const [visible, setVisible] = useState(controlled ? !!forceOpen : false);
  const [slide, setSlide] = useState(0);

  // Auto mode: show once on first authenticated load.
  useEffect(() => {
    if (controlled) return;
    try {
      if (localStorage.getItem(KEY) !== "1") setVisible(true);
    } catch { /* private mode */ }
  }, [controlled]);

  useEffect(() => {
    if (controlled) { setVisible(!!forceOpen); setSlide(0); }
  }, [controlled, forceOpen]);

  function dismiss() {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setVisible(false);
    setSlide(0);
    onClose?.();
  }

  if (!visible) return null;
  const s = SLIDES[slide];
  const last = slide === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[2000] flex flex-col text-white animate-backdrop-fade"
      style={{ background: s.bg, transition: "background .4s ease" }}
      role="dialog"
      aria-modal="true"
      aria-label="جولة تعريفية"
    >
      <div
        className="flex justify-start px-5"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <button
          onClick={dismiss}
          className="min-h-[44px] px-4 rounded-pill bg-white/15 text-[13px] font-extrabold active:scale-95 transition"
        >
          تخطّي
        </button>
      </div>

      <div key={slide} className="flex-1 flex flex-col items-center justify-center px-8 text-center animate-fade-up">
        <div
          className="w-[104px] h-[104px] rounded-[32px] bg-white/12 backdrop-blur-md grid place-items-center text-[52px] animate-float shadow-[0_18px_40px_rgba(0,0,0,.3)]"
          aria-hidden="true"
        >
          {s.icon}
        </div>
        <h2 className="font-extrabold text-[24px] mt-7 leading-snug">{s.title}</h2>
        <p className="text-[14.5px] text-white/85 mt-3 leading-relaxed max-w-[300px]">{s.body}</p>
      </div>

      <div
        className="px-6 flex flex-col items-center gap-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 28px)" }}
      >
        <div className="flex gap-2" aria-label={`شريحة ${slide + 1} من ${SLIDES.length}`}>
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={`h-2 rounded-full transition-all ${i === slide ? "w-6 bg-white" : "w-2 bg-white/40"}`}
              aria-hidden="true"
            />
          ))}
        </div>
        <button
          onClick={() => (last ? dismiss() : setSlide((i) => i + 1))}
          className="w-full max-w-sm min-h-[54px] rounded-2xl bg-white text-ink font-extrabold text-[16px] active:scale-[0.98] transition shadow-[0_10px_30px_rgba(0,0,0,.25)]"
          style={{ color: "#15252b" }}
        >
          {last ? "يلا نبدأ ✈️" : "التالي"}
        </button>
      </div>
    </div>
  );
}

/** Settings row: replays the onboarding on demand (design: replayable). */
export function ReplayOnboardingRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-3 px-4 min-h-[52px] rounded-2xl bg-card border border-line active:scale-[0.99] transition"
      >
        <span className="inline-flex items-center gap-2.5 font-bold text-ink text-[14px]">
          <RotateCcw size={18} className="text-sea" aria-hidden="true" />
          <span>الجولة التعريفية</span>
        </span>
        <span className="text-muted text-[13px]" aria-hidden="true">←</span>
      </button>
      {open && <Onboarding forceOpen onClose={() => setOpen(false)} />}
    </>
  );
}
