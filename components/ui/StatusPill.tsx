"use client";
// StatusPill — open/closed indicator derived from state, NOT from the
// emoji-bearing label string. A colored dot (not 🟢/🔴) + Arabic time. Callers
// pass the booleans/minute-of-day from formatOpenStatus/isOpenNow instead of
// its raw `label`.
import { fmtMinOfDay } from "@/lib/utils";

export function StatusPill({
  isOpen,
  closeAt,
  unknown = false,
  size = "sm",
  className = "",
}: {
  isOpen: boolean;
  /** Minute-of-day the place closes (from isOpenNow/formatOpenStatus). */
  closeAt?: number;
  /** Hours not known — neutral pill, no open/closed claim. */
  unknown?: boolean;
  size?: "sm" | "xs";
  className?: string;
}) {
  const pad = size === "xs" ? "px-2 py-0.5 text-micro" : "px-2.5 py-1 text-caption";
  if (unknown) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-pill font-bold bg-card/90 text-muted ${pad} ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-muted" />
        ساعات غير معروفة
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill font-bold ${pad} ${
        isOpen ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"
      } ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? "bg-emerald-500" : "bg-rose-500"}`} />
      {isOpen
        ? closeAt != null ? `مفتوح · للـ ${fmtMinOfDay(closeAt)}` : "مفتوح"
        : "مغلق"}
    </span>
  );
}
