"use client";
// Chip — filter/tag pill. ONE accent: neutral by default, coral when active.
// Replaces DiscoverFilterBar's 5-color ChipBtn (sea/coral/amber/violet/emerald).
// Categories no longer carry their own hue — photos carry the color now.
import { type ButtonHTMLAttributes, type ReactNode } from "react";

export function Chip({
  active = false,
  icon,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-pill text-caption font-bold whitespace-nowrap transition active:scale-[0.97] ${
        active
          ? "bg-coral text-white shadow-btn-sea"
          : "bg-card text-ink border border-line active:bg-sand"
      } ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
