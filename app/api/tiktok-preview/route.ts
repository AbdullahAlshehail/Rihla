// GET /api/tiktok-preview?url=...
// Wraps TikTok's free public oEmbed endpoint. Returns the thumbnail + title
// + author so the client can render an inline preview before the user
// commits to opening TikTok.
//
// Zero cost — TikTok's oEmbed is free with no key, no rate-limit advertised.
// We cache aggressively (24h) since trending videos don't change much.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OEmbedResponse = {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  html?: string;
};

function isSupportedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(www\.|m\.)?tiktok\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url_required" }, { status: 400 });
  if (!isSupportedUrl(url)) {
    return NextResponse.json({ error: "unsupported_host" }, { status: 400 });
  }

  // oEmbed only resolves SPECIFIC video / profile URLs — discover/hashtag
  // pages return a generic error. We surface that as a clean 204 so the
  // client falls back to the "open in TikTok" button without UI noise.
  const isDiscoverPage = /\/discover\//.test(url) || /\/tag\//.test(url);
  if (isDiscoverPage) {
    return NextResponse.json(
      { error: "discover_page", message: "oEmbed only resolves specific videos" },
      { status: 200 },   // not an error — just no preview
    );
  }

  try {
    const oembedUrl = new URL("https://www.tiktok.com/oembed");
    oembedUrl.searchParams.set("url", url);

    const resp = await fetch(oembedUrl.toString(), {
      signal: AbortSignal.timeout(5000),
      headers: { "Accept": "application/json" },
      next: { revalidate: 86400 },   // 24h CDN cache
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `tiktok_${resp.status}`, message: "Could not resolve preview" },
        { status: 200 },
      );
    }

    const data: OEmbedResponse = await resp.json();
    return NextResponse.json({
      ok: true,
      title: data.title?.slice(0, 200) ?? null,
      author: data.author_name ?? null,
      authorUrl: data.author_url ?? null,
      thumbnail: data.thumbnail_url ?? null,
      url,
    }, {
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "fetch_failed", message: e instanceof Error ? e.message : "" },
      { status: 200 },
    );
  }
}
