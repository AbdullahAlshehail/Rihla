"use client";

// Browser geolocation hook for "اعرض لي الأقرب" experience.
// - Persistent: once user grants location, we auto-fetch on EVERY mount via
//   the Permissions API (no re-prompt while the OS-level grant is active).
// - Caches position in localStorage for 30 days so cross-session is instant.
// - Live updates via watchPosition once granted — keeps the map's "📍 موقعك"
//   honest as the user walks around, without re-asking.
// - Zero API cost — pure browser.

import { useCallback, useEffect, useRef, useState } from "react";

type Coords = { lat: number; lng: number; accuracy: number; capturedAt: number };
type Status = "idle" | "asking" | "granted" | "denied" | "unsupported" | "error";

const KEY = "rihla_geo_v2";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — survives across sessions

function load(): Coords | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Coords;
    if (Date.now() - c.capturedAt > TTL_MS) return null;
    return c;
  } catch { return null; }
}

function save(c: Coords) {
  try { window.localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* quota */ }
}

export function useGeoLocation() {
  const [coords, setCoords] = useState<Coords | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);

  // Internal getCurrentPosition wrapper — sets state + saves cache on success.
  // `silent=true` skips the "asking" flicker for the auto-grant path (audit
  // fix 2026-06-16) — we only want the spinner state when the OS actually
  // shows a permission prompt to the user.
  const fetchOnce = useCallback((silent = false) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (!silent) setStatus("asking");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: Coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        save(c);
        setCoords(c);
        setStatus("granted");
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "رفضت السماح بالموقع. فعّله من إعدادات المتصفّح."
            : err.code === err.TIMEOUT
            ? "انتهت مهلة تحديد الموقع. حاول مرة ثانية."
            : "تعذّر تحديد موقعك."
        );
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 12_000 },
    );
  }, []);

  // Start a watchPosition stream — live updates while user moves around.
  // Throttled: ignore updates < 30 m delta to avoid spamming React re-renders
  // every time the GPS jitters by 2 m (audit fix 2026-06-16 — drops a noisy
  // event stream into a meaningful "I moved" signal). Saves battery too.
  const lastCoordsRef = useRef<Coords | null>(null);
  const startWatch = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) return;
    if (watchIdRef.current != null) return; // already watching
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c: Coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          capturedAt: Date.now(),
        };
        const prev = lastCoordsRef.current;
        if (prev) {
          // Haversine inline (km) — skip update if movement < 30 m and
          // recent enough that the cache is still useful.
          const R = 6371;
          const dLat = ((c.lat - prev.lat) * Math.PI) / 180;
          const dLng = ((c.lng - prev.lng) * Math.PI) / 180;
          const a = Math.sin(dLat / 2) ** 2
            + Math.cos((prev.lat * Math.PI) / 180)
              * Math.cos((c.lat * Math.PI) / 180)
              * Math.sin(dLng / 2) ** 2;
          const km = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          if (km < 0.03 && c.capturedAt - prev.capturedAt < 60_000) return;
        }
        lastCoordsRef.current = c;
        save(c);
        setCoords(c);
        setStatus("granted");
      },
      () => { /* swallow transient errors — keep last known coords */ },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }, []);

  // Mount flow:
  //  1) Show cached coords instantly (no flash of "no location").
  //  2) Ask Permissions API if the user already granted geolocation.
  //  3) If granted → silently auto-refresh AND start watching. No prompt.
  //  4) If denied  → leave status="denied" so the UI can offer manual recover.
  //  5) If prompt  → idle; user can tap a button to opt in.
  useEffect(() => {
    const cached = load();
    if (cached) {
      setCoords(cached);
      setStatus("granted");
    } else if (typeof window !== "undefined" && !("geolocation" in navigator)) {
      setStatus("unsupported");
      return;
    }

    // Track unmount so a late-arriving Permissions API resolution doesn't
    // start a watcher after we've already cleaned up (audit fix 2026-06-16
    // race-condition leak).
    let cancelled = false;
    let permRef: PermissionStatus | null = null;

    if (
      typeof window !== "undefined"
      && "permissions" in navigator
      && navigator.permissions
    ) {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((perm) => {
          if (cancelled) return;
          permRef = perm;
          if (perm.state === "granted") {
            fetchOnce(true); // silent — no "asking" flicker since no prompt
            startWatch();
          } else if (perm.state === "denied") {
            setStatus("denied");
          }
          // Re-evaluate if the user changes the permission elsewhere
          perm.onchange = () => {
            if (cancelled) return;
            if (perm.state === "granted") {
              fetchOnce(true);
              startWatch();
            } else if (perm.state === "denied") {
              setStatus("denied");
              setCoords(null);
              if (watchIdRef.current != null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
              }
            } else if (perm.state === "prompt") {
              // User reset the grant — back to opt-in state
              setStatus("idle");
              setCoords(null);
              if (watchIdRef.current != null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
                watchIdRef.current = null;
              }
            }
          };
        })
        .catch(() => { /* Permissions API unsupported — fall back to manual request() */ });
    }

    return () => {
      cancelled = true;
      if (permRef) permRef.onchange = null;
      if (watchIdRef.current != null && typeof window !== "undefined" && "geolocation" in navigator) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [fetchOnce, startWatch]);

  // Manual opt-in entry point — still here for the "📍 شارك موقعك" buttons
  // sprinkled around the UI for first-time visitors.
  const request = useCallback(() => {
    fetchOnce();
    // Start watching after a short delay so the prompt flow completes first
    setTimeout(() => {
      if (typeof navigator !== "undefined" && "geolocation" in navigator) {
        startWatch();
      }
    }, 1000);
  }, [fetchOnce, startWatch]);

  const clear = useCallback(() => {
    try { window.localStorage.removeItem(KEY); } catch { /* */ }
    if (watchIdRef.current != null && typeof window !== "undefined" && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setCoords(null);
    setStatus("idle");
    setError(null);
  }, []);

  return { coords, status, error, request, clear };
}
