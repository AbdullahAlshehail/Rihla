"use client";

// Bottom tab bar. Client component for two smoothness reasons:
//  • optimistic active state — the tapped tab highlights IMMEDIATELY, not
//    after the server finishes rendering the destination page
//  • prefetch={true} — full RSC payload of each tab is prefetched, so the
//    switch is instant (router-cache hit) instead of a server roundtrip
//
// `planHref` lets server pages that already know the user's latest trip
// point خطتي straight at /trips/[id]/map?tab=plan — zero redirect hops.
// Fallback /plan (redirect + auto-create) is only used when no trip exists;
// we deliberately do NOT prefetch that fallback because rendering /plan has
// a side effect (it inserts a default trip when none exists).

import Link from "next/link";
import { useEffect, useState } from "react";
import { Globe, MapPinned, User } from "lucide-react";

type Tab = "passport" | "plan" | "profile";

export default function BottomNav({
  active,
  planHref,
}: {
  active: Tab;
  planHref?: string;
}) {
  // Optimistic highlight: flips on tap; cleared when the real page mounts
  // (new page renders a fresh BottomNav with the correct `active`).
  const [pending, setPending] = useState<Tab | null>(null);
  useEffect(() => setPending(null), [active]);
  const current = pending ?? active;

  const cls = (k: Tab) =>
    `flex-1 inline-flex flex-col items-center gap-0.5 py-1.5 min-h-[52px] font-bold text-[10.5px] transition ${
      current === k ? "text-sea" : "text-muted"
    }`;

  const plan = planHref ?? "/plan";

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 bg-card/95 backdrop-blur border-t border-line flex"
      style={{ paddingBottom: "calc(6px + env(safe-area-inset-bottom))", paddingTop: 6 }}
      aria-label="التنقل الرئيسي"
    >
      <Link
        href="/passport"
        prefetch={true}
        onClick={() => setPending("passport")}
        className={cls("passport")}
        aria-current={current === "passport" ? "page" : undefined}
      >
        <Globe size={22} aria-hidden="true" />
        <span>رحلاتي</span>
      </Link>
      <Link
        href={plan}
        // /plan auto-creates a trip server-side — never prefetch that.
        prefetch={plan !== "/plan"}
        onClick={() => setPending("plan")}
        className={cls("plan")}
        aria-current={current === "plan" ? "page" : undefined}
      >
        <MapPinned size={22} aria-hidden="true" />
        <span>خطتي</span>
      </Link>
      <Link
        href="/profile"
        prefetch={true}
        onClick={() => setPending("profile")}
        className={cls("profile")}
        aria-current={current === "profile" ? "page" : undefined}
      >
        <User size={22} aria-hidden="true" />
        <span>حسابي</span>
      </Link>
    </nav>
  );
}
