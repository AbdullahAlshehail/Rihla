// Trips list skeleton — shows instantly while the list streams.

export default function Loading() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-6">
      <div className="h-8 w-32 bg-stone-200 rounded mb-6 animate-pulse" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-card border border-line rounded-2xl shadow p-4">
            <div className="h-5 bg-stone-200 rounded w-2/3 mb-2 animate-pulse" />
            <div className="h-3 bg-stone-100 rounded w-1/2 mb-2" />
            <div className="h-3 bg-stone-100 rounded w-1/3" />
          </div>
        ))}
      </div>
    </main>
  );
}
