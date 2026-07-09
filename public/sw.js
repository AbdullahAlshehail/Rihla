/* Rihla service worker — hand-rolled offline shell (no workbox/next-pwa dep).
 *
 * Strategy per resource type:
 *   • App shell (manifest, icons, /passport, /plan) — precached on install.
 *   • Carto map tiles (basemaps.cartocdn.com)       — cache-first, ≤200 entries.
 *     Tiles are immutable per z/x/y so revalidation is wasted battery.
 *   • /api/photo proxy                              — cache-first 30 days, ≤150.
 *   • Supabase REST GETs (…supabase.co/rest/v1/…)   — network-first, cache
 *     fallback so the last-seen catalogue still renders in airplane mode.
 *   • Page navigations                              — network-first, cache
 *     fallback (never cache redirects, so auth flows stay live).
 * Everything else (auth, POST/DELETE, Google APIs) passes through untouched.
 *
 * Bump VERSION on strategy changes — activate() drops all older caches.
 */

// v3: adds the PURGE_USER_CACHE message handler (sign-out privacy — see bottom).
// Bumping VERSION forces reinstall so browsers pick up this new worker.
// v2 note: re-captured /sw.js CSP headers for the Carto-tiles grey-map fix.
const VERSION = "rihla-v3";
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = `${VERSION}-tiles`;
const PHOTO_CACHE = `${VERSION}-photos`;
const DATA_CACHE = `${VERSION}-data`;
const PAGE_CACHE = `${VERSION}-pages`;

const TILE_MAX = 200;   // ~200 × ~25 KB ≈ 5 MB — one city at 3 zoom levels
const PHOTO_MAX = 150;
const DATA_MAX = 60;
const PAGE_MAX = 30;
const PHOTO_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const SHELL_URLS = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/passport",
  "/plan",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Add each URL individually — a single 404/redirect must not fail the
      // whole install (cache.addAll is all-or-nothing).
      Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))),
    ).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      ),
    ).then(() => self.clients.claim()),
  );
});

/** FIFO trim — Cache API keys() preserves insertion order, so deleting from
 *  the front approximates LRU well enough for tiles/photos. */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(
    keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)),
  );
}

/** Cache-first with optional age expiry. Opaque responses (no-cors tiles)
 *  expose no Date header → age 0 → always served; the entry cap bounds them. */
async function cacheFirst(cacheName, maxEntries, request, maxAgeMs) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    if (!maxAgeMs) return hit;
    const dateHdr = hit.headers.get("date");
    const age = dateHdr ? Date.now() - new Date(dateHdr).getTime() : 0;
    if (age < maxAgeMs) return hit;
  }
  try {
    const res = await fetch(request);
    if (res.ok || res.type === "opaque") {
      cache.put(request, res.clone());
      trimCache(cacheName, maxEntries); // fire-and-forget
    }
    return res;
  } catch (err) {
    if (hit) return hit; // expired-but-cached beats a network error offline
    throw err;
  }
}

/** Network-first with cache fallback. Never caches redirected responses so
 *  an auth bounce to /login can't shadow a real page. */
async function networkFirst(cacheName, maxEntries, request) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected) {
      cache.put(request, res.clone());
      trimCache(cacheName, maxEntries);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // Last resort for navigations: any cached shell page beats a browser
    // error screen when fully offline.
    if (request.mode === "navigate") {
      const shell = await caches.match("/passport");
      if (shell) return shell;
    }
    throw err;
  }
}

// Sign-out privacy: purge per-user cached data + pages so the next person to
// use this device can't read the previous user's trips/check-ins offline.
// Matches by suffix so caches from any prior VERSION are cleared too. Tiles and
// photos (non-personal, content-addressed) are intentionally kept.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "PURGE_USER_CACHE") return;
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.endsWith("-data") || k.endsWith("-pages"))
          .map((k) => caches.delete(k)),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  // Carto basemap tiles — {a-d}.basemaps.cartocdn.com
  if (url.hostname.endsWith("basemaps.cartocdn.com")) {
    event.respondWith(cacheFirst(TILE_CACHE, TILE_MAX, req));
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // Place photo proxy — content-addressed by photo reference, safe for 30 d.
  if (sameOrigin && url.pathname.startsWith("/api/photo")) {
    event.respondWith(cacheFirst(PHOTO_CACHE, PHOTO_MAX, req, PHOTO_MAX_AGE_MS));
    return;
  }

  // Supabase REST reads — live data preferred, stale beats blank offline.
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/")) {
    event.respondWith(networkFirst(DATA_CACHE, DATA_MAX, req));
    return;
  }

  // Page navigations (App Router HTML).
  if (req.mode === "navigate" && sameOrigin) {
    event.respondWith(networkFirst(PAGE_CACHE, PAGE_MAX, req));
    return;
  }

  // Everything else — untouched (auth endpoints, POSTs already excluded,
  // _next/static has immutable HTTP caching via netlify.toml).
});
