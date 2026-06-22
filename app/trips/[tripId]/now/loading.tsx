// Now-screen skeleton — three card placeholders matching the real layout.

export default function Loading() {
  return (
    <main className="max-w-2xl mx-auto px-4 pb-24 pt-5">
      <div className="h-4 w-24 bg-stone-200 rounded-pill mb-3 animate-pulse" />
      <div className="bg-gradient-to-br from-sea via-sea-600 to-sea-700 rounded-2xl p-4 mb-3 h-32 animate-pulse" />
      <div className="flex gap-1.5 mb-3">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-8 w-16 bg-stone-200 rounded-pill animate-pulse" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-white border-2 border-line rounded-2xl shadow overflow-hidden">
            <div className="h-7 bg-stone-50 border-b border-line animate-pulse" />
            <div className="aspect-[16/8] bg-stone-200 animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-3 bg-stone-200 rounded w-2/3 animate-pulse" />
              <div className="h-3 bg-stone-100 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
