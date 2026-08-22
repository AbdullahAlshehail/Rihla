import type { Config } from "tailwindcss";

// Theme color → CSS variable. The `<alpha-value>` placeholder lets Tailwind's
// opacity utilities (bg-coral/10, ring-sea/20) keep working while the actual
// hue swaps between light/dark via the `.dark` class on <html>.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        // Arabic UI font + serif accent for headings (matches old HTML mood).
        // Fraunces is Latin-only (no Arabic glyphs), so IBM Plex Sans Arabic
        // MUST follow it in the stack — browsers do per-glyph fallback, so
        // Latin display text uses Fraunces while Arabic headings render in IBM
        // Plex (not a random system serif). Fixes the 50 `font-serif` Arabic
        // headings that were falling back to Georgia.
        sans: ['"IBM Plex Sans Arabic"', "system-ui", "sans-serif"],
        serif: ['"Fraunces"', '"IBM Plex Sans Arabic"', "Georgia", "serif"],
      },
      colors: {
        // All theme-aware now (swap on .dark). Same names as before so the
        // whole codebase's bg-sea/text-ink/etc. become dark-mode capable.
        sea: { DEFAULT: v("sea"), 600: v("sea6"), 700: v("sea7"), strong: v("sea-strong") },
        coral: { DEFAULT: v("coral"), 600: v("coral6") },
        gold: { DEFAULT: v("gold"), 400: v("gold2"), safe: v("gold-text") },
        sand: v("bg"),
        card: v("card"),
        ink: v("ink"),
        muted: v("muted"),
        line: v("line"),
        "line-soft": v("line-soft"),
        chip: v("chip"),
        chipink: v("chipink"),
        ok: v("ok"),
        danger: v("danger"),
      },
      // Reservation-app type scale — one authoritative set of tiers replacing
      // the old 9.5–13.5px soup. Nothing below `micro` (11px). Latin display
      // renders in Fraunces, Arabic falls back to IBM Plex Sans Arabic.
      fontSize: {
        micro: ["11px", { lineHeight: "1.35" }],
        caption: ["13px", { lineHeight: "1.4" }],
        subhead: ["15px", { lineHeight: "1.5" }],
        body: ["17px", { lineHeight: "1.55" }],
        title: ["20px", { lineHeight: "1.3", fontWeight: "700" }],
        display: ["28px", { lineHeight: "1.15", fontWeight: "800" }],
      },
      borderRadius: {
        pill: "999px",
        card: "20px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(7,42,58,.06)",
        DEFAULT: "0 4px 14px rgba(7,42,58,.09)",
        lg: "0 10px 30px rgba(7,42,58,.10), 0 2px 8px rgba(7,42,58,.06)",
        // Tactile button — two-layer colored shadow that collapses on press.
        // Pair with `active:shadow-btn-press active:translate-y-px`.
        btn: "0 6px 16px -4px rgba(224,101,74,.45), 0 2px 4px rgba(7,42,58,.08)",
        "btn-press": "0 1px 2px rgba(7,42,58,.15)",
        // Sea variant for sea-toned primary buttons (filter chips, tabs)
        "btn-sea": "0 6px 14px -4px rgba(12,74,99,.40), 0 1px 2px rgba(7,42,58,.08)",
        // Selected-card halo — soft colored glow without hard border reflow
        "card-selected": "0 12px 24px -8px rgba(224,101,74,.40)",
      },
      keyframes: {
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-4px)" } },
        flash: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(224,101,74,0)" },
          "50%": { boxShadow: "0 0 0 6px rgba(224,101,74,.35)" },
        },
      },
      animation: {
        float: "float 3s ease-in-out infinite",
        flash: "flash 600ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
