# Rihla — Map Experience (Review Brief)

**Production:** https://rihla-travel.netlify.app (login required)
**Stack:** Next.js 14 App Router · TypeScript · Tailwind RTL · Leaflet + react-leaflet + markercluster · Supabase

This bundle contains **only the files that build the map experience**. We
deliberately stripped the rest of the app — auth, bookings, AI features, etc.
— so you can review the map in isolation.

## Design goals

> "اجعل تجربة الخريطة أحسن من Google Maps في اللمس وسهولة تصفّح الأماكن."

- iPhone-first (the user runs the live app as a PWA on iPhone).
- RTL Arabic UI.
- Single-tap place browsing — no zoom-out on marker tap, no popup blocking the map.
- Persistent live location once the user grants it (Permissions API).
- Card-style bottom carousel synced with the map (Apple-Maps-like UX).
- "Details" opens a full sheet on top of the map (no navigation away).

## File map

```
app/
  layout.tsx                        ← Leaflet CSS imports + global RTL setup
  globals.css                       ← Tailwind base + custom map styles
  trips/[tripId]/map/page.tsx       ← Server component: loads trip + places, mounts <MapScreen/>

components/
  MapScreen.tsx                     ← Full-page map shell: top filter bar, FAB, carousel,
                                       state for selection / focus / saved set.
                                       Also contains the inline MapFilterSheet modal.
  DiscoverMap.tsx                   ← The actual react-leaflet map: clusters, markers, pan/zoom,
                                       focusTrigger, asymmetric pan-skip pad for the carousel,
                                       scoped setIcon to avoid re-rendering 150 markers.
  MapBottomCarousel.tsx             ← Horizontal cards under the map. Click pans the map to the
                                       marker; cards show photo + name + category gradient
                                       fallback + distance + open status.
  MapPlacePopup.tsx                 ← Legacy small popup (still used inline on /discover; on
                                       the full-page map we open <PlaceDetailSheet/> instead).
  PlaceDetailSheet.tsx              ← Full bottom-sheet detail modal (z-[1500], above
                                       carousel). Includes photos, reviews, best-time, save,
                                       directions, add to plan.

lib/
  geo/useGeoLocation.ts             ← Persistent geolocation: Permissions API + watchPosition
                                       + 30-day localStorage cache + 30m movement throttle.
  utils.ts                          ← haversineKm, fmtKm, fmtMins, estimateTravelTimes,
                                       formatOpenStatus, parseIntervals, buildDirectionsUrl…
  images.ts                         ← photoAtWidth (responsive image sizing)
  highlights.ts                     ← getHighlightDisplays, getKindDisplay (category badges)
  scoring/smartScore.ts             ← computeSmartScore (rating × reviews × tier penalty)
  google/bestTime.ts                ← bestTimeFor (popular-times → best slot recommendation)
  google/reviewKeywords.ts          ← extractMentions, ratingHistogram (review insights)
  supabase/database.types.ts        ← TypeScript types incl. Place + Trip

tailwind.config.ts                  ← Custom palette, fonts, spacing
package.json                        ← Map deps: leaflet, react-leaflet, leaflet.markercluster
tsconfig.json
```

## Known UX decisions (rationale)

| Decision | Why |
|---|---|
| Bottom carousel instead of single popup | Lets the user scan many places without opening/closing modals; matches Apple Maps. |
| `focusTrigger` counter | React doesn't re-run useEffect on same selectedId — user wanted re-tap-to-recenter behaviour. |
| Asymmetric pan-skip pad (bottomReserve 210) | Map only re-pans if marker is off-screen *above* the carousel overlay. |
| Scoped `setIcon` (prev + new only) | Originally re-rendered all 150 markers on each selection → laggy on mid-tier iPhones. |
| `MapFilterSheet` inline (not separate file) | Only used here; keeps map state colocated. |
| Permissions API + watchPosition | The user wanted "iPhone-app-style" persistent location — this is the closest a PWA can get without a re-prompt loop. |
| 30 m throttle in watchPosition | GPS jitters 2 m even when standing still — without throttle, React re-renders 10×/sec. |
| z-[1500] on PlaceDetailSheet | Was z-[60] but carousel is z-[750] → sheet was behind carousel (THE "details button doesn't work" bug). |
| Card width 160 / selected 210 | iPhone tap-target sweet spot — bigger card for the selected one is a visual confirmation. |

## What we want from review

1. **UX**: Is the bottom-carousel pattern the right call? Anything Apple Maps / Google Maps does that we're missing?
2. **Perf on mid-tier iPhone**: We capped clusters at zoom 17, scoped setIcon, and lazy-load the map chunk. Any further wins?
3. **Touch precision**: Markers + carousel cards + FAB + filter chips — any tap-target conflicts or overlaps you notice?
4. **A11y / RTL**: We tested with VoiceOver loosely; any RTL gotchas?
5. **Layering**: Top bar 900 · carousel 750 · sheet 1500. Sane?

The bookings/AI/auth code is in the full app but **not in this bundle** — please don't suggest changes that require it.
