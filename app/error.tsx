"use client";

// Route-level error boundary. Renders inside the existing <html>/<body>
// so RTL + Arabic font stay intact. global-error.tsx is the last-resort
// boundary for layout failures.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 text-center bg-sand">
      <div className="text-6xl mb-3">⚠️</div>
      <h2 className="font-serif font-extrabold text-2xl text-ink mb-2">
        صار خلل بسيط
      </h2>
      <p className="text-muted text-sm leading-relaxed mb-5 max-w-md">
        ما تشيل هم — جرّب تحديث الصفحة، أو ارجع للرئيسية.
        {error.digest && (
          <span className="block text-[10.5px] text-stone-400 mt-2 font-mono">
            {error.digest}
          </span>
        )}
      </p>
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="bg-coral text-white font-bold text-sm px-5 py-3 rounded-2xl shadow active:scale-[0.98]"
        >
          🔄 جرّب مرة ثانية
        </button>
        <a
          href="/trips"
          className="bg-white border border-line text-ink font-bold text-sm px-5 py-3 rounded-2xl active:scale-[0.98]"
        >
          الرئيسية
        </a>
      </div>
    </div>
  );
}
