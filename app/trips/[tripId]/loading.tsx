// Loading skeleton shown instantly while the trip page streams in.
// Mirrors the actual layout so there's no layout shift.

export default function Loading() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-5">
      <div className="h-4 w-20 bg-stone-200 rounded-pill mb-3 animate-pulse" />

      {/* Header shimmer */}
      <div className="bg-gradient-to-br from-sea via-sea-600 to-sea-700 rounded-2xl p-4 mb-3 shadow-lg">
        <div className="h-7 w-32 bg-white/30 rounded mb-2" />
        <div className="h-3 w-48 bg-white/20 rounded mb-1" />
        <div className="h-3 w-40 bg-white/20 rounded" />
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-white/15 rounded-xl px-2.5 py-2 h-14" />
          <div className="bg-white/15 rounded-xl px-2.5 py-2 h-14" />
        </div>
      </div>

      {/* Tab switcher shimmer */}
      <div className="bg-white border border-line rounded-2xl mb-3 flex p-1 gap-1">
        <div className="flex-1 h-9 bg-sea rounded-xl animate-pulse" />
        <div className="flex-1 h-9 bg-stone-100 rounded-xl" />
      </div>

      {/* Cards skeleton */}
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card border border-line rounded-2xl shadow overflow-hidden">
            <div className="px-3 py-2 bg-stone-50 border-b border-line h-8 animate-pulse" />
            <div className="p-3">
              <div className="flex gap-3">
                <div className="w-16 h-16 rounded-xl bg-stone-200 shrink-0 animate-pulse" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="h-4 bg-stone-200 rounded w-3/4 animate-pulse" />
                  <div className="h-3 bg-stone-100 rounded w-1/2" />
                  <div className="h-3 bg-stone-100 rounded w-2/3" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
