"use client";

// Dark-mode toggle. Persists to `rihla_dark` (matches ThemeScript's no-flash
// reader) and flips the `dark` class on <html> live. Renders a labelled row
// suitable for the account settings list.
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const root = document.documentElement;
    if (next) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("rihla_dark", next ? "1" : "0");
    } catch { /* private mode — ignore */ }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={mounted ? dark : undefined}
      aria-label="الوضع الليلي"
      className="w-full flex items-center justify-between gap-3 px-4 min-h-[52px] rounded-2xl bg-card border border-line active:scale-[0.99] transition"
    >
      <span className="inline-flex items-center gap-2.5 font-bold text-ink text-[14px]">
        {dark
          ? <Moon size={18} className="text-gold" aria-hidden="true" />
          : <Sun size={18} className="text-gold" aria-hidden="true" />}
        <span>الوضع الليلي</span>
      </span>
      {/* iOS-style pill switch */}
      <span
        className={`relative w-12 h-7 rounded-full transition-colors ${dark ? "bg-sea" : "bg-line"}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${
            dark ? "left-0.5" : "left-[22px]"
          }`}
        />
      </span>
    </button>
  );
}
