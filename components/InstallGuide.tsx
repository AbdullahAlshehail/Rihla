"use client";

import { useEffect, useState } from "react";

type Env = "ios-safari" | "ios-other" | "android" | "desktop" | "installed";

function detect(): Env {
  if (typeof window === "undefined") return "desktop";
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS reports installed PWAs on navigator.standalone, not display-mode.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // Chrome/Firefox/Edge on iOS cannot add to the home screen — only Safari.
    return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export default function InstallGuide() {
  const [env, setEnv] = useState<Env | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setEnv(detect()), []);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.origin);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main dir="rtl" className="min-h-dvh bg-gradient-to-b from-sky-900 via-slate-900 to-slate-950 px-4 py-8">
      <div className="mx-auto max-w-md">
        <header className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" width={84} height={84} className="mx-auto rounded-[22%] shadow-lg" />
          <h1 className="mt-3 text-2xl font-extrabold text-white">ثبّت «رحلتي» على آيفونك</h1>
          <p className="text-white/60 text-sm mt-1">بدون آب ستور · مجاني · يفتح بملء الشاشة</p>
        </header>

        {env === null && <p className="text-white/40 text-center animate-pulse">…</p>}

        {env === "installed" && (
          <div className="rounded-2xl bg-emerald-500/15 border border-emerald-400/30 p-5 text-center">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-white font-bold">التطبيق مثبَّت — أنت تستخدمه الآن!</p>
            <a href="/" className="mt-4 inline-block rounded-xl bg-white/15 text-white font-bold px-5 py-2 text-sm">
              افتح رحلتي
            </a>
          </div>
        )}

        {env === "ios-safari" && (
          <ol className="space-y-3">
            <Step n={1} title="اضغط زر المشاركة">
              في شريط Safari بالأسفل، اضغط أيقونة المشاركة <span className="inline-block px-1.5 py-0.5 rounded bg-white/15 text-white text-xs">􀈂</span> (مربّع فيه سهم لفوق).
            </Step>
            <Step n={2} title="اختر «إضافة إلى الشاشة الرئيسية»">
              انزل شوي في القائمة إلى <b className="text-white">Add to Home Screen</b> / <b className="text-white">إضافة إلى الشاشة الرئيسية</b>.
            </Step>
            <Step n={3} title="اضغط «إضافة»">
              بيطلع اسم «رحلتي» — اضغط <b className="text-white">Add</b>. الأيقونة تظهر على شاشتك مثل أي تطبيق.
            </Step>
          </ol>
        )}

        {env === "ios-other" && (
          <div className="rounded-2xl bg-amber-500/15 border border-amber-400/30 p-5">
            <p className="text-white font-bold mb-1">⚠️ افتح الرابط في Safari</p>
            <p className="text-white/70 text-sm">
              التثبيت على الآيفون يشتغل من <b className="text-white">Safari</b> فقط — لا Chrome ولا غيره. انسخ الرابط وافتحه في Safari ثم ارجع لهذي الصفحة.
            </p>
            <button onClick={copyLink} className="mt-3 w-full rounded-xl bg-white/15 text-white font-bold py-2.5 text-sm active:scale-95 transition">
              {copied ? "✓ تم نسخ الرابط" : "انسخ الرابط"}
            </button>
          </div>
        )}

        {env === "android" && (
          <ol className="space-y-3">
            <Step n={1} title="افتح قائمة المتصفح">اضغط ⋮ في أعلى Chrome.</Step>
            <Step n={2} title="اختر «تثبيت التطبيق»">
              <b className="text-white">Install app</b> أو <b className="text-white">إضافة إلى الشاشة الرئيسية</b>.
            </Step>
          </ol>
        )}

        {env === "desktop" && (
          <div className="rounded-2xl bg-white/10 border border-white/15 p-5">
            <p className="text-white font-bold mb-1">📱 افتح هذي الصفحة على جوالك</p>
            <p className="text-white/70 text-sm">التثبيت يتم من الجوال. انسخ الرابط وافتحه في Safari على الآيفون.</p>
            <button onClick={copyLink} className="mt-3 w-full rounded-xl bg-white/15 text-white font-bold py-2.5 text-sm active:scale-95 transition">
              {copied ? "✓ تم النسخ" : "انسخ الرابط"}
            </button>
          </div>
        )}

        {env && env !== "installed" && (
          <p className="text-white/40 text-xs text-center mt-6 leading-relaxed">
            بعد التثبيت يفتح بملء الشاشة بلا شريط متصفّح، وله أيقونة وشاشة إقلاع،
            ويشتغل جزئياً بدون إنترنت.
          </p>
        )}
      </div>
    </main>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-white/10 border border-white/10 p-4">
      <span className="shrink-0 h-7 w-7 rounded-full bg-sky-500 text-white font-bold text-sm grid place-items-center">{n}</span>
      <div>
        <p className="text-white font-bold text-sm">{title}</p>
        <p className="text-white/70 text-sm mt-0.5 leading-relaxed">{children}</p>
      </div>
    </li>
  );
}
