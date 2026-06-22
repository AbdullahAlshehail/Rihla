"use client";

// Swipable photo gallery. Photos come pre-resolved as direct Google CDN URLs
// stored in DB (no per-view API cost). Falls back to single hero or emoji.

import { useState } from "react";

export default function PhotoGallery({
  photos,
  fallbackEmoji,
  alt,
}: {
  photos: string[];
  fallbackEmoji: string;
  alt: string;
}) {
  const [idx, setIdx] = useState(0);
  // Track which photos failed to load so we can fall back to the emoji
  // hero instead of showing Google's "no photo" placeholder graphic.
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  // Track whether the current image has finished loading. While loading we
  // show a shimmer skeleton so the hero is never empty.
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());

  if (!photos || photos.length === 0) {
    return (
      <div className="w-full aspect-[16/10] rounded-2xl bg-white/60 backdrop-blur grid place-items-center text-7xl shadow-lg">
        {fallbackEmoji}
      </div>
    );
  }

  const current = photos[Math.min(idx, photos.length - 1)];
  const allFailed = photos.every((p) => failed.has(p));
  if (allFailed) {
    return (
      <div className="w-full aspect-[16/10] rounded-2xl bg-white/60 backdrop-blur grid place-items-center text-7xl shadow-lg">
        {fallbackEmoji}
      </div>
    );
  }
  const isLoaded = loaded.has(current);

  return (
    <div className="relative">
      <div className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden shadow-lg bg-stone-200">
        {!isLoaded && (
          <div className="absolute inset-0 bg-gradient-to-br from-stone-200 via-stone-100 to-stone-200 animate-pulse" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current}
          src={current}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-200 ${isLoaded ? "opacity-100" : "opacity-0"}`}
          decoding="async"
          onLoad={() => setLoaded((s) => {
            const next = new Set(s);
            next.add(current);
            return next;
          })}
          onError={() => {
            setFailed((s) => {
              const next = new Set(s);
              next.add(current);
              return next;
            });
            // Auto-advance to the next image so a single bad photo_reference
            // doesn't leave the hero stuck on a forever-shimmer skeleton.
            if (photos.length > 1) {
              setIdx((i) => (i + 1) % photos.length);
            }
          }}
        />
        {photos.length > 1 && (
          <>
            {/* Chevrons only on devices with a real hover/cursor — phones
                rely on swipe, which is the platform convention. */}
            <button
              onClick={() => setIdx((i) => (i - 1 + photos.length) % photos.length)}
              aria-label="السابق"
              className="absolute top-1/2 right-2 -translate-y-1/2 w-11 h-11 hidden [@media(hover:hover)]:grid place-items-center bg-white/85 hover:bg-white rounded-full font-bold text-ink shadow text-lg"
            >
              ›
            </button>
            <button
              onClick={() => setIdx((i) => (i + 1) % photos.length)}
              aria-label="التالي"
              className="absolute top-1/2 left-2 -translate-y-1/2 w-11 h-11 hidden [@media(hover:hover)]:grid place-items-center bg-white/85 hover:bg-white rounded-full font-bold text-ink shadow text-lg"
            >
              ‹
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {photos.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  aria-label={`صورة ${i + 1}`}
                  className={`w-1.5 h-1.5 rounded-full transition ${
                    i === idx ? "bg-white w-4" : "bg-white/60"
                  }`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="text-center text-[10.5px] text-muted mt-1">
          {idx + 1} / {photos.length} · مجاناً من Google
        </div>
      )}
    </div>
  );
}
