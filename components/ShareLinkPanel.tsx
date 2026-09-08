"use client";

import { useState } from "react";

export default function ShareLinkPanel({ tripId, initialToken }: { tripId: string; initialToken: string | null }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/v/${token}` : "";

  const gen = async (rotate: boolean) => {
    setBusy(true);
    const r = await fetch(`/api/trips/${tripId}/share`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rotate }),
    });
    setBusy(false);
    if (r.ok) { setToken((await r.json()).token); setCopied(false); }
  };

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-bold text-slate-800 mb-1">🔗 رابط التصويت</h2>
      <p className="text-slate-500 text-sm mb-3">شاركه مع مجموعة السفر — يصوّتون بلا حساب، والقرار يبقى لك.</p>

      {!token ? (
        <button onClick={() => gen(false)} disabled={busy}
          className="w-full rounded-xl bg-indigo-600 text-white font-bold py-2.5 disabled:opacity-50 active:scale-95 transition">
          {busy ? "…" : "أنشئ رابط التصويت"}
        </button>
      ) : (
        <>
          <div className="flex gap-2">
            <input readOnly value={url} className="flex-1 rounded-xl bg-slate-100 text-slate-700 text-sm px-3 py-2 truncate" />
            <button onClick={copy} className="rounded-xl bg-indigo-600 text-white text-sm font-bold px-4 active:scale-95 transition">
              {copied ? "✓" : "نسخ"}
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            <a href={`https://wa.me/?text=${encodeURIComponent("صوّتوا لخطة الرحلة 🔥 " + url)}`} target="_blank" rel="noreferrer"
              className="flex-1 text-center rounded-xl bg-green-500 text-white text-sm font-bold py-2 active:scale-95 transition">
              مشاركة واتساب
            </a>
            <button onClick={() => gen(true)} disabled={busy}
              className="rounded-xl bg-slate-200 text-slate-700 text-sm font-bold px-4 py-2 active:scale-95 transition"
              title="يلغي الرابط القديم فوراً">
              تجديد الرابط
            </button>
          </div>
        </>
      )}
    </div>
  );
}
