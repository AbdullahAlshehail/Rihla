// Map-specific loading skeleton. Without this file the PARENT boundary
// (app/trips/[tripId]/loading.tsx — a card-LIST skeleton) flashed while the
// map page streamed in: the user saw "a different page, then the map".
// This skeleton mirrors the actual MapScreen shell (top control bar + chip
// row + full-bleed map area + bottom nav) so the transition reads as the
// map itself loading, with zero layout swap.

export default function Loading() {
  return (
    <div className="fixed inset-0 bg-[#e9e5dc]" aria-busy="true" aria-label="جارٍ تحميل الخريطة">
      {/* Top control bar shimmer */}
      <div className="absolute top-0 inset-x-0 z-10 bg-white/95 backdrop-blur border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="h-11 flex-1 bg-stone-200 rounded-pill animate-pulse" />
          <div className="w-11 h-11 bg-stone-200 rounded-pill animate-pulse" />
          <div className="w-11 h-11 bg-stone-900/80 rounded-pill animate-pulse" />
        </div>
        {/* Chip row shimmer */}
        <div className="flex gap-2 pt-2 pb-1 overflow-hidden">
          {[64, 88, 72, 96, 80].map((w, i) => (
            <div
              key={i}
              className="h-9 bg-stone-100 border border-line rounded-pill animate-pulse shrink-0"
              style={{ width: w }}
            />
          ))}
        </div>
      </div>

      {/* Map body — soft tile-like blocks so it reads as a map, not a blank */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute left-[12%] top-[30%] w-24 h-24 rounded-full bg-sea/10 animate-pulse" />
        <div className="absolute right-[18%] top-[45%] w-16 h-16 rounded-full bg-sea/10 animate-pulse" />
        <div className="absolute left-[40%] bottom-[35%] w-20 h-20 rounded-full bg-coral/10 animate-pulse" />
      </div>

      {/* Bottom carousel placeholder */}
      <div className="absolute bottom-[76px] inset-x-0 px-3">
        <div className="h-28 bg-white/90 border border-line rounded-2xl shadow animate-pulse" />
      </div>

      {/* Bottom nav placeholder — same height so nothing jumps */}
      <div
        className="absolute bottom-0 inset-x-0 bg-white/95 border-t border-line"
        style={{ height: "calc(64px + env(safe-area-inset-bottom))" }}
      />
    </div>
  );
}
