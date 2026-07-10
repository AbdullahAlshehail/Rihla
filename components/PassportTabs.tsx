"use client";

// رحلاتي — segmented-control host for the two inner tabs:
//   📍 أماكني (default) — city coverage of real activity
//   🛂 جوازي — the Been-style world tracker (PassportScreen, untouched)
//
// The control itself is NOT sticky: جوازي renders its own sticky header
// (with a back button in the countries view) at top-0, and stacking a second
// sticky bar above it would cover that header while scrolling.

import { useEffect, useState } from "react";
import PassportScreen from "./PassportScreen";
import MyPlacesScreen from "./MyPlacesScreen";
import type { PassportRow } from "@/app/passport/page";
import type { DerivedCity, MyPlacesData } from "@/lib/places/myPlaces";

type Tab = "places" | "jawaz";

export default function PassportTabs({
  initialRows,
  myPlaces,
  derived,
  planHref,
}: {
  initialRows: PassportRow[];
  myPlaces: MyPlacesData;
  // check-in-derived visited countries/cities (canonical roll-up) — جوازي
  // merges these so its map/stats reflect real presence, not just toggles
  derived: { countries: string[]; cities: DerivedCity[] };
  planHref?: string;
}) {
  const [tab, setTab] = useState<Tab>("places");

  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);

  return (
    <div className="min-h-screen bg-sand">
      <div
        className="max-w-2xl mx-auto px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 10px)" }}
      >
        <div
          role="tablist"
          aria-label="رحلاتي"
          className="flex bg-card border border-line rounded-pill p-1 shadow-sm"
        >
          <TabBtn active={tab === "places"} onClick={() => setTab("places")} controls="tab-places">
            📍 أماكني
          </TabBtn>
          <TabBtn active={tab === "jawaz"} onClick={() => setTab("jawaz")} controls="tab-jawaz">
            🛂 جوازي
          </TabBtn>
        </div>
      </div>

      {tab === "places" ? (
        <div id="tab-places" role="tabpanel" aria-label="أماكني">
          <MyPlacesScreen data={myPlaces} planHref={planHref} />
        </div>
      ) : (
        <div id="tab-jawaz" role="tabpanel" aria-label="جوازي">
          <PassportScreen initialRows={initialRows} derived={derived} />
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, controls, children }: {
  active: boolean; onClick: () => void; controls: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      onClick={onClick}
      className={`flex-1 min-h-[44px] rounded-pill text-[13.5px] font-extrabold transition active:scale-[0.97] ${
        active ? "bg-sea text-white shadow-btn-sea" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}
