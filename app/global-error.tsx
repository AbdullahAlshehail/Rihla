"use client";

// Top-level error boundary — Next.js shows this only when an uncaught error
// bubbles past every other boundary. Keep it minimal, RTL, with a way out.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body className="font-sans min-h-dvh bg-sand grid place-items-center px-6">
        <div className="max-w-md w-full bg-card border border-danger/30 rounded-2xl shadow-lg p-6 text-center">
          <div className="text-5xl mb-3">⚠️</div>
          <h1 className="font-serif font-extrabold text-xl text-danger mb-2">
            صار خطأ غير متوقع
          </h1>
          <p className="text-sm text-muted mb-1 leading-relaxed">
            بياناتك بأمان. جرّب تحديث الصفحة.
          </p>
          {error.digest && (
            <p className="text-[10px] text-muted mb-4 font-mono">
              ref: {error.digest}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              onClick={reset}
              className="bg-coral text-white font-bold text-sm py-2.5 rounded-xl"
            >
              🔄 إعادة المحاولة
            </button>
            <a
              href="/trips"
              className="bg-card border border-line text-ink font-bold text-sm py-2.5 rounded-xl"
            >
              ← رحلاتي
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
