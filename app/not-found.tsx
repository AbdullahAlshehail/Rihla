// 404 page — friendly, fast, in Arabic. Replaces Next.js default.

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-6 bg-sand">
      <div className="max-w-md w-full bg-white border border-line rounded-2xl shadow-lg p-6 text-center">
        <div className="text-6xl mb-3">🗺️</div>
        <h1 className="font-serif font-extrabold text-2xl text-sea mb-2">
          الصفحة ما لقيناها
        </h1>
        <p className="text-sm text-stone-600 mb-5 leading-relaxed">
          الرابط مو موجود أو تم حذفه.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/trips"
            prefetch
            className="bg-coral text-white font-bold text-sm py-2.5 rounded-xl"
          >
            🗂 رحلاتي
          </Link>
          <Link
            href="/"
            className="bg-white border border-line text-stone-900 font-bold text-sm py-2.5 rounded-xl"
          >
            ← الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}
