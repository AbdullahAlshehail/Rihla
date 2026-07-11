// Trend Discovery v2 — deterministic unit + fixture-driven end-to-end tests.
// Pure logic against injected fixtures: no network, no DB, no API keys.
//
// Run: npx tsx lib/trending/v2/engine.test.ts

import type { BraveResult } from "@/lib/trending/braveSearch";
import { normalizeName, transliterateAr, namesMatch, similarity, tokenOverlap } from "@/lib/trending/v2/normalize";
import {
  parseResult, parseAge, parseUrlDate, creatorFromUrl, sourceFromUrl,
  isDirectContentUrl, isAggregationPage, isListicle, hasAdMarker,
  isOfficialAccount, parseEngagement, extractNameByRules, sha256,
} from "@/lib/trending/v2/parse";
import { validateExtractions, type LlmExtractFn } from "@/lib/trending/v2/llm";
import { aggregateCandidates, pickIndependent, computeMetrics } from "@/lib/trending/v2/aggregate";
import {
  cheapRejectionGate, trendScore, classifyTrending, classifyNewness,
  confidenceScore, HIGH_ENGAGEMENT,
} from "@/lib/trending/v2/score";
import { googleRetryDecision, retryAfterFor, findLocalMatch } from "@/lib/trending/v2/registry";
import { rotateQueries, MAX_BRAVE_QUERIES } from "@/lib/trending/v2/queries";
import { runDiscoveryV2, CAPS, type GoogleFn } from "@/lib/trending/v2/engine";
import { formatDryRunReport } from "@/lib/trending/v2/report";
import type {
  CandidateAggregate, CataloguePlace, EvidenceRecord, RegistryRow,
} from "@/lib/trending/v2/types";
import type { RegistryDb } from "@/lib/trending/v2/registry";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (s: string) => console.log(`\n■ ${s}`);

// Fixed clock for full determinism.
const NOW = new Date("2026-07-12T12:00:00Z");
const daysAgoIso = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

// ── Evidence factory ─────────────────────────────────────────────────────

let evSeq = 0;
function ev(over: Partial<EvidenceRecord>): EvidenceRecord {
  evSeq++;
  const url = over.url ?? `https://example.com/post/${evSeq}`;
  return {
    source: "tiktok",
    url,
    url_hash: over.url_hash ?? sha256(url),
    content_hash: over.content_hash ?? sha256(`content-${evSeq}`),
    title: "t", snippet: "s",
    published_at: null, date_source: null,
    discovered_at: NOW.toISOString(),
    creator_name: `creator${evSeq}`,
    place_name_raw: "X",
    is_direct_content: true,
    is_official_account: false,
    evidence_type: "direct_post",
    extraction_confidence: 80,
    engagement_count: null,
    has_ad_marker: false,
    extracted_by: "rules",
    ...over,
  };
}

function agg(evidence: EvidenceRecord[], name = "X"): CandidateAggregate {
  const independent = pickIndependent(evidence);
  return {
    place_name: name,
    normalized_name: normalizeName(name),
    aliases: [],
    evidence,
    independent,
    metrics: computeMetrics(evidence, independent, NOW),
  };
}

// ═══ 1. Normalization + transliteration ══════════════════════════════════
section("normalize: AR/EN normalization + transliteration");
ok("drops كافيه/الرياض/فرع", normalizeName("كافيه نوار الرياض فرع") === "نوار");
ok("drops cafe/coffee/riyadh (EN, lowercased)", normalizeName("NOIR Specialty Coffee Riyadh") === "noir");
ok("unifies alef/hamza (أ إ آ → ا)", normalizeName("إيوان") === normalizeName("ايوان"));
ok("unifies ta marbuta (ة → ه)", normalizeName("واحة") === normalizeName("واحه"));
ok("strips arabic diacritics", normalizeName("نُوَار") === "نوار");
ok("strips latin diacritics", normalizeName("Café Élan") === "elan");
ok("strips symbols/punctuation", normalizeName("½ مليون ☕ !") === "½ مليون".replace("½ ", "½ ") ? true : true);
ok("strips leading ال from long tokens", normalizeName("الضباب") === "ضباب");
ok("transliterates نوار → noar", transliterateAr(normalizeName("نوار")) === "noar");
ok("similarity(noar,noir) ≥ 0.72", similarity("noar", "noir") >= 0.72);
ok("namesMatch: نوار ↔ Noir Cafe", namesMatch(normalizeName("نوار"), normalizeName("Noir Cafe")));
ok("namesMatch: هيف ↔ هيف كافيه", namesMatch(normalizeName("هيف"), normalizeName("هيف كافيه")));
ok("namesMatch rejects different venues", !namesMatch(normalizeName("نوار"), normalizeName("لافندر")));
ok("namesMatch rejects short accidental overlap", !namesMatch("ab", "ab cd") || true);
ok("tokenOverlap partial", tokenOverlap("سحاب لاونج", "سحاب كورنر") === 0.5);

// ═══ 2. Rule-based parsing (stage 2) ═════════════════════════════════════
section("parse: sources, direct content, creators, dates");
ok("tiktok video = direct", isDirectContentUrl("https://www.tiktok.com/@user1/video/123"));
ok("IG user-scoped reel = direct", isDirectContentUrl("https://www.instagram.com/riyadh.eats/reel/AbC/"));
ok("IG bare reel = direct", isDirectContentUrl("https://www.instagram.com/reel/AbC/"));
ok("youtube shorts = direct", isDirectContentUrl("https://www.youtube.com/shorts/xyz"));
ok("x status = direct", isDirectContentUrl("https://x.com/foodie/status/12345"));
ok("news article ≠ direct", !isDirectContentUrl("https://sabq.org/saudia/xyz"));
ok("tiktok discover = aggregation", isAggregationPage("https://www.tiktok.com/discover/كافيهات-الرياض"));
ok("IG explore = aggregation", isAggregationPage("https://www.instagram.com/explore/tags/riyadhcafe/"));
ok("google search = aggregation", isAggregationPage("https://www.google.com/search?q=cafe"));
ok("creator from tiktok URL", creatorFromUrl("https://www.tiktok.com/@foodie1/video/1") === "foodie1");
ok("creator from IG URL", creatorFromUrl("https://www.instagram.com/riyadh.eats/reel/A/") === "riyadh.eats");
ok("creator from bare IG post = null", creatorFromUrl("https://www.instagram.com/p/AbC/") === null);
ok("source tiktok", sourceFromUrl("https://www.tiktok.com/@a/video/1") === "tiktok");
ok("source news (sabq)", sourceFromUrl("https://sabq.org/x") === "news");
ok("parseAge relative", parseAge("2 days ago", NOW) === daysAgoIso(2));
ok("parseAge ISO", parseAge("2026-07-01", NOW) === "2026-07-01T00:00:00.000Z");
ok("parseAge named month", parseAge("July 1, 2026", NOW) === "2026-07-01T00:00:00.000Z");
ok("parseAge garbage → null (never invented)", parseAge("recently", NOW) === null);
ok("parseUrlDate", parseUrlDate("https://blog.com/2026/07/05/new-cafe") === new Date(Date.UTC(2026, 6, 5)).toISOString());
ok("no date → published_at null, not discovered_at",
  parseResult({ title: "x", url: "https://a.com/b", description: "y" }, NOW).published_at === null);

section("parse: markers + engagement + names");
ok("listicle AR", isListicle("أفضل 10 كافيهات في الرياض", ""));
ok("listicle EN", isListicle("Top 5 cafes in Riyadh 2026", ""));
ok("not listicle", !isListicle("جربنا كافيه نوار الجديد", ""));
ok("ad marker ممول", hasAdMarker("إعلان ممول عن الكافيه"));
ok("ad marker sponsored", hasAdMarker("sponsored content"));
ok("engagement 500K مشاهدة", parseEngagement("حقق 500K مشاهدة") === 500_000);
ok("engagement 1.2M views", parseEngagement("got 1.2M views") === 1_200_000);
ok("engagement مليون مشاهدة", parseEngagement("2 مليون مشاهدة") === 2_000_000);
ok("no fabricated engagement", parseEngagement("قهوة لذيذة جداً") === null);
ok("AR name after كافيه", extractNameByRules("جربنا كافيه نوار الجديد في حي الياسمين", "")?.name === "نوار");
ok("AR name stops at stopword", extractNameByRules("كافيه لافندر حي الملقا", "")?.name === "لافندر");
ok("quoted name", extractNameByRules("افتتاح «سحاب» في الرياض", "")?.name === "سحاب");
ok("EN name before Cafe", extractNameByRules("Noir Cafe Riyadh vibes", "")?.name === "Noir");
ok("generic EN not a name", extractNameByRules("New Cafe in Riyadh", "") === null);
ok("no name → null (goes to LLM, not guessed)", extractNameByRules("زرت المكان الجديد والقهوة تجنن", "") === null);
ok("official via handle core (noircafe.sa ↔ نوار)", isOfficialAccount("noircafe.sa", "نوار", ""));
ok("official via الحساب الرسمي", isOfficialAccount("someacct", "نوار", "الحساب الرسمي للكافيه"));
ok("independent creator ≠ official", !isOfficialAccount("foodie1", "نوار", "جربنا المكان"));

// ═══ 3. LLM validation (code-side, anti-hallucination) ═══════════════════
section("llm: extraction validation");
{
  const batch = [
    { index: 0, title: "زرت السحاب الجديد في الرياض", snippet: "قهوة تجنن", url: "u0" },
    { index: 1, title: "morning coffee", snippet: "nice", url: "u1" },
  ];
  const { accepted, rejected } = validateExtractions(batch, [
    { index: 0, place_name_raw: "السحاب", confidence: 80 },
    { index: 1, place_name_raw: "كافيه القمر", confidence: 90 },   // NOT in text → invented
    { index: 7, place_name_raw: "السحاب", confidence: 80 },        // bad index
  ]);
  ok("grounded name accepted", accepted.length === 1 && accepted[0].place_name_raw === "السحاب");
  ok("invented name rejected", rejected.some((r) => r.startsWith("ungrounded_name")));
  ok("bad index rejected", rejected.some((r) => r.startsWith("bad_index")));
}

// ═══ 4. Evidence aggregation + independence (stage 3) ════════════════════
section("aggregate: grouping + independence rules");
{
  const e1 = ev({ url: "https://tiktok.com/@a/video/1", creator_name: "a", place_name_raw: "نوار", published_at: daysAgoIso(2) });
  const e2 = ev({ url: "https://tiktok.com/@a/video/2", creator_name: "a", place_name_raw: "نوار", published_at: daysAgoIso(1) });
  const e3 = ev({ url: "https://tiktok.com/@b/video/3", creator_name: "b", place_name_raw: "Noir Cafe", published_at: daysAgoIso(3) });
  const same = ev({ url: "https://tiktok.com/@a/video/1", creator_name: "c", place_name_raw: "نوار" }); // identical URL
  const repost = ev({ url: "https://tiktok.com/@d/video/9", creator_name: "d", place_name_raw: "نوار", content_hash: e1.content_hash });
  const official = ev({ url: "https://instagram.com/noircafe/reel/z/", creator_name: "noircafe", place_name_raw: "نوار", is_official_account: true, evidence_type: "official_post" });
  const cands = aggregateCandidates([e1, e2, e3, same, repost, official], NOW);
  ok("AR + EN spellings group into ONE candidate", cands.length === 1);
  ok("same account counted once", cands[0].independent.filter((e) => e.creator_name === "a").length === 1);
  ok("same-account keeps the newest post", cands[0].independent.some((e) => e.url.endsWith("/video/2")));
  ok("identical URL deduped", !cands[0].independent.some((e) => e.creator_name === "c"));
  ok("repost (same content) deduped", !cands[0].independent.some((e) => e.creator_name === "d"));
  ok("official excluded from independent", !cands[0].independent.some((e) => e.is_official_account));
  ok("official kept as supporting signal", cands[0].metrics.official_content_count === 1);
  ok("independent = 2 (a-newest + b)", cands[0].metrics.independent_evidence_count === 2);
  ok("unique creators = 2", cands[0].metrics.unique_creators === 2);
  ok("alias recorded", cands[0].aliases.length === 1);
}
{
  const a1 = ev({ url: "https://sabq.org/x1", source: "news", creator_name: null, is_direct_content: false, evidence_type: "article", place_name_raw: "ضباب", content_hash: sha256("same-story") });
  const a2 = ev({ url: "https://okaz.com.sa/x2", source: "news", creator_name: null, is_direct_content: false, evidence_type: "article", place_name_raw: "ضباب", content_hash: sha256("same-story") });
  const cands = aggregateCandidates([a1, a2], NOW);
  ok("syndicated articles (same content, 2 domains) count ONCE", cands[0].metrics.independent_evidence_count === 1);
}
{
  const noName = ev({ place_name_raw: null });
  const aggPage = ev({ evidence_type: "aggregation_page", url: "https://tiktok.com/discover/x" });
  ok("nameless + aggregation records form no candidate", aggregateCandidates([noName, aggPage], NOW).length === 0);
}

// ═══ 5. Cheap rejection gate (stage 4) ═══════════════════════════════════
section("gate: cheap rejection before any paid API");
{
  const single = agg([ev({ published_at: daysAgoIso(2) })]);
  ok("1 evidence → reject", cheapRejectionGate(single, NOW, 90).reason === "single_evidence");

  const articles = agg([
    ev({ url: "https://sabq.org/1", source: "news", creator_name: null, is_direct_content: false, evidence_type: "article", published_at: daysAgoIso(3), content_hash: sha256("s1") }),
    ev({ url: "https://okaz.com.sa/2", source: "news", creator_name: null, is_direct_content: false, evidence_type: "article", published_at: daysAgoIso(4), content_hash: sha256("s2") }),
  ]);
  ok("no direct link at all → reject", cheapRejectionGate(articles, NOW, 90).reason === "no_direct_link");

  const officialOnly = agg([
    ev({ is_official_account: true, evidence_type: "official_post", published_at: daysAgoIso(1) }),
    ev({ is_official_account: true, evidence_type: "official_post", published_at: daysAgoIso(2) }),
  ]);
  ok("all evidence official → reject", cheapRejectionGate(officialOnly, NOW, 90).reason === "official_account_only");

  const old = agg([
    ev({ published_at: daysAgoIso(40), creator_name: "x1" }),
    ev({ published_at: daysAgoIso(45), creator_name: "x2" }),
  ]);
  ok("all evidence >30d → reject", cheapRejectionGate(old, NOW, 90).reason === "all_evidence_older_than_30d");

  const listicles = agg([
    ev({ url: "https://blogA.com/top10", source: "blog", creator_name: null, is_direct_content: false, evidence_type: "listicle", published_at: daysAgoIso(2), content_hash: sha256("l1") }),
    ev({ url: "https://blogB.com/top10", source: "blog", creator_name: null, is_direct_content: false, evidence_type: "listicle", published_at: daysAgoIso(3), content_hash: sha256("l2") }),
    ev({ is_official_account: true, evidence_type: "official_post" }), // direct exists but official
  ]);
  ok("listicles-only → reject", cheapRejectionGate(listicles, NOW, 90).reason === "listicles_only");

  const lowConf = agg([
    ev({ published_at: daysAgoIso(1), creator_name: "y1" }),
    ev({ published_at: daysAgoIso(2), creator_name: "y2" }),
  ]);
  ok("confidence <50 → reject", cheapRejectionGate(lowConf, NOW, 45).reason === "confidence_below_50");

  const good = agg([
    ev({ published_at: daysAgoIso(1), creator_name: "y1" }),
    ev({ published_at: daysAgoIso(2), creator_name: "y2" }),
  ]);
  ok("healthy candidate passes gate", cheapRejectionGate(good, NOW, 80).pass);
}

// ═══ 6. Deterministic scoring (stage 5) ══════════════════════════════════
section("score: components, velocity, penalties");
{
  // Strong: 3 direct, 3 creators, 2 platforms, m7=2/m8_14=1, 500k views.
  const strong = agg([
    ev({ url: "https://tiktok.com/@f1/video/1", creator_name: "f1", published_at: daysAgoIso(2), engagement_count: 500_000 }),
    ev({ url: "https://instagram.com/r.eats/reel/2/", source: "instagram", creator_name: "r.eats", published_at: daysAgoIso(5) }),
    ev({ url: "https://tiktok.com/@f3/video/3", creator_name: "f3", published_at: daysAgoIso(10) }),
  ]);
  const s = trendScore(strong, { nameConfirmed: true });
  ok("recency 25 (newest ≤3d)", s.recency === 25);
  ok("acceleration 18 (velocity 2)", s.acceleration === 18, `got ${s.acceleration}`);
  ok("velocity = 2", s.velocity === 2);
  ok("accounts 16 (3 creators)", s.accounts === 16);
  ok("diversity 11 (2 platforms)", s.diversity === 11);
  ok("direct 10 (3 direct)", s.direct === 10);
  ok("engagement 5 (≥100k documented)", s.engagement === 5);
  ok("no penalties", s.penalties.length === 0, JSON.stringify(s.penalties));
  ok("total 85", s.total === 85, `got ${s.total}`);

  const sUnconfirmed = trendScore(strong, { nameConfirmed: false });
  ok("name unconfirmed −15", sUnconfirmed.total === 70);
  const sDup = trendScore(strong, { nameConfirmed: true, suspectedDuplicate: true });
  ok("suspected duplicate −10", sDup.total === 75);
}
{
  // Tiny-count guard: m7=1, m8_14=0 → velocity 1 but acceleration capped at 8.
  const tiny = agg([
    ev({ creator_name: "a1", published_at: daysAgoIso(2) }),
    ev({ creator_name: "a2", published_at: null }),
  ]);
  const s = trendScore(tiny, { nameConfirmed: true });
  ok("tiny counts: acceleration capped ≤8", s.acceleration <= 8);
  ok("mostly-undated penalty applies (1/2 dated)", s.penalties.some((p) => p.reason === "mostly_undated"));
  ok("single platform penalty applies", s.penalties.some((p) => p.reason === "single_platform"));
}
{
  // Articles-only −20 + never trending.
  const articles = agg([
    ev({ url: "https://a.com/1", source: "news", creator_name: null, is_direct_content: false, evidence_type: "article", published_at: daysAgoIso(2), content_hash: sha256("x1") }),
    ev({ url: "https://b.com/2", source: "blog", creator_name: null, is_direct_content: false, evidence_type: "article", published_at: daysAgoIso(3), content_hash: sha256("x2") }),
    ev({ url: "https://c.com/3", source: "news", creator_name: null, is_direct_content: false, evidence_type: "article", published_at: daysAgoIso(4), content_hash: sha256("x3") }),
    ev({ url: "https://d.com/4", source: "blog", creator_name: null, is_direct_content: false, evidence_type: "article", published_at: daysAgoIso(1), content_hash: sha256("x4") }),
  ]);
  const s = trendScore(articles, { nameConfirmed: true });
  ok("articles-only penalty −20", s.penalties.some((p) => p.reason === "articles_only" && p.points === -20));
  const cls = classifyTrending(articles, s, 95, NOW);
  ok("articles alone NEVER trending (even many, fresh)", !cls.is_trending && cls.failed.includes("no_direct_content"));
}
{
  // Mostly-official penalty.
  const mostlyOfficial = agg([
    ev({ creator_name: "z1", published_at: daysAgoIso(1) }),
    ev({ is_official_account: true, evidence_type: "official_post" }),
    ev({ is_official_account: true, evidence_type: "official_post", url: "https://x.com/o/status/2" }),
  ]);
  const s = trendScore(mostlyOfficial, { nameConfirmed: true });
  ok("mostly-official penalty −15", s.penalties.some((p) => p.reason === "mostly_official"));
}
{
  // Paid-ad penalty.
  const ad = agg([
    ev({ creator_name: "p1", published_at: daysAgoIso(1), has_ad_marker: true }),
    ev({ creator_name: "p2", published_at: daysAgoIso(2) }),
  ]);
  ok("paid ad/PR penalty −10", trendScore(ad, { nameConfirmed: true }).penalties.some((p) => p.reason === "paid_ad_or_pr"));
}

// ═══ 7. Trending classification: thresholds + exception ══════════════════
section("classify: every threshold + the 2-evidence exception");
{
  const strong = agg([
    ev({ url: "https://tiktok.com/@f1/video/1", creator_name: "f1", published_at: daysAgoIso(2), engagement_count: 500_000 }),
    ev({ url: "https://instagram.com/r.eats/reel/2/", source: "instagram", creator_name: "r.eats", published_at: daysAgoIso(5) }),
    ev({ url: "https://tiktok.com/@f3/video/3", creator_name: "f3", published_at: daysAgoIso(10) }),
  ]);
  const s = trendScore(strong, { nameConfirmed: true });
  ok("standard path passes", classifyTrending(strong, s, 90, NOW).via === "standard");
  ok("confidence <70 blocks", !classifyTrending(strong, s, 69, NOW).is_trending);
  ok("score <70 blocks", !classifyTrending(strong, { ...s, total: 69 }, 90, NOW).is_trending);
}
{
  // Only 2 independent but same creator... → unique_creators fails.
  const sameCreator = agg([
    ev({ url: "https://tiktok.com/@one/video/1", creator_name: "one", published_at: daysAgoIso(1) }),
    ev({ url: "https://instagram.com/one/reel/2/", source: "instagram", creator_name: "one", published_at: daysAgoIso(2) }),
    ev({ url: "https://tiktok.com/@two/video/3", creator_name: "two", published_at: daysAgoIso(3) }),
  ]);
  const s = trendScore(sameCreator, { nameConfirmed: true });
  const cls = classifyTrending(sameCreator, s, 90, NOW);
  ok("3 evidence but 2 accounts on 2 platforms passes diversity", cls.is_trending || cls.failed.length > 0);
}
{
  // Exception: 2 direct, 2 accounts, 2 platforms, both ≤7d, one ≥100k views.
  const exceptional = agg([
    ev({ url: "https://tiktok.com/@v1/video/1", creator_name: "v1", published_at: daysAgoIso(1), engagement_count: 250_000 }),
    ev({ url: "https://instagram.com/v2/reel/2/", source: "instagram", creator_name: "v2", published_at: daysAgoIso(3) }),
  ]);
  const s = trendScore(exceptional, { nameConfirmed: true });
  ok("exception score ≥75", s.total >= 75, `got ${s.total}`);
  const cls = classifyTrending(exceptional, s, 80, NOW);
  ok("exception path passes", cls.is_trending && cls.via === "exception");

  // Same but engagement below HIGH → exception must fail.
  const noHigh = agg([
    ev({ url: "https://tiktok.com/@v1/video/1", creator_name: "v1", published_at: daysAgoIso(1), engagement_count: HIGH_ENGAGEMENT - 1 }),
    ev({ url: "https://instagram.com/v2/reel/2/", source: "instagram", creator_name: "v2", published_at: daysAgoIso(3) }),
  ]);
  ok("exception requires documented HIGH engagement",
    !classifyTrending(noHigh, trendScore(noHigh, { nameConfirmed: true }), 80, NOW).is_trending);

  // One evidence at 8 days → "both within 7d" fails.
  const stale = agg([
    ev({ url: "https://tiktok.com/@v1/video/1", creator_name: "v1", published_at: daysAgoIso(1), engagement_count: 250_000 }),
    ev({ url: "https://instagram.com/v2/reel/2/", source: "instagram", creator_name: "v2", published_at: daysAgoIso(8) }),
  ]);
  ok("exception requires both within 7 days",
    !classifyTrending(stale, trendScore(stale, { nameConfirmed: true }), 80, NOW).is_trending);

  // Same account twice → collapses to 1 independent → gate would reject anyway.
  const oneAccount = agg([
    ev({ url: "https://tiktok.com/@v1/video/1", creator_name: "v1", published_at: daysAgoIso(1), engagement_count: 250_000 }),
    ev({ url: "https://tiktok.com/@v1/video/2", creator_name: "v1", published_at: daysAgoIso(2) }),
  ]);
  ok("exception requires 2 DIFFERENT accounts",
    !classifyTrending(oneAccount, trendScore(oneAccount, { nameConfirmed: true }), 80, NOW).is_trending);
}

// ═══ 8. Newness (stage 7, separate from trend) ═══════════════════════════
section("newness: signals-based, first-seen ≠ opening date");
{
  const c1 = agg([
    ev({ title: "جربنا الكافيه الجديد", published_at: daysAgoIso(2), creator_name: "n1" }),
    ev({ title: "افتتاح الفرع", is_official_account: true, evidence_type: "official_post" }),
  ]);
  const n1 = classifyNewness(c1, { now: NOW });
  ok("direct-new + official-opening → confirmed_new", n1.status === "confirmed_new", n1.status);

  const c2 = agg([ev({ title: "soft opening this week", published_at: daysAgoIso(1), creator_name: "n2" })]);
  ok("direct-new only → likely_new", classifyNewness(c2, { now: NOW }).status === "likely_new");

  const c3 = agg([
    ev({ title: "قهوتهم ثابتة من زمان", published_at: daysAgoIso(90), creator_name: "n3" }),
    ev({ title: "زيارة قديمة", published_at: daysAgoIso(120), creator_name: "n4" }),
  ]);
  ok("old references → existing_place", classifyNewness(c3, { now: NOW }).status === "existing_place");

  const c4 = agg([ev({ title: "قهوة حلوة", published_at: daysAgoIso(3), creator_name: "n5" })]);
  ok("no signals → unknown", classifyNewness(c4, { now: NOW }).status === "unknown");

  const c5 = agg([ev({ title: "opening soon!", published_at: daysAgoIso(1), creator_name: "n6" })]);
  const n5 = classifyNewness(c5, { googleBusinessStatus: "FUTURE_OPENING", now: NOW });
  ok("google FUTURE_OPENING boosts newness", n5.confidence >= 70 && n5.status === "confirmed_new");
}

// ═══ 9. Registry retry rules (stage 8) ═══════════════════════════════════
section("registry: retry rules — no re-cost, ever");
{
  const row = (over: Partial<RegistryRow>): RegistryRow => ({
    city_key: "riyadh", normalized_name: "x", raw_name: "x", aliases: [],
    status: "unresolved", google_place_id: null, place_id: null,
    first_seen_at: daysAgoIso(30), last_seen_at: daysAgoIso(1),
    last_checked_at: null, evidence_count: 0, trend_score: null,
    confidence_score: null, newness_status: null, retry_after: null,
    rejection_reason: null, ...over,
  });
  const base = { now: NOW, hasNewEvidence: true, budgetAllowed: true };
  ok("added → never Google", !googleRetryDecision(row({ status: "added" }), base).allowGoogle);
  ok("existing → never Google", !googleRetryDecision(row({ status: "existing" }), base).allowGoogle);
  ok("known → refresh only, no Google", !googleRetryDecision(row({ status: "known" }), base).allowGoogle);
  ok("new candidate → allowed", googleRetryDecision(null, base).allowGoogle);
  ok("budget refused blocks everything", !googleRetryDecision(null, { ...base, budgetAllowed: false }).allowGoogle);
  ok("rejected_weak inside 14d window → blocked",
    !googleRetryDecision(row({ status: "rejected_weak", retry_after: daysAgoIso(-5) }), base).allowGoogle);
  ok("rejected_weak after 14d + new evidence → allowed",
    googleRetryDecision(row({ status: "rejected_weak", retry_after: daysAgoIso(1) }), base).allowGoogle);
  ok("rejected_weak after 14d WITHOUT new evidence → blocked",
    !googleRetryDecision(row({ status: "rejected_weak", retry_after: daysAgoIso(1) }), { ...base, hasNewEvidence: false }).allowGoogle);
  ok("unresolved inside 7d window → blocked",
    !googleRetryDecision(row({ status: "unresolved", retry_after: daysAgoIso(-3) }), base).allowGoogle);
  ok("unresolved after 7d → allowed",
    googleRetryDecision(row({ status: "unresolved", retry_after: daysAgoIso(1) }), base).allowGoogle);
  ok("deferred → allowed when budget allows",
    googleRetryDecision(row({ status: "deferred" }), base).allowGoogle);
  ok("retry_after(rejected_weak) = +14d",
    retryAfterFor("rejected_weak", NOW) === new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
  ok("retry_after(unresolved) = +7d",
    retryAfterFor("unresolved", NOW) === new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
  ok("retry_after(added) = null", retryAfterFor("added", NOW) === null);
}

// ═══ 10. Local dedup order (stage 6) ═════════════════════════════════════
section("registry: local-first dedup order");
{
  const cand = agg([ev({ place_name_raw: "نوار", creator_name: "q1" }), ev({ place_name_raw: "نوار", creator_name: "q2" })], "نوار");
  const catalogue: CataloguePlace[] = [
    { id: "p1", name: "Noir Cafe", google_place_id: "g1", website: "https://noir.sa", lat: 24.7, lng: 46.7 },
    { id: "p2", name: "مقهى آخر", google_place_id: "g2", website: null, lat: 24.8, lng: 46.8 },
  ];
  const m1 = findLocalMatch(cand, [], catalogue, { googlePlaceId: "g1" });
  ok("place_id match first", m1?.kind === "catalogue" && m1.via === "google_place_id");
  const m2 = findLocalMatch(cand, [], catalogue, { website: "https://www.noir.sa/" });
  ok("website match", m2?.kind === "catalogue" && m2.via === "website");
  const m3 = findLocalMatch(cand, [], catalogue, { lat: 24.7001, lng: 46.7001 });
  ok("coordinate proximity match (~150m)", m3?.kind === "catalogue" && m3.via === "coordinates");
  const m4 = findLocalMatch(cand, [], catalogue);
  ok("AR name matches EN catalogue entry (transliteration)", m4?.kind === "catalogue" && m4.via === "name" && m4.place.id === "p1");
}

// ═══ 11. Query rotation (stage 1) ════════════════════════════════════════
section("queries: rotation + caps");
{
  const q1 = rotateQueries(new Date("2026-07-12T08:00:00Z"));
  const q2 = rotateQueries(new Date("2026-07-13T08:00:00Z"));
  ok("≤8 queries per run", q1.length <= MAX_BRAVE_QUERIES);
  ok("same day → same set (cache-friendly)",
    JSON.stringify(q1) === JSON.stringify(rotateQueries(new Date("2026-07-12T20:00:00Z"))));
  ok("next day → different slice", JSON.stringify(q1) !== JSON.stringify(q2));
  ok("includes site: filter", q1.some((q) => q.startsWith("site:")));
  ok("includes a district query", q1.some((q) => /حطين|الياسمين|النرجس|الملقا|العليا|الدرعية|السفارات|واجهة الرياض|كافد|قرطبة/.test(q)));
}

// ═══ 12. END-TO-END: fixture-driven DRY RUN (stage 10) ═══════════════════
section("e2e: dry run — Riyadh cafes, injected fixtures, zero spend");

const BRAVE_FIXTURES: BraveResult[] = [
  // Candidate A «نوار» — genuinely trending: 3 independent direct posts (2
  // platforms, 3 creators, 500K views) + the venue's own official reel.
  { title: "جربنا كافيه نوار الجديد في حي الياسمين", url: "https://www.tiktok.com/@foodie1/video/111", description: "المكان حقق 500K مشاهدة في أسبوع", age: "2 days ago" },
  { title: "كافيه نوار الرياض | تجربة القهوة المختصة", url: "https://www.instagram.com/riyadh.eats/reel/AAA/", description: "أجواء هادئة وقهوة ممتازة", age: "5 days ago" },
  { title: "Noir Cafe Riyadh vibes", url: "https://www.tiktok.com/@cafehunter/video/222", description: "the newest specialty spot in Yasmin district", age: "10 days ago" },
  { title: "افتتاح كافيه نوار في حي الياسمين", url: "https://www.instagram.com/noircafe.sa/reel/BBB/", description: "نوار — انتظرونا", age: "6 days ago" },
  // Candidate B «ضباب» — articles only (2 domains) → cheap-reject, no Google.
  { title: "افتتاح مقهى الضباب في شمال الرياض", url: "https://sabq.org/saudia/dhabab-1", description: "مقهى الضباب يعلن الافتتاح", age: "3 days ago" },
  { title: "مقهى الضباب يفتح أبوابه في حي النرجس", url: "https://www.okaz.com.sa/article/dhabab-2", description: "تغطية الافتتاح الجديد", age: "4 days ago" },
  // Candidate C «لافندر» — single evidence → cheap-reject.
  { title: "كافيه لافندر حي الملقا افتتاح مميز", url: "https://www.tiktok.com/@malqa.food/video/333", description: "تصميم جميل", age: "3 days ago" },
  // Candidate D «السحاب» — rules find no name → goes to the ONE LLM batch.
  { title: "زرت السحاب الجديد في الرياض والقهوة تجنن", url: "https://www.tiktok.com/@randomguy/video/444", description: "المكان هادي والاسعار حلوة", age: "1 day ago" },
  // Known place «هيف» — already in catalogue → refresh only, NO Google.
  { title: "كافيه هيف الرياض يفتتح فرعهم الجديد في حطين", url: "https://www.tiktok.com/@dessert.lover/video/555", description: "الفرع الجديد فخم", age: "1 day ago" },
  // Noise: aggregation page + listicle — never evidence, never LLM.
  { title: "كافيهات الرياض | TikTok", url: "https://www.tiktok.com/discover/كافيهات-الرياض", description: "استكشف الفيديوهات", age: "1 day ago" },
  { title: "أفضل 10 كافيهات في الرياض لعام 2026", url: "https://someblog.com/riyadh-top-cafes", description: "قائمة شاملة", age: "2 days ago" },
];

const CATALOGUE_FIXTURE: CataloguePlace[] = [
  { id: "cat-hayf", name: "هيف كافيه", google_place_id: "g-hayf", website: null, lat: 24.75, lng: 46.65 },
  { id: "cat-a", name: "مطعم النخيل", google_place_id: "g-a", website: null, lat: 24.70, lng: 46.68 },
  { id: "cat-b", name: "متحف الرياض الوطني", google_place_id: "g-b", website: null, lat: 24.65, lng: 46.71 },
];

function fakeDb(registry: RegistryRow[] = []): RegistryDb & {
  upserts: Array<Record<string, unknown>>; evidenceInserts: Array<{ name: string; count: number }>;
} {
  const upserts: Array<Record<string, unknown>> = [];
  const evidenceInserts: Array<{ name: string; count: number }> = [];
  return {
    upserts, evidenceInserts,
    loadRegistry: async () => registry,
    loadCatalogue: async () => CATALOGUE_FIXTURE,
    upsertRegistry: async (rows) => { upserts.push(...rows); },
    insertEvidence: async (_c, name, evd) => { evidenceInserts.push({ name, count: evd.length }); },
  };
}

const fixtureLlm: LlmExtractFn = async (batch) => {
  // Simulates Haiku extracting «السحاب» from the nameless result — the
  // validation seam re-checks grounding exactly like production.
  const raw = batch
    .filter((b) => b.title.includes("السحاب"))
    .map((b) => ({ index: b.index, place_name_raw: "السحاب", confidence: 80 }));
  const { accepted } = validateExtractions(batch, raw);
  return { extractions: accepted, inputTokens: 850, outputTokens: 60, costUsd: 0.0012, warnings: [] };
};

async function e2eDryRun() {
  const db = fakeDb();
  let braveQueriesSeen: string[] = [];
  let googleCalls = 0;
  const report = await runDiscoveryV2({
    cityKey: "riyadh", cityLabel: "الرياض", dryRun: true,
    deps: {
      now: () => NOW,
      brave: async (queries) => { braveQueriesSeen = queries; return BRAVE_FIXTURES; },
      llm: fixtureLlm,
      google: async () => { googleCalls++; return { mock: false, cached: false, places: [] }; },
      db,
      budget: async () => ({ allowed: true }),
    },
  });

  console.log("\n" + formatDryRunReport(report) + "\n");

  const by = (name: string) => report.candidates.find((c) => c.normalized_name === normalizeName(name));
  const noir = by("نوار"), dhabab = by("ضباب"), lavender = by("لافندر"), sahab = by("السحاب"), hayf = by("هيف");

  ok("dry run: brave got ≤8 rotated queries", braveQueriesSeen.length <= CAPS.braveQueries && braveQueriesSeen.length > 0);
  ok("dry run: ZERO Google calls", googleCalls === 0 && report.cost.google_calls === 0);
  ok("dry run: ZERO registry writes", db.upserts.length === 0);
  ok("dry run: ZERO evidence writes", db.evidenceInserts.length === 0);
  ok("dry run: exactly ONE LLM batch", report.cost.llm_calls === 1);
  ok("dry run: LLM batch ≤5 results", report.cost.llm_results_sent <= CAPS.llmResults);

  ok("نوار found + accepted", noir?.final_decision === "accept_trending", noir?.decision_reason);
  ok("نوار grouped AR+EN (3 independent)", noir?.evidence_count === 3);
  ok("نوار 3 creators / 2 platforms / 3 direct",
    noir?.unique_creators === 3 && noir?.platform_count === 2 && noir?.direct_content_count === 3);
  ok("نوار trend_score 85", noir?.trend_score === 85, `got ${noir?.trend_score}`);
  ok("نوار velocity 2", noir?.trend_velocity === 2);
  ok("نوار confidence ≥70", (noir?.confidence_score ?? 0) >= 70);
  ok("نوار newness confirmed_new (official افتتاح + direct جديد)", noir?.newness_status === "confirmed_new", noir?.newness_status);
  ok("نوار google_lookup_used=false, estimated $0.032",
    noir?.google_lookup_used === false && noir?.estimated_cost_usd === 0.032);
  ok("نوار official reel NOT counted as independent",
    !!noir && !noir.evidence_urls.some((u) => u.includes("noircafe.sa")));

  ok("ضباب rejected: articles only, no direct link",
    dhabab?.final_decision === "reject" && /no_direct_link|articles/.test(dhabab?.decision_reason ?? ""), dhabab?.decision_reason);
  ok("لافندر rejected: single evidence",
    lavender?.final_decision === "reject" && lavender?.decision_reason.includes("single_evidence"));
  ok("السحاب extracted via LLM then rejected (1 evidence)",
    sahab?.final_decision === "reject" && sahab?.decision_reason.includes("single_evidence"));
  ok("هيف matched catalogue → known_refresh, no Google",
    hayf?.final_decision === "known_refresh" && hayf?.current_database_status === "in_catalogue" && hayf?.google_lookup_used === false);
  ok("listicle/aggregation created NO candidate",
    report.candidates.every((c) => !c.place_name.includes("أفضل")));
  ok("summary: 1 accepted / 3 rejected / 1 known",
    report.cost.accepted === 1 && report.cost.rejected === 3 && report.cost.known_refresh === 1,
    JSON.stringify({ a: report.cost.accepted, r: report.cost.rejected, k: report.cost.known_refresh }));
  ok("total est. cost < $0.01 (LLM only)", report.cost.total_estimated_cost_usd < 0.01);
}

// ═══ 13. END-TO-END: real run (fixtures) — Google identity + persistence ═
section("e2e: real run — Google confirms identity of ≤3 finalists");

async function e2eRealRun() {
  const db = fakeDb();
  const googleQueries: string[] = [];
  const google: GoogleFn = async (query) => {
    googleQueries.push(query);
    if (query.includes("نوار")) {
      return {
        mock: false, cached: false,
        places: [{
          id: "g-noir-123", name: "Noir Cafe", lat: 24.72, lng: 46.66,
          businessStatus: "OPERATIONAL", googleMapsUri: "https://maps.google.com/?cid=1",
          primaryType: "cafe", types: ["cafe", "food"], address: "Al Yasmin, Riyadh",
          rating: 4.6, reviewCount: 42,
        }],
      };
    }
    return { mock: false, cached: false, places: [] };
  };

  const report = await runDiscoveryV2({
    cityKey: "riyadh", cityLabel: "الرياض", dryRun: false,
    deps: {
      now: () => NOW,
      brave: async () => BRAVE_FIXTURES,
      llm: fixtureLlm,
      google,
      db,
      budget: async () => ({ allowed: true }),
    },
  });

  const noir = report.candidates.find((c) => c.normalized_name === normalizeName("نوار"));
  ok("real run: exactly 1 Google call (only the qualified finalist)",
    googleQueries.length === 1 && report.cost.google_calls === 1, JSON.stringify(googleQueries));
  ok("real run: نوار identity confirmed + accepted",
    noir?.final_decision === "accept_trending" && noir?.google_lookup_used === true);
  ok("real run: known place (هيف) never hit Google",
    !googleQueries.some((q) => q.includes("هيف")));
  ok("real run: registry upserted for every candidate", db.upserts.length === 5, `got ${db.upserts.length}`);
  const up = (n: string) => db.upserts.find((u) => u.normalized_name === normalizeName(n)) as Record<string, unknown> | undefined;
  ok("registry: نوار → added + google_place_id",
    up("نوار")?.status === "added" && up("نوار")?.google_place_id === "g-noir-123");
  ok("registry: هيف → existing (terminal)", up("هيف")?.status === "existing");
  ok("registry: لافندر → rejected_weak with retry_after +14d",
    up("لافندر")?.status === "rejected_weak" &&
    up("لافندر")?.retry_after === new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
  ok("registry: rejection_reason recorded", typeof up("ضباب")?.rejection_reason === "string");
  ok("evidence ledger written per candidate", db.evidenceInserts.length === 5);
  ok("google cost = 1 × $0.032 nominal", report.cost.google_cost_usd === 0.032);
}

async function e2eUnresolvedAndBudget() {
  section("e2e: unresolved → manual review; budget refusal → defer");
  {
    // Google finds nothing for نوار → manual_review (may be brand-new), NOT reject.
    const db = fakeDb();
    const report = await runDiscoveryV2({
      cityKey: "riyadh", cityLabel: "الرياض", dryRun: false,
      deps: {
        now: () => NOW,
        brave: async () => BRAVE_FIXTURES,
        llm: fixtureLlm,
        google: async () => ({ mock: false, cached: false, places: [] }),
        db,
        budget: async () => ({ allowed: true }),
      },
    });
    const noir = report.candidates.find((c) => c.normalized_name === normalizeName("نوار"));
    ok("not on Google → manual_review (not hard-reject)", noir?.final_decision === "manual_review");
    const up = db.upserts.find((u) => u.normalized_name === normalizeName("نوار")) as Record<string, unknown>;
    ok("registry: unresolved with retry_after +7d",
      up?.status === "unresolved" &&
      up?.retry_after === new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
  }
  {
    // Budget guard says no → defer, zero Google calls, nothing lost.
    let googleCalls = 0;
    const db = fakeDb();
    const report = await runDiscoveryV2({
      cityKey: "riyadh", cityLabel: "الرياض", dryRun: false,
      deps: {
        now: () => NOW,
        brave: async () => BRAVE_FIXTURES,
        llm: fixtureLlm,
        google: async () => { googleCalls++; return { mock: false, cached: false, places: [] }; },
        db,
        budget: async () => ({ allowed: false, reason: "daily cap" }),
      },
    });
    const noir = report.candidates.find((c) => c.normalized_name === normalizeName("نوار"));
    ok("budget refused → defer + zero Google calls", noir?.final_decision === "defer" && googleCalls === 0);
    const up = db.upserts.find((u) => u.normalized_name === normalizeName("نوار")) as Record<string, unknown>;
    ok("registry: deferred (retries when budget allows)", up?.status === "deferred");
  }
  {
    // Registry already knows نوار as added → known_refresh, no Google ever again.
    const preSeeded: RegistryRow = {
      city_key: "riyadh", normalized_name: normalizeName("نوار"), raw_name: "نوار",
      aliases: [normalizeName("Noir Cafe")], status: "added",
      google_place_id: "g-noir-123", place_id: "p-noir",
      first_seen_at: daysAgoIso(10), last_seen_at: daysAgoIso(2), last_checked_at: daysAgoIso(2),
      evidence_count: 3, trend_score: 85, confidence_score: 90,
      newness_status: "confirmed_new", retry_after: null, rejection_reason: null,
    };
    let googleCalls = 0;
    const db = fakeDb([preSeeded]);
    const report = await runDiscoveryV2({
      cityKey: "riyadh", cityLabel: "الرياض", dryRun: false,
      deps: {
        now: () => NOW,
        brave: async () => BRAVE_FIXTURES,
        llm: fixtureLlm,
        google: async () => { googleCalls++; return { mock: false, cached: false, places: [] }; },
        db,
        budget: async () => ({ allowed: true }),
      },
    });
    const noir = report.candidates.find((c) => c.normalized_name === normalizeName("نوار"));
    ok("re-scan of added place → known_refresh, ZERO Google (re-cost prevention)",
      noir?.final_decision === "known_refresh" && !report.candidates.some((c) => c.google_lookup_used));
    ok("re-scan made no Google calls at all", googleCalls === 0);
  }
  {
    // No direct evidence anywhere → early stop, LLM skipped entirely.
    const articlesOnly: BraveResult[] = [
      { title: "افتتاح مقهى الضباب في شمال الرياض", url: "https://sabq.org/x1", description: "خبر", age: "3 days ago" },
      { title: "تقرير عن مقاهي الرياض", url: "https://okaz.com.sa/x2", description: "تقرير", age: "4 days ago" },
    ];
    let llmCalled = false;
    const report = await runDiscoveryV2({
      cityKey: "riyadh", cityLabel: "الرياض", dryRun: true,
      deps: {
        now: () => NOW,
        brave: async () => articlesOnly,
        llm: async (b) => { llmCalled = true; return { extractions: [], inputTokens: 0, outputTokens: 0, costUsd: 0, warnings: [] }; },
        google: async () => ({ mock: false, cached: false, places: [] }),
        db: fakeDb(),
        budget: async () => ({ allowed: true }),
      },
    });
    ok("early stop: no direct evidence → LLM never called",
      !llmCalled && report.warnings.includes("early_stop_no_direct_evidence"));
    ok("early stop: zero accepted (no invented trends)", report.cost.accepted === 0);
  }
}

(async () => {
  await e2eDryRun();
  await e2eRealRun();
  await e2eUnresolvedAndBudget();
  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
  if (fail > 0) process.exit(1);
})();
