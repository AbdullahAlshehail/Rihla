import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Arabic UI font + serif accent for headings (matches old HTML mood)
        sans: ['"IBM Plex Sans Arabic"', "system-ui", "sans-serif"],
        serif: ['"Fraunces"', "Georgia", "serif"],
      },
      colors: {
        sea: { DEFAULT: "#0c4a63", 600: "#0a3a4f", 700: "#072a3a" },
        coral: { DEFAULT: "#e0654a", 600: "#c04a30" },
        gold: { DEFAULT: "#c08a1e", 400: "#e7b73c" },
        sand: "#f5ede0",
        card: "#fffdf8",
        ink: "#1b2a2f",
        muted: "#5d7077",
        line: "#e3d7c3",
        "line-soft": "#f0e8d6",
        ok: "#2f8f5b",
        danger: "#b23b3b",
      },
      borderRadius: {
        pill: "999px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(7,42,58,.06)",
        DEFAULT: "0 4px 14px rgba(7,42,58,.09)",
        lg: "0 14px 40px rgba(7,42,58,.20)",
      },
    },
  },
  plugins: [],
};
export default config;
