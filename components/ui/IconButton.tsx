"use client";
// IconButton — circular icon-only control (close, save heart, hide, back).
// Solid variant stays legible on photos (extra shadow); plain sits on cards.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "solid" | "plain" | "glass";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  // On bright photos — solid card bg + heavy shadow (ported from PlaceDetailSheet close).
  solid: "bg-card text-ink shadow-[0_2px_12px_rgba(0,0,0,0.25)] border border-white/60",
  plain: "bg-transparent text-ink active:bg-ink/5",
  glass: "bg-black/35 text-white backdrop-blur-sm",
};

const SIZE: Record<Size, string> = {
  md: "w-11 h-11",
  sm: "w-9 h-9",
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = "plain", size = "md", className = "", children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={`grid place-items-center rounded-full active:scale-90 transition ${VARIANT[variant]} ${SIZE[size]} ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
