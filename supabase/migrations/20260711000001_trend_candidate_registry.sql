-- ─────────────────────────────────────────────────────────────────────────
-- Trend Discovery v2 — Candidate Registry (Stage 8 of the owner spec).
--
-- ⚠️ FILE ONLY — do NOT apply to prod without the owner's go-ahead.
--
-- Extends the existing dedup ledger `trend_discovery_seen` (migration
-- 20260710000002, applied to prod) into the full persistent registry the v2
-- engine needs, and adds an append-only evidence table with hash-based
-- duplicate prevention.
--
-- Append-only guarantees: ADDITIVE columns only; nothing here deletes,
-- clears, or rewrites any existing trend row. The old `resolution` column is
-- kept (the v2 writer keeps it coherent) so v1 code keeps working.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Registry columns on trend_discovery_seen ------------------------------

alter table public.trend_discovery_seen
  add column if not exists aliases jsonb not null default '[]'::jsonb,
  add column if not exists status text,
  add column if not exists last_checked_at timestamptz,
  add column if not exists evidence_count integer not null default 0,
  add column if not exists trend_score integer,
  add column if not exists confidence_score integer,
  add column if not exists newness_status text,
  add column if not exists retry_after timestamptz,
  add column if not exists rejection_reason text;

-- Backfill the new status from the legacy resolution (fill-only).
update public.trend_discovery_seen
   set status = resolution
 where status is null;

-- v2 status vocabulary (superset of v1 resolution):
--   added / existing      → terminal: NEVER re-cost Google
--   known                 → in registry, refresh evidence only, no Google
--   unresolved            → Google had no match; retry after 7 days
--   deferred              → budget refused; retry when budget allows
--   rejected_weak         → failed gate/thresholds; retry after 14 days
--                           ONLY if new evidence appeared
alter table public.trend_discovery_seen
  drop constraint if exists trend_discovery_seen_status_check;
alter table public.trend_discovery_seen
  add constraint trend_discovery_seen_status_check
  check (status in ('added','existing','known','unresolved','deferred','rejected_weak'));

alter table public.trend_discovery_seen
  drop constraint if exists trend_discovery_seen_newness_check;
alter table public.trend_discovery_seen
  add constraint trend_discovery_seen_newness_check
  check (newness_status is null
         or newness_status in ('confirmed_new','likely_new','existing_place','unknown'));

create index if not exists trend_discovery_seen_status_idx
  on public.trend_discovery_seen (city_key, status);
create index if not exists trend_discovery_seen_retry_idx
  on public.trend_discovery_seen (retry_after)
  where retry_after is not null;

comment on column public.trend_discovery_seen.status is
  'v2 registry status. added/existing/known never re-cost Google; unresolved retries after 7d; rejected_weak after 14d only with new evidence; deferred when budget allows.';
comment on column public.trend_discovery_seen.retry_after is
  'Earliest time a paid re-check is allowed. NULL for terminal statuses and for deferred (budget-gated instead).';

-- 2) Evidence ledger (append-only, hash-deduped) ---------------------------
-- One row per (candidate, evidence URL). url_hash prevents duplicate inserts
-- of the same URL; content_hash lets the engine detect reposts/syndication.

create table if not exists public.trend_candidate_evidence (
  id uuid primary key default gen_random_uuid(),
  city_key text not null,
  normalized_name text not null,
  url text not null,
  url_hash text not null,
  content_hash text,
  source text not null,
  title text,
  snippet text,
  -- Publish date parsed from the content/result itself. NULL when unknown —
  -- the engine NEVER substitutes discovered_at here.
  published_at timestamptz,
  date_source text check (date_source is null or date_source in ('url','explicit','brave_age')),
  discovered_at timestamptz not null default now(),
  creator_name text,
  place_name_raw text,
  is_direct_content boolean not null default false,
  is_official_account boolean not null default false,
  evidence_type text not null
    check (evidence_type in ('direct_post','article','listicle','official_post','aggregation_page')),
  extraction_confidence integer not null default 0,
  engagement_count bigint,
  extracted_by text not null default 'rules' check (extracted_by in ('rules','llm')),
  created_at timestamptz not null default now(),
  unique (city_key, normalized_name, url_hash)
);

create index if not exists trend_candidate_evidence_candidate_idx
  on public.trend_candidate_evidence (city_key, normalized_name, published_at desc nulls last);

-- Service-role only (admin pipeline): RLS on, NO policies → anon/authed get
-- nothing; the service-role writer bypasses RLS. Same pattern as
-- trend_discovery_seen (security hardening 2026-07-10).
alter table public.trend_candidate_evidence enable row level security;

comment on table public.trend_candidate_evidence is
  'Append-only evidence ledger for trend discovery v2. Hash-deduped on (city, candidate, url). Aggregation pages are never stored as proof.';
