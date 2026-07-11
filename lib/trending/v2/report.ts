// Stage 10 — dry-run report formatting: one table row per candidate plus a
// cost summary. Pure string building (used by tests and the admin response).

import type { DiscoveryV2Report, CandidateReportRow } from "@/lib/trending/v2/types";

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "unknown";
}

export function formatCandidateRow(r: CandidateReportRow): string {
  return [
    `place_name:              ${r.place_name}`,
    `normalized_name:         ${r.normalized_name}`,
    `current_database_status: ${r.current_database_status}`,
    `newness_status:          ${r.newness_status}`,
    `trend_score:             ${r.trend_score}/100 (recency ${r.score.recency} + accel ${r.score.acceleration} + accounts ${r.score.accounts} + diversity ${r.score.diversity} + direct ${r.score.direct} + engagement ${r.score.engagement}${r.score.penalties.map((p) => ` ${p.points} ${p.reason}`).join("")})`,
    `confidence_score:        ${r.confidence_score}/100`,
    `trend_velocity:          ${r.trend_velocity}`,
    `evidence_count:          ${r.evidence_count} (independent)`,
    `unique_creators:         ${r.unique_creators}`,
    `platform_count:          ${r.platform_count}`,
    `direct_content_count:    ${r.direct_content_count}`,
    `published_dates:         ${r.published_dates.map(fmtDate).join(", ") || "—"}`,
    `evidence_urls:           ${r.evidence_urls.join(" | ") || "—"}`,
    `google_lookup_used:      ${r.google_lookup_used}`,
    `estimated_cost:          $${r.estimated_cost_usd.toFixed(3)}`,
    `final_decision:          ${r.final_decision}`,
    `decision_reason:         ${r.decision_reason}`,
  ].join("\n");
}

export function formatDryRunReport(report: DiscoveryV2Report): string {
  const head = `── Trend Discovery v2 — ${report.dryRun ? "DRY RUN" : "RUN"} · ${report.city} (${report.cityKey}) ──`;
  const rows = report.candidates.length === 0
    ? ["(no candidates — zero invented trends is a valid outcome)"]
    : report.candidates.map((r, i) => `[candidate ${i + 1}]\n${formatCandidateRow(r)}`);
  const c = report.cost;
  const summary = [
    "── cost summary ──",
    `brave_queries:     ${c.brave_queries} (free tier)`,
    `brave_results:     ${c.brave_results} (parsed ${c.results_parsed})`,
    `llm_calls:         ${c.llm_calls} (${c.llm_results_sent} results, ${c.llm_input_tokens} in / ${c.llm_output_tokens} out tokens, $${c.llm_cost_usd.toFixed(4)})`,
    `google_calls:      ${c.google_calls} ($${c.google_cost_usd.toFixed(3)} nominal, $0 inside free tier)`,
    `total_est_cost:    $${c.total_estimated_cost_usd.toFixed(4)}`,
    `decisions:         accepted ${c.accepted} · rejected ${c.rejected} · deferred ${c.deferred} · manual_review ${c.manual_review} · known_refresh ${c.known_refresh}`,
    ...(report.warnings.length ? [`warnings:          ${report.warnings.join("; ")}`] : []),
  ];
  return [head, ...rows, "", ...summary].join("\n\n").replace(/\n\n──/g, "\n──");
}
