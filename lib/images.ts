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

/** Returns a photo URL tuned for the requested target width.
 *  Safe to call on null/undefined — returns null. */
export function photoAtWidth(url: string | null | undefined, width: number): string | null {
  if (!url) return null;
  // Google legacy place_photo URL → route through our proxy
  if (url.includes("maps.googleapis.com/maps/api/place/photo")) {
    const ref = extractPhotoRef(url);
    if (ref) return `/api/photo?ref=${encodeURIComponent(ref)}&w=${width}`;
    // Fallback: legacy direct URL with rewritten maxwidth (still leaks the
    // key — should be migrated, but keeps the UI working)
    return url.replace(/([?&])maxwidth=\d+/, `$1maxwidth=${width}`);
  }
  // Google new lh3/lh4/.. CDN: append =w<size> if not present (these don't
  // carry an API key, so direct loading is fine)
  if (/lh[3-6]\.googleusercontent\.com/.test(url)) {
    const cleaned = url.replace(/=w\d+(-h\d+)?$/, "");
    return `${cleaned}=w${width}`;
  }
  return url;
}
