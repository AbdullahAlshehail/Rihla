"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [err, setErr] = useState("");
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setErr("أدخل بريد إلكتروني صحيح");
      return;
    }
    if (mode === "password" && password.length < 6) {
      setErr("الباسوورد لازم ٦ أحرف على الأقل");
      return;
    }
    setStatus("sending");
    setErr("");
    const supabase = createClient();

    if (mode === "password") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setStatus("error");
        setErr(error.message === "Invalid login credentials" ? "إيميل أو باسوورد خطأ" : error.message);
        return;
      }
      // Successfully logged in — go to /trips
      router.push("/trips");
      router.refresh();
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) {
      setStatus("error");
      setErr(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🧭</div>
          <h1 className="font-serif font-extrabold text-3xl text-sea">رحلتي</h1>
          <p className="text-muted text-sm mt-2">مساعد السفر — قرّر بثوانٍ</p>
        </div>

        {status === "sent" ? (
          <div className="bg-white border border-line rounded-2xl p-6 shadow text-center">
            <div className="text-4xl mb-2">📬</div>
            <h2 className="font-bold text-lg mb-2">ابحث في إيميلك</h2>
            <p className="text-sm text-muted leading-relaxed">
              أرسلنا رابط دخول لـ <b className="text-ink">{email}</b>.<br />
              اضغطه من جوالك ورح يفتح التطبيق مباشرة.
            </p>
            <button
              onClick={() => setStatus("idle")}
              className="mt-5 text-coral text-sm font-bold"
            >
              ↺ بريد مختلف
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="bg-white border border-line rounded-2xl p-6 shadow">
            {/* Mode toggle */}
            <div className="flex gap-1 bg-stone-100 rounded-pill p-1 mb-4">
              <button
                type="button"
                onClick={() => { setMode("password"); setErr(""); }}
                className={`flex-1 text-xs font-bold py-2 rounded-pill transition ${
                  mode === "password" ? "bg-white shadow text-sea" : "text-muted"
                }`}
              >
                🔐 باسوورد
              </button>
              <button
                type="button"
                onClick={() => { setMode("magic"); setErr(""); }}
                className={`flex-1 text-xs font-bold py-2 rounded-pill transition ${
                  mode === "magic" ? "bg-white shadow text-sea" : "text-muted"
                }`}
              >
                ✉ إيميل
              </button>
            </div>

            <label className="block text-xs font-bold text-sea mb-2">البريد الإلكتروني</label>
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full border border-line rounded-xl px-4 py-3 text-base outline-none focus:border-sea focus:ring-2 focus:ring-sea/15"
              required
              autoComplete="email"
            />

            {mode === "password" && (
              <>
                <label className="block text-xs font-bold text-sea mb-2 mt-3">الباسوورد</label>
                <input
                  type="password"
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full border border-line rounded-xl px-4 py-3 text-base outline-none focus:border-sea focus:ring-2 focus:ring-sea/15"
                  required
                  autoComplete="current-password"
                  minLength={6}
                />
              </>
            )}

            {err && <p className="text-danger text-xs mt-2 font-bold">{err}</p>}
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full mt-4 bg-coral text-white font-bold py-3 rounded-xl disabled:opacity-60 min-h-[48px]"
            >
              {status === "sending"
                ? "⏳ جاري الدخول..."
                : mode === "password"
                ? "🔓 ادخل"
                : "✉ أرسل رابط الدخول"}
            </button>
            <p className="text-xs text-muted mt-4 text-center leading-relaxed">
              {mode === "password"
                ? "أو استخدم الإيميل لرابط دخول سريع."
                : "بدون كلمة سر — رابط واحد من إيميلك ودخلت."}
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
