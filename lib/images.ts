// Helpers for serving images at the right size.
//
// All Google place_photo URLs are routed through our `/api/photo` proxy so:
//   • The Google Maps API key is NEVER exposed to the browser
//   • Every photo load counts against our daily budget cap (80/day default)
//   • A 30-day Cache-Control header makes repeats free

/** Extract the photo_reference from a stored Google Place Photo URL. */
function extractPhotoRef(url: string): string | null {
  const m = url.match(/photo_reference=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Returns a photo URL tuned for the requested target width. Two buckets
 *  (400/800) so the CDN cache actually hits — arbitrary widths shatter the
 *  cache and burn the 1000/month Google Place Photo tier. Retina-safe:
 *  cards ≤ 320 CSS px get the 400 physical bucket (@2×); larger get 800.
 *  Safe to call on null/undefined — returns null. */
export function photoAtWidth(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  const w = width <= 320 ? 400 : 800;
  // Already a proxy URL — rewrite the width param so bulk rows aren't stuck
  // on whatever bucket the ingest happened to store.
  if (url.startsWith("/api/photo?")) {
    return `${url.replace(/&w=\d+/, "")}&w=${w}`;
  }
  // Google legacy place_photo URL → route through our proxy
  if (url.includes("maps.googleapis.com/maps/api/place/photo")) {
    const ref = extractPhotoRef(url);
    if (ref) return `/api/photo?ref=${encodeURIComponent(ref)}&w=${w}`;
    return url.replace(/([?&])maxwidth=\d+/, `$1maxwidth=${w}`);
  }
  // Google new lh3/lh4/.. CDN: append =w<size> (these don't carry an API
  // key, so direct loading is fine). The old regex only stripped a trailing
  // `=wNNN[-hNNN]`, but bulk-ingested place-photos URLs end in `=s1600-h720`
  // (s-format) — we appended a SECOND directive (`...=s1600-h720=w400`) and
  // Google answered 400 for every such photo (verified in browser testing
  // 2026-07-04). Strip ANY trailing size directive before appending ours.
  if (/lh[3-6]\.googleusercontent\.com/.test(url)) {
    const cleaned = url.replace(/=[swh]\d+[^=/]*$/, "");
    return `${cleaned}=w${w}`;
  }
  return url;
}
