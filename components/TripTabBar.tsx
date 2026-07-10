"use client";

// iOS-native bottom tab bar for the per-trip context. Mirrors BottomNav's
// optimistic-highlight + prefetch pattern but scopes navigation to ONE trip:
//   خريطة → /trips/[id]/map      (full-screen discover map)
//   اليوم  → /trips/[id]/day      (today's plan, narrative phases)
//   حجوزات → /trips/[id]/bookings (bookings + costs)
//   إعدادات → /trips/[id]/settings
//
// Rendered on the day/bookings/settings pages. The MAP page deliberately
// does NOT mount this bar — its bottom band belongs to the place carousel —
// and instead exposes the same destinations from a top-bar hub button
// (see MapScreen's TripHubSheet).

import Link from "next/link";
import { useEffect, useState } from "react";
import { Map as MapIcon, CalendarDays, Ticket, Settings } from "lucide-react";

export type TripTab = "map" | "day" | "bookings" | "settings";

const TABS: Array<{ key: TripTab; ar: string; path: string; Icon: typeof MapIcon }> = [
  { key: "map",      ar: "خريطة",  path: "map",      Icon: MapIcon },
  { key: "day",      ar: "اليوم",   path: "day",      Icon: CalendarDays },
  { key: "bookings", ar: "حجوزات", path: "bookings", Icon: Ticket },
  { key: "settings", ar: "إعدادات", path: "settings", Icon: Settings },
];

export default function TripTabBar({
  tripId,
  active,
}: {
  tripId: string;
  active: TripTab;
}) {
  // Optimistic highlight: flips on tap; cleared when the destination page
  // mounts a fresh bar with the correct `active` (same as BottomNav).
  const [pending, setPending] = useState<TripTab | null>(null);
  useEffect(() => setPending(null), [active]);
  const current = pending ?? active;

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-50 bg-card/95 backdrop-blur border-t border-line flex pt-1.5 pb-[env(safe-area-inset-bottom)]"
      aria-label="تنقل الرحلة"
    >
      {TABS.map(({ key, ar, path, Icon }) => {
        const on = current === key;
        return (
          <Link
            key={key}
            href={`/trips/${tripId}/${path}`}
            prefetch={true}
            onClick={() => setPending(key)}
            aria-current={on ? "page" : undefined}
            className={`flex-1 inline-flex flex-col items-center gap-0.5 py-1.5 min-h-[52px] font-bold text-[10.5px] transition ${
              on ? "text-sea" : "text-muted"
            }`}
          >
            <Icon size={22} aria-hidden="true" strokeWidth={on ? 2.4 : 2} />
            <span>{ar}</span>
          </Link>
        );
      })}
    </nav>
  );
}
