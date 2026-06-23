"use client";

// Interactive map view for the Discover tab.
//
// • Free OSM tiles (Carto Voyager fallback for nicer aesthetic) — zero cost.
// • Marker clustering via leaflet.markercluster so 1,500 markers feel fast.
// • Each marker is a div-icon with category colour + emoji (legible from far).
// • Tapping a marker opens MapPlacePopup — a smooth bottom sheet, NOT a leaflet
//   popup, so it integrates with the rest of the mobile UX.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet.markercluster";
import type { Place } from "@/lib/supabase/database.types";
import MapPlacePopup from "@/components/MapPlacePopup";
import { haversineKm } from "@/lib/utils";

// Category palette — matches the rest of the app
const CAT_COLOR: Record<string, string> = {
  food:   "#dc2626",
  coffee: "#a16207",
  sweet:  "#db2777",
  sight:  "#0284c7",
  nature: "#16a34a",
  event:  "#7c3aed",
  bar:    "#ca8a04",
};
const CAT_EMOJI: Record<string, string> = {
  food: "🍽", coffee: "☕", sweet: "🍰",
  sight: "🏛", nature: "🌿", event: "🎭", bar: "🍸",
};

// Visible circle is 32 px (40 px selected), but we wrap it in a 44×44 px
// transparent hit area so the tap target meets Apple/WCAG guidance even on
// thumbs in motion. The outer box is the icon; the colored circle is centered
// inside via flex. Anchor stays at the visual center.
const HIT = 44;
function emojiIcon(p: Place, selected: boolean, sequenceNumber?: number): L.DivIcon {
  const color = CAT_COLOR[p.category] ?? "#0c4a63";
  const emoji = CAT_EMOJI[p.category] ?? "📍";
  const size = selected ? 40 : 32;
  const ring = selected ? "border: 3px solid #f97316;" : "border: 2px solid white;";
  // Plan-mode: number takes over the emoji slot and we shift the color
  // palette to deep ocean so the route reads as "your plan" not "discover".
  if (sequenceNumber != null) {
    const planColor = selected ? "#0c4a63" : "#075985";
    const numFontSize = sequenceNumber < 10 ? size * 0.55 : sequenceNumber < 100 ? size * 0.45 : size * 0.35;
    return L.divIcon({
      className: "rihla-pin",
      html: `<div style="width:${HIT}px;height:${HIT}px;display:grid;place-items:center;"><div style="background:${planColor};color:white;width:${size}px;height:${size}px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:${numFontSize}px;${ring}box-shadow:0 2px 10px rgba(12,74,99,.55);transition:transform .12s;">${sequenceNumber}</div></div>`,
      iconSize: [HIT, HIT],
      iconAnchor: [HIT / 2, HIT / 2],
      popupAnchor: [0, -size / 2],
    });
  }
  // Discover-mode: keep the category emoji + flame badge for trending.
  const trending = (p.trending_score ?? 0) >= 50;
  const trendBadge = trending
    ? `<div style="position:absolute;top:-3px;right:-3px;background:linear-gradient(to left,#ec4899,#f97316);color:white;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font-size:9px;border:1.5px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);">🔥</div>`
    : "";
  return L.divIcon({
    className: "rihla-pin",
    html: `<div style="width:${HIT}px;height:${HIT}px;display:grid;place-items:center;"><div style="position:relative;background:${color};color:white;width:${size}px;height:${size}px;border-radius:50%;display:grid;place-items:center;font-size:${size * 0.55}px;${ring}box-shadow:0 2px 8px rgba(0,0,0,.35);transition:transform .12s;">${emoji}${trendBadge}</div></div>`,
    iconSize: [HIT, HIT],
    iconAnchor: [HIT / 2, HIT / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Distinct visual for high-rated places — small gold ring overlay
function rateRing(p: Place): string {
  const r = p.rating ?? 0;
  if (r >= 4.7) return "outline: 2px solid #fbbf24; outline-offset: 1px;";
  return "";
}

// ─── Cluster layer (vanilla L.markerClusterGroup wrapped in a hook) ─────

function ClusterLayer({
  places, selectedId, onPick, numberedPlaces, userLocation,
}: {
  places: Place[];
  selectedId: string | null;
  onPick: (p: Place) => void;
  /** When set, markers render the supplied 1-based sequence number instead
   *  of the category emoji. Used by the "خطتي" tab. */
  numberedPlaces?: Map<string, number> | null;
  /** When provided, the initial fit centers on the user (zoom 14 ≈ neighborhood)
   *  so the map opens where they ARE, not on the catalogue centroid. */
  userLocation?: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  const markersByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const initialFitDoneRef = useRef(false);

  // Build cluster + markers. Deliberately does NOT depend on `selectedId` or
  // `onPick` so re-selecting a marker (or React re-rendering the callback)
  // never tears down the cluster — the prior version did, which caused the
  // map to zoom out on every tap.
  useEffect(() => {
    if (!map) return;

    const cluster = (L as typeof L & {
      markerClusterGroup: (opts: Record<string, unknown>) => L.LayerGroup;
    }).markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 55,
      disableClusteringAtZoom: 17,
      showCoverageOnHover: false,
      // Disable spiderfy + auto-zoom on cluster click; the user wants tap-to-
      // open-info, not "snap me to max zoom on a single tap".
      spiderfyOnMaxZoom: false,
      zoomToBoundsOnClick: false,
      iconCreateFunction: (c: L.MarkerCluster) => {
        const n = c.getChildCount();
        const size = n < 10 ? 32 : n < 100 ? 38 : 44;
        const bg = n < 10 ? "#0c4a63" : n < 100 ? "#075985" : "#0f172a";
        return L.divIcon({
          html: `<div style="background:${bg};color:white;width:${size}px;height:${size}px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:${size * 0.4}px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,.4);">${n}</div>`,
          className: "rihla-cluster",
          iconSize: [size, size],
        });
      },
    });
    // When the user taps a cluster, ZOOM IN by one step at most — never to
    // max zoom — and don't recenter aggressively.
    cluster.on("clusterclick", (e: L.LeafletEvent) => {
      const ev = e as L.LeafletEvent & { layer?: L.MarkerCluster };
      const c = ev.layer;
      if (!c) return;
      // Cap at the clustering-disabled threshold so a single tap is enough
      // to break a tight cluster (was 16 → required a second tap, audit fix).
      const target = Math.min(map.getZoom() + 2, 17);
      map.setView(c.getLatLng(), target, { animate: true });
    });

    const newIndex = new Map<string, L.Marker>();
    for (const p of places) {
      if (p.lat == null || p.lng == null) continue;
      const seq = numberedPlaces?.get(p.id);
      const marker = L.marker([p.lat, p.lng], {
        icon: emojiIcon(p, false, seq),
      });
      const ring = rateRing(p);
      if (ring) {
        const el = marker.getElement();
        if (el) el.setAttribute("style", (el.getAttribute("style") ?? "") + ";" + ring);
      }
      // Closure binds the current onPick — but we read it via ref-like
      // capture each time the layer is rebuilt. onPick from parent is wrapped
      // in useCallback below so this should rarely re-execute.
      marker.on("click", () => onPick(p));
      cluster.addLayer(marker);
      newIndex.set(p.id, marker);
    }
    map.addLayer(cluster);
    markersByIdRef.current = newIndex;

    // ONE-TIME initial fit — only on the very first mount, never on filter
    // change. Keeps the user's pan/zoom intact when they tweak chips.
    //
    // Strategy (per user request "افتح الخريطة على موقعي"):
    //   • If GPS is granted → snap to user @ z=14 (neighborhood). Better
    //     than fitBounds since the catalogue might be a far-away city.
    //   • Else → fit bounds around all visible places.
    if (!initialFitDoneRef.current) {
      if (userLocation) {
        map.setView([userLocation.lat, userLocation.lng], 14, { animate: false });
        initialFitDoneRef.current = true;
      } else if (places.length > 0) {
        const bounds = L.latLngBounds(
          places
            .filter((p) => p.lat != null && p.lng != null)
            .map((p) => [p.lat!, p.lng!]),
        );
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
        initialFitDoneRef.current = true;
      }
    }

    return () => {
      map.removeLayer(cluster);
      markersByIdRef.current = new Map();
    };
  // `onPick` purposefully excluded — parent stabilizes it via useCallback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, places, numberedPlaces]);

  // When GPS arrives AFTER the initial places-only fit (slow Permissions API
  // grant), pan to user once. Without this, the user lands on the catalogue
  // bbox and never sees themselves until they tap the 📍 button.
  const userLocFitRef = useRef(false);
  useEffect(() => {
    if (!map || !userLocation || userLocFitRef.current) return;
    userLocFitRef.current = true;
    map.setView([userLocation.lat, userLocation.lng], 14, { animate: true });
    initialFitDoneRef.current = true;
  }, [map, userLocation]);

  // Update only the markers whose selection state changed — was looping
  // over 150 markers per tap (audit fix). Now exactly 2 setIcon calls.
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const index = markersByIdRef.current;
    if (index.size === 0) return;
    const prev = prevSelectedIdRef.current;
    if (prev && prev !== selectedId) {
      const m = index.get(prev);
      const p = places.find((x) => x.id === prev);
      if (m && p) m.setIcon(emojiIcon(p, false, numberedPlaces?.get(p.id)));
    }
    if (selectedId) {
      const m = index.get(selectedId);
      const p = places.find((x) => x.id === selectedId);
      if (m && p) m.setIcon(emojiIcon(p, true, numberedPlaces?.get(p.id)));
    }
    prevSelectedIdRef.current = selectedId ?? null;
  }, [selectedId, places, numberedPlaces]);

  return null;
}

// ─── Map shell ──────────────────────────────────────────────────────────

export default function DiscoverMap({
  places,
  totalCount,
  showingAll,
  onShowAll,
  userLocation,
  hotelLocation,
  cities,
  activeCity,
  onCityChange,
  onOpenDetail,
  fullHeight = false,
  selectedId,
  onSelect,
  hidePopup = false,
  recenterTrigger,
  focusTrigger,
  fitAllTrigger,
  cityChangeTrigger,
  numberedPlaces,
}: {
  /** The (capped) place list rendered as markers. */
  places: Place[];
  /** Total places in the current filter — drives "أظهر الكل (N)" hint. */
  totalCount?: number;
  showingAll?: boolean;
  onShowAll?: () => void;
  userLocation?: { lat: number; lng: number } | null;
  hotelLocation?: { lat: number; lng: number } | null;
  /** Cities offered as floating quick-switch pills. Ordered by frequency. */
  cities?: Array<{ label: string; count: number }>;
  activeCity?: string | null;
  onCityChange?: (next: string | null) => void;
  /** Called when the user taps "تفاصيل" in the bottom sheet. */
  onOpenDetail?: (p: Place) => void;
  /** When true, the map fills its parent container — used by the full-page
   *  MapScreen. Default false keeps the embedded 68vh height. */
  fullHeight?: boolean;
  /** Controlled selection — when provided, the map gently pans to the place
   *  whenever this id changes. Use with `onSelect` to integrate with an
   *  external UI (e.g. MapBottomCarousel). */
  selectedId?: string | null;
  onSelect?: (p: Place) => void;
  /** When true, the internal MapPlacePopup is suppressed — the consumer
   *  drives selection externally (e.g. via a bottom carousel). */
  hidePopup?: boolean;
  /** Increment this to request a recenter on user/hotel. Used by MapScreen's
   *  top-bar موقعي button — keeps the imperative logic encapsulated here. */
  recenterTrigger?: number;
  /** Increment this to FORCE a pan to whatever selectedId points to —
   *  needed when the user taps the same card twice (no selectedId diff). */
  focusTrigger?: number;
  /** Increment to fit map bounds around ALL loaded places — used by the
   *  "🌍 كل المنطقة" header button so the user sees the whole region. */
  fitAllTrigger?: number;
  /** Increment when the active city filter changes — map snaps to the
   *  new city's bounds so visual scope matches the active filter. */
  cityChangeTrigger?: number;
  /** When provided, markers render the supplied 1-based sequence number
   *  instead of the category emoji. Plan tab uses this for ordered itinerary. */
  numberedPlaces?: Map<string, number> | null;
}) {
  const [selected, setSelected] = useState<Place | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const center = useMemo<[number, number]>(() => {
    if (userLocation) return [userLocation.lat, userLocation.lng];
    if (hotelLocation) return [hotelLocation.lat, hotelLocation.lng];
    const withCoords = places.filter((p) => p.lat != null && p.lng != null);
    if (withCoords.length === 0) return [43.7, 7.25]; // Côte d'Azur default
    const lat = withCoords.reduce((s, p) => s + p.lat!, 0) / withCoords.length;
    const lng = withCoords.reduce((s, p) => s + p.lng!, 0) / withCoords.length;
    return [lat, lng];
  }, [places, userLocation, hotelLocation]);

  function recenter() {
    const target = userLocation ?? hotelLocation;
    if (target && mapRef.current) {
      mapRef.current.flyTo([target.lat, target.lng], 14, { duration: 0.7 });
    }
  }

  // External recenter trigger from MapScreen's top-bar button. Effect fires
  // whenever the counter increments (parent owns the source of truth).
  useEffect(() => {
    if (recenterTrigger == null) return;
    recenter();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterTrigger]);

  // "🌍 كل المنطقة" button: fit bounds around ALL loaded places so the user
  // can see every city at once instead of just their GPS neighborhood.
  useEffect(() => {
    if (fitAllTrigger == null || !mapRef.current) return;
    const coords = places
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => [p.lat!, p.lng!] as [number, number]);
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12, animate: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitAllTrigger]);

  // City change: when MapScreen narrows places to a new city, snap to its
  // bounds so the user doesn't end up looking at the old city's geography
  // while filters say something else. Skips the very first tick (mount) so
  // we don't override the initial-fit / GPS center logic above.
  const cityChangePrevRef = useRef<number | undefined>(cityChangeTrigger);
  useEffect(() => {
    if (cityChangeTrigger == null || !mapRef.current) return;
    if (cityChangeTrigger === cityChangePrevRef.current) return;
    cityChangePrevRef.current = cityChangeTrigger;
    // Mount tick is the FIRST value we ever see — skip it.
    if (cityChangeTrigger <= 1) return;
    const coords = places
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => [p.lat!, p.lng!] as [number, number]);
    if (coords.length === 0) return;
    const bounds = L.latLngBounds(coords);
    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityChangeTrigger]);

  // Stable handler so ClusterLayer's effect doesn't tear down on every render
  const handlePick = useCallback((p: Place) => {
    setSelected(p);
    onSelect?.(p);
  }, [onSelect]);

  // Sync internal selected with controlled selectedId prop.
  // When parent sets selectedId=null (e.g. carousel sort change), we MUST
  // also clear the internal selected state so the orange ring goes away —
  // previously this branch returned early and left the old marker styled.
  useEffect(() => {
    if (selectedId == null) {
      if (selected !== null) setSelected(null);
      return;
    }
    const p = places.find((x) => x.id === selectedId);
    if (p && p !== selected) setSelected(p);
  }, [selectedId, places, selected]);

  // Pan the map to the selected place WITHOUT changing zoom. ALWAYS pans on
  // explicit user action (selectedId change OR focusTrigger increment) so the
  // user never has to tap twice to see what they picked. Skips only when the
  // marker is already comfortably visible AND the trigger didn't change.
  const prevFocusTickRef = useRef<number | undefined>(focusTrigger);
  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const p = places.find((x) => x.id === selectedId);
    if (!p || p.lat == null || p.lng == null) return;
    const m = mapRef.current;
    const target = L.latLng(p.lat, p.lng);
    const forced = focusTrigger !== prevFocusTickRef.current;
    prevFocusTickRef.current = focusTrigger;
    if (!forced) {
      // selectedId-only change: skip pan if already comfortably visible
      // (carousel overlays the bottom ~210 px in full-screen mode).
      const size = m.getSize();
      const bottomReserve = hidePopup ? 210 : 24;
      const tl = m.containerPointToLatLng(L.point(20, 16));
      const br = m.containerPointToLatLng(L.point(size.x - 20, size.y - bottomReserve));
      if (L.latLngBounds(tl, br).contains(target)) return;
    }
    // Compute an offset so the pin sits in the UPPER-MIDDLE of the visible
    // area (the carousel covers the bottom). Effective center = target +
    // shift downward in screen pixels.
    const size2 = m.getSize();
    const bottomReserve2 = hidePopup ? 210 : 0;
    const visibleCenter = L.point(size2.x / 2, (size2.y - bottomReserve2) / 2);
    const mapCenter = L.point(size2.x / 2, size2.y / 2);
    const offsetPx = mapCenter.subtract(visibleCenter);
    const targetPx = m.latLngToContainerPoint(target);
    const adjustedPx = targetPx.add(offsetPx);
    const adjusted = m.containerPointToLatLng(adjustedPx);
    m.panTo(adjusted, { animate: true, duration: 0.4 });
  }, [selectedId, places, hidePopup, focusTrigger]);

  // Nearby suggestions — 3 closest places from the map's filtered pool, within
  // 3 km of the currently-selected pin. Re-computes only when selection moves.
  const nearby = useMemo(() => {
    if (!selected || selected.lat == null || selected.lng == null) return [];
    const src = { lat: selected.lat, lng: selected.lng };
    return places
      .filter((p) => p.id !== selected.id && p.lat != null && p.lng != null)
      .map((p) => ({ place: p, km: haversineKm(src, { lat: p.lat!, lng: p.lng! }) }))
      .filter((x) => x.km <= 3)
      .sort((a, b) => a.km - b.km)
      .slice(0, 4);
  }, [selected, places]);

  // When the user EXPLICITLY taps a city pill (activeCity changes), gently
  // fly to the city's bounds. Filter changes alone never trigger this —
  // they keep the user's current viewport intact.
  const prevCityRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevCityRef.current === undefined) {
      prevCityRef.current = activeCity ?? null;
      return; // skip initial render
    }
    if (prevCityRef.current === (activeCity ?? null)) return;
    prevCityRef.current = activeCity ?? null;
    if (!mapRef.current || places.length === 0) return;
    const valid = places.filter((p) => p.lat != null && p.lng != null);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map((p) => [p.lat!, p.lng!]));
    if (bounds.isValid()) {
      mapRef.current.flyToBounds(bounds, {
        padding: [40, 40], maxZoom: 14, duration: 0.7,
      });
    }
  }, [activeCity, places]);

  // Cap city pill list to top 4 most-populous + always keep activeCity even if
  // it falls out of the top 4 (so the user never loses their selection).
  const cityPills = (() => {
    if (!cities || cities.length < 2) return [];
    const top = cities.slice(0, 4);
    if (activeCity && !top.find((c) => c.label === activeCity)) {
      const sel = cities.find((c) => c.label === activeCity);
      if (sel) return [sel, ...top.slice(0, 3)];
    }
    return top;
  })();

  const renderedMarkerCount = places.filter((p) => p.lat != null && p.lng != null).length;

  return (
    <div className={
      fullHeight
        ? "relative w-full h-full overflow-hidden"
        : "relative -mx-4 overflow-hidden rounded-2xl border border-line"
    }>
      <div
        className={fullHeight ? "h-full w-full" : "h-[68vh] min-h-[420px] w-full"}
        style={{ touchAction: "none" }} // crisper pinch/pan, no page scroll fight
      >
        <MapContainer
          center={center}
          zoom={12}
          maxZoom={18}
          minZoom={3}
          preferCanvas
          worldCopyJump
          scrollWheelZoom={false}        // never accidental on wheel-mouse desktop
          // ── Google-Maps-grade smoothness ──
          zoomAnimation={true}            // animated zoom transitions
          markerZoomAnimation={true}      // markers animate with the zoom
          fadeAnimation={true}            // tiles cross-fade on layer change
          zoomSnap={0.5}                  // half-step pinch lands feel natural
          zoomDelta={0.5}                 // ditto for ± buttons
          wheelDebounceTime={40}          // smoother trackpad
          wheelPxPerZoomLevel={120}       // less twitchy
          bounceAtZoomLimits={false}      // no jarring bounce at min/max
          style={{ height: "100%", width: "100%" }}
          ref={(m) => { mapRef.current = m; }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            // Carto Voyager — cleaner, more Google-Maps-like aesthetic vs
            // raw OSM tiles. Same OSM data underneath. Free for low traffic.
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains={["a","b","c","d"]}
            maxZoom={19}
          />
          <ClusterLayer
            places={places}
            selectedId={selected?.id ?? null}
            onPick={handlePick}
            numberedPlaces={numberedPlaces ?? null}
            userLocation={userLocation ?? null}
          />
          {userLocation && (
            <UserDot lat={userLocation.lat} lng={userLocation.lng} />
          )}
          {hotelLocation && !userLocation && (
            <HotelDot lat={hotelLocation.lat} lng={hotelLocation.lng} />
          )}
        </MapContainer>
      </div>

      {/* Floating city pills (top). Suppressed when a consumer (MapScreen)
          renders its own city UI to avoid duplicate rows. */}
      {!hidePopup && cityPills.length > 0 && (
        <div
          className="absolute top-3 right-3 left-3 z-[400] flex gap-1.5 overflow-x-auto pb-0.5"
          style={{ scrollbarWidth: "none" }}
        >
          <button
            onClick={() => onCityChange?.(null)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-pill text-[12px] font-bold shadow-sm border transition active:scale-95 ${
              activeCity == null
                ? "bg-stone-900 text-white border-stone-900"
                : "bg-white/95 backdrop-blur text-stone-800 border-stone-200"
            }`}
          >
            🌍 الكل
          </button>
          {cityPills.map((c) => {
            const on = activeCity === c.label;
            return (
              <button
                key={c.label}
                onClick={() => onCityChange?.(on ? null : c.label)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-pill text-[12px] font-bold shadow-sm border transition active:scale-95 ${
                  on
                    ? "bg-sea text-white border-sea"
                    : "bg-white/95 backdrop-blur text-stone-800 border-stone-200"
                }`}
              >
                <span>📍</span><span>{c.label}</span>
                <span className={`text-[9.5px] ${on ? "opacity-95" : "opacity-60"}`}>{c.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Floating recenter — only rendered in embedded mode. The full-screen
          MapScreen renders its own button in the top bar to free the bottom
          band for the carousel. */}
      {!hidePopup && (userLocation || hotelLocation) && (
        <button
          onClick={recenter}
          className="absolute bottom-3 left-3 z-[400] bg-white border border-line text-stone-800 font-bold text-[12px] px-3 min-h-[44px] rounded-pill shadow-md active:scale-95 transition inline-flex items-center gap-1.5"
        >
          {userLocation ? "📍 موقعي" : "🏨 الفندق"}
        </button>
      )}

      {/* Show-all toggle — only relevant in embedded mode; carousel consumer
          drives its own pagination so we don't render it there. */}
      {!hidePopup && !showingAll && typeof totalCount === "number" && totalCount > renderedMarkerCount && onShowAll && (
        <button
          onClick={onShowAll}
          className="absolute bottom-3 right-3 z-[400] bg-coral text-white font-bold text-[12px] px-3 min-h-[44px] rounded-pill shadow-md active:scale-95 transition inline-flex items-center gap-1.5"
          title={`الخريطة تعرض ${renderedMarkerCount} من ${totalCount} — اضغط لعرضها كلها`}
        >
          ➕ أظهر الكل ({totalCount})
        </button>
      )}

      {/* Embedded-mode count badge — suppressed when an external UI shows it. */}
      {!hidePopup && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[300] bg-white/95 backdrop-blur border border-line text-stone-800 font-bold text-[11.5px] px-3 py-1.5 rounded-pill shadow pointer-events-none">
          🗺 {renderedMarkerCount}{totalCount && totalCount > renderedMarkerCount ? ` من ${totalCount}` : ""} مكان
        </div>
      )}

      {/* Bottom sheet popup — only when the consumer hasn't taken over with
          their own selection UI (e.g. MapBottomCarousel). */}
      {!hidePopup && (
        <MapPlacePopup
          place={selected}
          userLocation={userLocation ?? null}
          hotelLocation={hotelLocation ?? null}
          nearby={nearby}
          onPickNearby={(p) => setSelected(p)}
          onClose={() => setSelected(null)}
          onOpenDetail={(p) => onOpenDetail?.(p)}
        />
      )}
    </div>
  );
}

// ─── Small fixed dots for user + hotel ──────────────────────────────────

function UserDot({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="background:#1d4ed8;color:white;width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 0 0 6px rgba(29,78,216,.28);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);
    return () => { map.removeLayer(marker); };
  }, [map, lat, lng]);
  return null;
}

function HotelDot({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="background:#d97706;color:white;width:32px;height:32px;border-radius:50%;border:3px solid white;display:grid;place-items:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.35);">🏨</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 900,
    }).addTo(map);
    return () => { map.removeLayer(marker); };
  }, [map, lat, lng]);
  return null;
}
