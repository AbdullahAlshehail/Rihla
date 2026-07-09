"use client";

// Share studio (Travel Card) — the growth loop surface. A client-rendered
// shareable card with 4 swappable gradient themes and a share-type switch
// (🌍 جوازي / 🏅 وسامي). Every number on the card is the user's REAL data
// (passport %, countries, cities, coins, longest streak, check-ins). We show
// "زرت {pct}٪ من العالم" — we have no basis for a percentile claim, so none
// is made. Referral note: the link carries ?ref={username} but full two-sided
// signup attribution is out of scope for this pass (no reward backend).

import { useMemo, useState } from "react";
import { arNum } from "@/lib/social/format";

export type ShareData = {
  name: string;
  username: string | null;
  pct: number; // % of world's countries visited (real)
  countries: number;
  cities: number;
  coins: number;
  longestStreak: number;
  checkins: number;
};

const THEMES: { key: string; label: string; bg: string }[] = [
  { key: "night", label: "ليل", bg: "linear-gradient(160deg,#0f2027 0%,#203a43 55%,#2c5364 100%)" },
  { key: "sunset", label: "غروب", bg: "linear-gradient(160deg,#e0654a 0%,#8e3b5f 55%,#41295a 100%)" },
  { key: "gold", label: "ذهب", bg: "linear-gradient(160deg,#c08a1e 0%,#8a5f10 55%,#3d2b06 100%)" },
  { key: "ocean", label: "بحر", bg: "linear-gradient(160deg,#0c4a63 0%,#0a3a4f 55%,#062535 100%)" },
];

export default function ShareStudio({ data }: { data: ShareData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Invite / growth banner — opens the studio. No fake reward promised. */}
      <button
        onClick={() => setOpen(true)}
        className="mt-4 w-full text-right bg-gradient-to-br from-coral to-coral-600 text-white rounded-2xl p-4 shadow-btn active:scale-[0.98] transition"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-base">ادعُ أصدقاءك 🎉</div>
            <div className="text-[12px] opacity-90 mt-1">
              شاركهم بطاقة سفرك — تابعوا بعض وتنافسوا على الأماكن
            </div>
          </div>
          <span className="text-xl opacity-90" aria-hidden="true">←</span>
        </div>
      </button>

      {open && <StudioSheet data={data} onClose={() => setOpen(false)} />}
    </>
  );
}

function StudioSheet({ data, onClose }: { data: ShareData; onClose: () => void }) {
  const [theme, setTheme] = useState(THEMES[0]);
  const [type, setType] = useState<"passport" | "medals">("passport");
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => {
    const base =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    return data.username ? `${base}/?ref=${data.username}` : `${base}/`;
  }, [data.username]);

  const shareText = useMemo(() => {
    const flex =
      data.pct > 0
        ? `زرت ${arNum(data.pct)}٪ من العالم (${arNum(data.countries)} دولة · ${arNum(data.cities)} مدينة)`
        : "بديت أوثّق رحلاتي وأماكني";
    return `أنا ${data.name} على رِحلة ✈️ — ${flex}. حمّل التطبيق وتابعني: ${link}`;
  }, [data, link]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — ignore */ }
  }

  async function nativeShare() {
    try {
      await navigator.share({ text: shareText });
    } catch { /* user cancelled */ }
  }

  return (
    <div
      className="fixed inset-0 z-[1600] bg-black/55 animate-backdrop-fade flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="شارك بطاقة سفرك"
    >
      <div
        className="w-full max-w-lg bg-card rounded-t-3xl sm:rounded-3xl px-5 pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.3)] animate-sheet-up max-h-[92dvh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="w-9 h-[5px] bg-ink/30 rounded-full mx-auto mb-3" />
        <h2 className="font-extrabold text-[17px] text-ink text-center">بطاقة سفرك</h2>

        {/* Share-type switch */}
        <div className="flex bg-sand border border-line rounded-pill p-1 mt-3" role="tablist" aria-label="نوع البطاقة">
          {(
            [
              { key: "passport", label: "🌍 جوازي" },
              { key: "medals", label: "🏅 وسامي" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={type === t.key}
              onClick={() => setType(t.key)}
              className={`flex-1 min-h-[40px] rounded-pill text-[13px] font-extrabold transition ${
                type === t.key ? "bg-card text-sea shadow-sm" : "text-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* The card */}
        <div
          className="relative mt-3.5 rounded-3xl overflow-hidden text-white p-5 min-h-[240px] flex flex-col shadow-lg"
          style={{ background: theme.bg }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            aria-hidden="true"
            style={{ background: "radial-gradient(160px 160px at 85% -10%, rgba(255,255,255,.14), transparent)" }}
          />
          <div className="relative flex items-center justify-between">
            <span className="font-extrabold text-[15px]">رِحلة ✈️</span>
            <span className="text-[11px] text-white/70" dir="ltr">
              {data.username ? `@${data.username}` : ""}
            </span>
          </div>

          {type === "passport" ? (
            <div className="relative flex-1 flex flex-col items-center justify-center py-6 text-center">
              {data.pct > 0 ? (
                <>
                  <div className="font-extrabold text-[56px] leading-none">
                    {arNum(data.pct)}<span className="text-[28px]">٪</span>
                  </div>
                  <div className="text-[13px] text-white/85 mt-1 font-bold">من العالم زرته</div>
                </>
              ) : (
                <>
                  <div className="text-[44px] leading-none" aria-hidden="true">✈️</div>
                  <div className="font-extrabold text-[20px] mt-2">بداية رحلتي</div>
                  <div className="text-[12.5px] text-white/85 mt-1 font-bold">أوثّق أماكني على رِحلة</div>
                </>
              )}
              <div className="flex items-center gap-4 mt-4 text-[12.5px] font-bold text-white/90">
                <span>🌍 {arNum(data.countries)} دولة</span>
                <span className="w-px h-4 bg-white/25" aria-hidden="true" />
                <span>🏙 {arNum(data.cities)} مدينة</span>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 flex flex-col items-center justify-center py-6 text-center">
              <div className="flex items-center gap-5">
                <Medal emoji="🔥" value={data.longestStreak} label="أطول سلسلة" />
                <Medal emoji="🪙" value={data.coins} label="نقطة" />
                <Medal emoji="📍" value={data.checkins} label="حضور موثّق" />
              </div>
            </div>
          )}

          <div className="relative text-center text-[12px] font-bold text-white/85">{data.name}</div>
        </div>

        {/* Theme picker */}
        <div className="flex items-center justify-center gap-2.5 mt-3.5" role="radiogroup" aria-label="لون البطاقة">
          {THEMES.map((t) => (
            <button
              key={t.key}
              role="radio"
              aria-checked={theme.key === t.key}
              aria-label={t.label}
              onClick={() => setTheme(t)}
              className={`w-11 h-11 rounded-full border-2 transition active:scale-90 ${
                theme.key === t.key ? "border-sea scale-105" : "border-line"
              }`}
              style={{ background: t.bg }}
            />
          ))}
        </div>

        {/* Share targets */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          <ShareBtn
            label="واتساب"
            emoji="💬"
            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank")}
          />
          <ShareBtn
            label="X"
            emoji="𝕏"
            onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, "_blank")}
          />
          <ShareBtn label={copied ? "نُسخ ✓" : "نسخ"} emoji="🔗" onClick={copy} />
          <ShareBtn label="مشاركة" emoji="📤" onClick={nativeShare} />
        </div>

        <p className="text-[11px] text-muted text-center mt-3 leading-relaxed">
          رابط دعوتك: <span dir="ltr" className="font-bold">{link}</span>
        </p>
      </div>
    </div>
  );
}

function Medal({ emoji, value, label }: { emoji: string; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[26px]" aria-hidden="true">{emoji}</span>
      <span className="font-extrabold text-[22px] leading-none">{arNum(value)}</span>
      <span className="text-[10.5px] text-white/80 font-bold">{label}</span>
    </div>
  );
}

function ShareBtn({ label, emoji, onClick }: { label: string; emoji: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="min-h-[64px] rounded-2xl border border-line bg-card flex flex-col items-center justify-center gap-1 active:scale-95 transition"
    >
      <span className="text-[20px]" aria-hidden="true">{emoji}</span>
      <span className="text-[11px] font-extrabold text-ink">{label}</span>
    </button>
  );
}
