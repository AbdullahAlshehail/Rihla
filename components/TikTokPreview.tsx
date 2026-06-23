"use client";

// Inline TikTok preview card — shows the video thumbnail + author + title
// so the user can decide before tapping out to TikTok. Backed by
// /api/tiktok-preview which wraps TikTok's free oEmbed.
//
// Falls back to a generic "افتح على تيك توك" button when:
//   • The URL is a discover/hashtag page (oEmbed returns no thumbnail)
//   • The fetch fails / times out
//   • The host isn't tiktok.com

import { useEffect, useState } from "react";

type Preview = {
  ok?: boolean;
  title?: string | null;
  author?: string | null;
  thumbnail?: string | null;
  url?: string;
  error?: string;
};

export default function TikTokPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tiktok-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data: Preview) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => { if (!cancelled) setPreview({ error: "fetch_failed" }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url]);

  const isVideoHost = /tiktok\.com/i.test(url);
  if (!isVideoHost) return null;

  // Loading skeleton — keeps the layout stable
  if (loading) {
    return (
      <div className="bg-stone-100 rounded-2xl p-3 flex items-center gap-3 animate-pulse">
        <div className="w-16 h-20 bg-stone-200 rounded-lg shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-3/4 bg-stone-200 rounded" />
          <div className="h-3 w-1/2 bg-stone-200 rounded" />
        </div>
      </div>
    );
  }

  // Got a real preview with thumbnail → rich card
  if (preview?.ok && preview.thumbnail) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block bg-white rounded-2xl border border-line p-2.5 shadow-sm active:scale-[0.98] transition group"
      >
        <div className="flex items-stretch gap-3">
          <div className="relative shrink-0 w-16 h-20 rounded-lg overflow-hidden bg-stone-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview.thumbnail}
              alt={preview.title ?? "TikTok"}
              className="absolute inset-0 w-full h-full object-cover group-active:brightness-90 transition"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            {/* Play icon overlay */}
            <span className="absolute inset-0 grid place-items-center bg-black/20">
              <span className="bg-white/95 text-rose-600 w-7 h-7 grid place-items-center rounded-full text-[14px] shadow-md">
                ▶
              </span>
            </span>
          </div>
          <div className="flex-1 min-w-0 py-0.5">
            <div className="text-[10.5px] font-extrabold text-rose-600 mb-0.5 inline-flex items-center gap-1">
              <span>🎵</span><span>تيك توك</span>
              {preview.author && <span className="text-stone-500 font-normal">· {preview.author}</span>}
            </div>
            <div className="text-[12px] font-bold text-ink line-clamp-2 leading-snug">
              {preview.title ?? "شاهد على تيك توك"}
            </div>
          </div>
          <span className="self-start text-stone-400 text-[11px]">↗</span>
        </div>
      </a>
    );
  }

  // No thumbnail (discover page, failure, etc) → simple branded button
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-gradient-to-l from-pink-50 to-orange-50 border border-rose-200 rounded-pill p-3 text-center font-extrabold text-[12.5px] text-rose-700 active:scale-[0.98] transition shadow-sm"
    >
      <span className="inline-flex items-center gap-1.5">
        <span>🎵</span>
        <span>افتح على تيك توك</span>
        <span className="opacity-60">↗</span>
      </span>
    </a>
  );
}
