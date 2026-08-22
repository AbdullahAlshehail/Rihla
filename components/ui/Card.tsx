"use client";
// Card — the base surface (bg-card, 20px radius, soft elevation) + CardPhoto,
// the photo-forward hero every place surface shares. Photos carry the color;
// no per-category gradients. CardPhoto is a CSS crop of the SAME photo URL —
// it never changes the request (protects the $0 Google budget).
import { useState, type ReactNode } from "react";

export function Card({
  className = "",
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-card rounded-card border border-line shadow overflow-hidden ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardPhoto({
  src,
  alt = "",
  aspect = "aspect-[4/3]",
  scrim = true,
  fallback,
  className = "",
  children,
}: {
  src?: string | null;
  alt?: string;
  /** Tailwind aspect ratio. Reservation default = 4:3. */
  aspect?: string;
  /** Bottom gradient for legibility of overlaid text/pills. */
  scrim?: boolean;
  /** Rendered when there's no photo or it fails (e.g. <CategoryIcon/>). */
  fallback?: ReactNode;
  className?: string;
  /** Overlay content (heart, status pill). Keep to ≤2 elements. */
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = !!src && !failed;

  return (
    <div className={`relative ${aspect} bg-line overflow-hidden ${className}`}>
      {showPhoto ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src!}
            alt={alt}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
          {scrim && (
            <div
              className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 to-transparent pointer-events-none"
              aria-hidden="true"
            />
          )}
        </>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted" aria-hidden="true">
          {fallback}
        </div>
      )}
      {children}
    </div>
  );
}
