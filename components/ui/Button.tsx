"use client";
// Button — single-accent action primitive. `primary` = coral, the ONE dominant
// action per card/screen (احجز / أضِف). `secondary` = quiet neutral. `ghost` =
// text-only. Tactile: primary collapses its colored shadow on press.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-coral text-white shadow-btn active:shadow-btn-press active:translate-y-px",
  secondary:
    "bg-card text-ink border border-line active:bg-sand active:scale-[0.98]",
  ghost:
    "bg-transparent text-sea active:bg-sea/5 active:scale-[0.98]",
};

const SIZE: Record<Size, string> = {
  md: "h-11 px-4 text-subhead gap-2 rounded-pill",
  sm: "h-9 px-3 text-caption gap-1.5 rounded-pill",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  leftIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block, leftIcon, className = "", children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center font-bold transition disabled:opacity-50 disabled:pointer-events-none ${
        VARIANT[variant]
      } ${SIZE[size]} ${block ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {leftIcon}
      {children}
    </button>
  );
});
