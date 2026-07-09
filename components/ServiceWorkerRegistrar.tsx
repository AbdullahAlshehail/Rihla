"use client";

// Registers the offline service worker (public/sw.js). Isolated in its own
// tiny client component so app/layout.tsx stays a server component and the
// registration code doesn't bloat any page bundle.

import { useEffect } from "react";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    // Dev builds skip SW entirely — a stale worker caching HMR chunks is a
    // debugging nightmare, and offline support is a production concern.
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline support is progressive enhancement — never surface errors.
      });
    };

    // Defer to window load so registration never competes with first paint
    // or the map tiles for bandwidth on 4G.
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
