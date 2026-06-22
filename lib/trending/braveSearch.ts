// Brave Search API client — replaces Anthropic's built-in web_search tool
// for the trending scan. Brave's free tier (2000 queries/month) cuts the
// scan cost ~75 % vs Anthropic web_search ($0.01/query).
//
// Why Brave specifically:
//   • Indexes TikTok / Instagram pages directly (we need URL evidence)
//   • Returns clean JSON (title + url + description) — no HTML parsing
//   • Free tier is the most generous (Tavily = 1000, Serper = 2500 one-time)
//   • Permissive rate limits (1 q/sec on free, plenty for our use)
//
// Requires env var `BRAVE_API_KEY`. If missing, scan.ts falls back to the
// previous Anthropic web_search path so the feature never silently fails.

export type BraveResult = {
  title: string;
  url: string;
  description: string;
  age?: string;       // "2 days ago" / "2025-08-12" — useful for recency scoring
  language?: string;
};

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export async function braveSearch(
  query: string,
  opts: { count?: number; country?: string; freshness?: "pd" | "pw" | "pm" | "py" } = {},
): Promise<BraveResult[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error("brave_key_missing");

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(20, opts.count ?? 10)));
  // ALL = mix of locales (Arabic + English + French — covers Saudi/Arab users)
  url.searchParams.set("country", opts.country ?? "all");
  if (opts.freshness) url.searchParams.set("freshness", opts.freshness);
  // Strip extra noise — we only want web results, not videos/news block
  url.searchParams.set("result_filter", "web");

  const resp = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`brave_${resp.status}: ${text.slice(0, 200)}`);
  }

  const json = await resp.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string; language?: string }> };
  };

  return (json.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
    age: r.age,
    language: r.language,
  }));
}

// Convenience: run several queries in parallel, dedupe by URL, cap total size.
// We send all results to Claude in one go — token cost grows linearly, so we
// keep this tight.
export async function braveMulti(
  queries: string[],
  perQueryCount = 8,
): Promise<BraveResult[]> {
  const buckets = await Promise.all(
    queries.map((q) =>
      braveSearch(q, { count: perQueryCount, freshness: "py" })   // past year
        .catch((e) => {
          console.warn(`[brave] query failed: ${q} → ${e instanceof Error ? e.message : e}`);
          return [] as BraveResult[];
        }),
    ),
  );

  // Dedupe by URL — preserves the first occurrence (highest-ranked across queries).
  const seen = new Set<string>();
  const merged: BraveResult[] = [];
  for (const bucket of buckets) {
    for (const r of bucket) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
    }
  }

  // Cap at 40 results total — anything beyond bloats Claude input without
  // improving match quality.
  return merged.slice(0, 40);
}
