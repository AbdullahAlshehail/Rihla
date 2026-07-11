// Stage 3 — group evidence for the same place into ONE candidate and decide
// which records count as INDEPENDENT proof. Pure, deterministic.
//
// NOT independent (owner spec):
//   • identical URL (url_hash dedup)
//   • reposts of the same content (content_hash dedup)
//   • multiple results from the same account (count once)
//   • multiple articles syndicating one source (same content, diff domains)
//   • search/hashtag/explore pages (excluded entirely upstream)
//   • the venue's OWN official account (weak supporting signal only)

import { normalizeName, namesMatch } from "@/lib/trending/v2/normalize";
import type { CandidateAggregate, CandidateMetrics, EvidenceRecord } from "@/lib/trending/v2/types";

const DAY_MS = 86_400_000;

/** Group parsed evidence records into per-venue candidates. */
export function aggregateCandidates(
  records: EvidenceRecord[], now: Date,
): CandidateAggregate[] {
  const groups: Array<{ keys: string[]; rawNames: string[]; evidence: EvidenceRecord[] }> = [];

  for (const rec of records) {
    if (rec.evidence_type === "aggregation_page") continue; // never evidence
    if (!rec.place_name_raw) continue;                       // no clear name → no candidate
    const norm = normalizeName(rec.place_name_raw);
    if (!norm) continue;

    const group = groups.find((g) => g.keys.some((k) => namesMatch(k, norm)));
    if (group) {
      if (!group.keys.includes(norm)) group.keys.push(norm);
      if (!group.rawNames.includes(rec.place_name_raw)) group.rawNames.push(rec.place_name_raw);
      group.evidence.push(rec);
    } else {
      groups.push({ keys: [norm], rawNames: [rec.place_name_raw], evidence: [rec] });
    }
  }

  return groups.map((g) => {
    const independent = pickIndependent(g.evidence);
    // Display name: prefer the longest rules-extracted raw name (most literal).
    const best = [...g.rawNames].sort((a, b) => b.length - a.length)[0];
    return {
      place_name: best,
      normalized_name: g.keys[0],
      aliases: g.keys.slice(1),
      evidence: g.evidence,
      independent,
      metrics: computeMetrics(g.evidence, independent, now),
    };
  });
}

/** Apply the independence rules inside one candidate's evidence set. */
export function pickIndependent(evidence: EvidenceRecord[]): EvidenceRecord[] {
  const byUrl = new Set<string>();
  const byContent = new Set<string>();
  const byAccount = new Set<string>();
  const out: EvidenceRecord[] = [];

  // Deterministic order: newest reliable date first (nulls last), then URL —
  // so "count the account once" keeps the freshest post from that account.
  const sorted = [...evidence].sort((a, b) => {
    const ta = a.published_at ? Date.parse(a.published_at) : -1;
    const tb = b.published_at ? Date.parse(b.published_at) : -1;
    if (tb !== ta) return tb - ta;
    return a.url < b.url ? -1 : 1;
  });

  for (const rec of sorted) {
    if (rec.evidence_type === "aggregation_page") continue;
    if (rec.is_official_account) continue;            // weak signal, never proof
    if (byUrl.has(rec.url_hash)) continue;            // identical URL
    if (byContent.has(rec.content_hash)) continue;    // repost / syndication
    // Register the hashes even when the record is dropped as an account
    // duplicate — a later repost of ITS content must still be recognized.
    byUrl.add(rec.url_hash);
    byContent.add(rec.content_hash);
    const accountKey = rec.creator_name
      ? `${rec.source}:${rec.creator_name}`
      : rec.source === "news" || rec.source === "blog" || rec.source === "web"
        ? `domain:${domainOf(rec.url)}`
        : null;
    if (accountKey && byAccount.has(accountKey)) continue; // same account twice
    if (accountKey) byAccount.add(accountKey);
    out.push(rec);
  }
  return out;
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function computeMetrics(
  all: EvidenceRecord[], independent: EvidenceRecord[], now: Date,
): CandidateMetrics {
  const nowMs = now.getTime();
  const ageDays = (rec: EvidenceRecord): number | null =>
    rec.published_at ? (nowMs - Date.parse(rec.published_at)) / DAY_MS : null;

  let m7 = 0, m8_14 = 0, m14 = 0, reliable = 0;
  let newestAge: number | null = null;
  const creators = new Set<string>();
  const platforms = new Set<string>();
  const directSources = new Set<string>();
  let direct = 0, articles = 0, listicles = 0;
  let maxEngagement: number | null = null;

  for (const rec of independent) {
    const age = ageDays(rec);
    if (age != null) {
      reliable++;
      if (newestAge == null || age < newestAge) newestAge = age;
      if (age <= 7) { m7++; m14++; }
      else if (age <= 14) { m8_14++; m14++; }
    }
    creators.add(rec.creator_name ? `${rec.source}:${rec.creator_name}` : `domain:${domainOf(rec.url)}`);
    platforms.add(rec.source);
    if (rec.is_direct_content) { direct++; directSources.add(`${rec.source}:${rec.creator_name ?? domainOf(rec.url)}`); }
    if (rec.evidence_type === "article") articles++;
    if (rec.evidence_type === "listicle") { articles++; listicles++; }
    if (rec.engagement_count != null) {
      maxEngagement = Math.max(maxEngagement ?? 0, rec.engagement_count);
    }
  }

  const official = all.filter((r) => r.is_official_account).length;
  const hasAd = independent.some((r) => r.has_ad_marker);

  return {
    mentions_last_7_days: m7,
    mentions_days_8_to_14: m8_14,
    mentions_last_14_days: m14,
    unique_creators: creators.size,
    unique_direct_sources: directSources.size,
    platform_count: platforms.size,
    direct_content_count: direct,
    official_content_count: official,
    article_count: articles,
    listicle_count: listicles,
    reliable_date_count: reliable,
    independent_evidence_count: independent.length,
    newest_reliable_age_days: newestAge,
    max_engagement: maxEngagement,
    has_ad_marker: hasAd,
  };
}
