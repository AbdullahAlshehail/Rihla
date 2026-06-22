// GET /api/photo?ref=<photo_reference>&w=<width>
//
// Server-side proxy for Google Place Photos. Every photo load passes through
// here so:
//   • The Google Maps API key is NEVER exposed to the browser
//   • Every photo call is counted against the daily budget cap
//   • A 30-day Cache-Control header lets the CDN serve repeat views for free
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
  const w = url.searchParams.get("w") ?? "400";
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

  // 2) Fetch from Google with the server-side key (never exposed to client)
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return new NextResponse("config missing", { status: 500 });

  const upstream = new URL("https://maps.googleapis.com/maps/api/place/photo");
  upstream.searchParams.set("maxwidth", w);
  upstream.searchParams.set("photo_reference", ref);
  upstream.searchParams.set("key", key);

  const r = await fetch(upstream.toString(), { redirect: "follow" });
  if (!r.ok) {
    return new NextResponse(TRANSPARENT_PIXEL, {
      status: 200,
      headers: { "Content-Type": "image/png", "X-Photo-Status": String(r.status) },
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
