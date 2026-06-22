// Robust Google Maps URL parser.
//
// Handles every shape the user might paste from the iPhone share sheet:
//
//   1. Short share URLs   — maps.app.goo.gl/<id>   ·  goo.gl/maps/<id>
//      (require server-side follow-redirect to reach the canonical form)
//
//   2. Canonical place URLs — google.com/maps/place/<Name>/@<lat>,<lng>,<zoom>z
//      /data=!3m1!4b1!4m6!3m5!1s0x<ftid>:0x<ftid>!8m2!3d<lat>!4d<lng>
//
//   3. Query URLs           — google.com/maps?q=<lat>,<lng>
//                           — google.com/maps?q=<name>
//
//   4. Embed/place_id URLs  — google.com/maps?cid=<decimal>
//                           — google.com/maps/place/?q=place_id:<placeid>
//
// We extract any combination of: name, coords, FTID, decimal cid, place_id.
// The route calling this turns those signals into a Google place_id via
// Find-Place-From-Text or Place-Details (cheap, ~$0.017 per resolution).

export type ParsedMapsUrl = {
  /** Decoded place name from /place/<name>/ — best-effort. */
  name?: string;
  /** Latitude (from `@`, `!3d`, or `?q=`). The data-segment `!3d` wins. */
  lat?: number;
  lng?: number;
  /** Feature ID: `0x<hex>:0x<hex>` — Google's internal place anchor. */
  ftid?: string;
  /** Decimal cid (numeric) — convertible to place_id via Find Place call. */
  cid?: string;
  /** Direct place_id when the URL embeds it as `?q=place_id:<id>`. */
  placeId?: string;
};

/** Pure URL parse — does NOT follow redirects. Run resolveShortUrl first. */
export function parseMapsUrl(input: string): ParsedMapsUrl {
  const out: ParsedMapsUrl = {};
  let u: URL;
  try { u = new URL(input.trim()); } catch { return out; }

  const haystack = u.pathname + u.search + u.hash;

  // 1) /place/<name>/
  const placeMatch = u.pathname.match(/\/place\/([^/@?]+)/);
  if (placeMatch) {
    try {
      out.name = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ").trim();
    } catch { out.name = placeMatch[1]; }
  }

  // 2) @lat,lng,zoomz  (viewport center, not the place itself — fallback only)
  const atMatch = haystack.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    out.lat = parseFloat(atMatch[1]);
    out.lng = parseFloat(atMatch[2]);
  }

  // 3) !3d<lat>!4d<lng>  (the place's actual coords — preferred when present)
  const dataMatch = haystack.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch) {
    out.lat = parseFloat(dataMatch[1]);
    out.lng = parseFloat(dataMatch[2]);
  }

  // 4) !1s<ftid>  — `0x<hex>:0x<hex>` feature identifier
  const ftidMatch = haystack.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftidMatch) out.ftid = ftidMatch[1];

  // 5) ?cid=<decimal>
  const cid = u.searchParams.get("cid");
  if (cid && /^\d+$/.test(cid)) out.cid = cid;

  // 6) ?q=place_id:<id>  OR  ?query_place_id=<id>
  const qPlaceId = u.searchParams.get("query_place_id");
  if (qPlaceId) out.placeId = qPlaceId;
  const q = u.searchParams.get("q");
  if (q) {
    const pid = q.match(/^place_id:(.+)$/);
    if (pid) out.placeId = pid[1];
    else {
      // q=lat,lng or q=<text>
      const coords = q.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
      if (coords) {
        out.lat = parseFloat(coords[1]);
        out.lng = parseFloat(coords[2]);
      } else if (!out.name) {
        out.name = decodeURIComponent(q).trim();
      }
    }
  }

  return out;
}

/**
 * Follow short-link redirects (maps.app.goo.gl / goo.gl/maps) to the
 * canonical google.com/maps URL. Other URLs pass through unchanged.
 *
 * Uses GET with a short timeout because some Google redirectors don't honor
 * HEAD. We don't read the body — `response.url` reflects the final URL
 * after `redirect: "follow"` (Node 18+ fetch).
 */
export async function resolveShortUrl(url: string, timeoutMs = 5000): Promise<string> {
  if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)/i.test(url)) {
    return url;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal });
    clearTimeout(timer);
    return r.url || url;
  } catch {
    return url; // worst case: caller's parser falls back to a best-effort match
  }
}
