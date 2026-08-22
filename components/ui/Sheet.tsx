"use client";
// Sheet — the ONE bottom-sheet/modal primitive. Physics ported verbatim from
// PlaceDetailSheet (the most complete of the 3 hand-rolled impls): iOS-spring
// entrance (animate-sheet-up), gradual backdrop (animate-backdrop-fade), body
// scroll-lock, ESC-to-close, backdrop-tap-to-close, role=dialog/aria-modal,
// safe-area insets, grab indicator. Existing sheets migrate to this later (P3);
// this session it backs the new card/detail surfaces only.
import { useEffect, type ReactNode } from "react";

export function Sheet({
  onClose,
  children,
  label,
  heightClass = "h-[88dvh]",
  className = "",
  showGrabber = true,
}: {
  onClose: () => void;
  children: ReactNode;
  /** aria-label for the dialog. */
  label?: string;
  /** Tailwind height for the panel (e.g. "h-[88dvh]", "max-h-[80dvh]"). */
  heightClass?: string;
  /** Extra classes on the panel. */
  className?: string;
  showGrabber?: boolean;
}) {
  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on ESC.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/45 backdrop-blur-sm flex items-end sm:items-center justify-center animate-backdrop-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div
        className={`relative bg-sand w-full max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-lg ${heightClass} overflow-hidden animate-sheet-up flex flex-col ${className}`}
      >
        {showGrabber && (
          <div className="absolute top-3 inset-x-0 flex justify-center z-20 pointer-events-none">
            <div className="w-9 h-[5px] bg-white/70 rounded-full" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
