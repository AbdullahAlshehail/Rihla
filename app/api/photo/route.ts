// GET /api/photo?ref=<photo_name>&pid=<google_place_id>&w=<width>
//
// Server-side proxy for Google Place Photos. Every photo load passes through
// here so:
//   • The Google Maps API key is NEVER exposed to the browser
//   • Every photo call is counted against the daily budget cap
//   • A 30-day Cache-Control header lets the CDN serve repeat views for free
//
// Uses the Places API (New) photo-media endpoint. The LEGACY
// `maps/api/place/photo?photoreference=…` endpoint stopped serving the photo
// references Google now returns (it 400s them), so we resolve via
// `places.googleapis.com/v1/places/{pid}/photos/{ref}/media`, which needs the
// full resource name — hence the `pid` (google_place_id) param alongside `ref`.
//
// If the photo cap is exhausted, we return a 1x1 transparent PNG (so the UI
// stays clean) plus a header so the dev console can see why. The PlaceCard
// already falls back to a category emoji when the image fails — but with a
// transparent placeholder the layout doesn't jump.

import { NextResponse } from "next/server";
import { checkBudget } from "@/lib/google/budgetGuard";
import { logApiUsage } from "@/lib/cache/apiCache";

const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref");
  const pid = url.searchParams.get("pid"); // google_place_id — required by Places Photo (New)
  // Whitelist widths — a public path with arbitrary `w` shatters the CDN
  // cache and burns the 1000/month Google Place Photo tier. Two buckets
  // (400 / 800) cover cards + hero at retina.
  const rawW = Number(url.searchParams.get("w"));
  const w = rawW <= 400 ? "400" : "800";
  if (!ref) return new NextResponse("missing ref", { status: 400 });

  // 1) Budget check — refuse new calls if daily cap hit
  const status = await checkBudget("place_photo");
  if (!status.allowed) {
    return new NextResponse(TRANSPARENT_PIXEL, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "X-Photo-Budget": "exhausted",
        "Cache-Control": "no-store",
      },
    });
  }

  // 2) Fetch from Google with the server-side key (never exposed to client).
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse("config missing", { status: 500 });

  // Places Photo (New) needs the full resource name places/{pid}/photos/{ref}.
  // Rows added before the pid backfill can't be resolved — surface a 502 so the
  // card shows its emoji fallback instead of a broken-image icon.
  if (!pid) {
    return new NextResponse("missing pid", {
      status: 502,
      headers: { "X-Photo-Status": "no-pid", "Cache-Control": "no-store" },
    });
  }

  const upstream = new URL(
    `https://places.googleapis.com/v1/places/${pid}/photos/${ref}/media`,
  );
  upstream.searchParams.set("maxWidthPx", w);
  upstream.searchParams.set("key", key);
  // Default (no skipHttpRedirect) → 302 to the CDN image; redirect:follow
  // streams the bytes back so our 30-day cache header governs repeat views.

  const r = await fetch(upstream.toString(), { redirect: "follow" });
  if (!r.ok) {
    // Surface upstream errors as 502 so the browser triggers <img> onError
    // fallback (emoji + gradient) instead of showing a 200-transparent pixel
    // that hides both the emoji AND the broken state.
    return new NextResponse("upstream", {
      status: 502,
      headers: { "X-Photo-Status": String(r.status), "Cache-Control": "no-store" },
    });
  }

  // 3) Log usage in the background — never block the photo response on it.
  //    Logged with user_id=null because the proxy is on PUBLIC_PATHS so the
  //    request has no auth context. Without this, the daily place_photo cap
  //    in budgetGuard would never trigger (it counts rows in api_usage_log).
  void logApiUsage(null, "place_photo", false);

  // 4) Stream the image back with aggressive caching (browser + CDN edge).
  const buf = Buffer.from(await r.arrayBuffer());
  const contentType = r.headers.get("content-type") ?? "image/jpeg";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // 30 days everywhere — Google's photo_reference is stable until the
      // place updates its photos (rare). s-maxage lets Netlify/Vercel edge
      // serve repeats without ever invoking the function again.
      "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
    },
  });
}
