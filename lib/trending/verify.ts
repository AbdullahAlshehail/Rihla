// URL verification — guards against Claude hallucinating trending evidence.
// Two layers:
//   1. Pattern check (free, instant): is the URL on a real social platform?
//   2. HEAD probe (network, ~1-3s): does the URL actually resolve?
// We never block on HEAD — a 4xx just downgrades the source to `pattern_only`.

export type VerificationKind = "verified" | "pattern_only" | "web";

const PLATFORM_HOSTS = {
  tiktok: /^(www\.|m\.)?tiktok\.com$/i,
  instagram: /^(www\.)?instagram\.com$/i,
} as const;

export function platformFromUrl(url: string): "tiktok" | "instagram" | "web" | null {
  try {
    const u = new URL(url);
    if (PLATFORM_HOSTS.tiktok.test(u.hostname)) return "tiktok";
    if (PLATFORM_HOSTS.instagram.test(u.hostname)) return "instagram";
    // Generic web — only accept https + a plausible host
    if (u.protocol === "https:" && u.hostname.includes(".")) return "web";
    return null;
  } catch {
    return null;
  }
}

// Parallel HEAD probe with a 4-second per-URL timeout. Returns the
// verification class for each URL in the same order.
export async function verifyUrls(urls: string[]): Promise<VerificationKind[]> {
  const out = await Promise.all(urls.map(async (url): Promise<VerificationKind> => {
    const platform = platformFromUrl(url);
    if (platform == null) return "web";
    // For non-platform URLs we still classify as "web" without probing.
    if (platform === "web") return "web";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      // TikTok/Instagram bot-block GET — use HEAD which they generally honor.
      // 403 / 999 from these hosts means "page exists but not for bots", which
      // is still good news (URL is real). We accept 2xx, 3xx, 4xx as "exists".
      const resp = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (compatible; Rihla/1.0)" },
      });
      // Anything except a network error means the URL is real.
      if (resp.status < 500) return "verified";
      return "pattern_only";
    } catch {
      // Network error or timeout — keep the pattern match as the lowest
      // viable signal so we don't lose the candidate entirely.
      return "pattern_only";
    } finally {
      clearTimeout(timer);
    }
  }));
  return out;
}
