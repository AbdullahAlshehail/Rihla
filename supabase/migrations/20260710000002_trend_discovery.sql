-- ─────────────────────────────────────────────────────────────────────────
-- Trend DISCOVERY engine — schema for the discover→dedup→resolve→persist
-- pipeline (lib/trending/discover.ts).
--
-- ⚠️ APPLY BEFORE deploying the code that references these objects:
--    * PLACE_MAP_COLUMNS / PLACE_LIST_COLUMNS now select
--      `trending_first_seen_at` — map queries 400 until this column exists.
--
-- Append-only guarantees preserved: nothing here deletes or clears any
-- existing trend row. The backfill only FILLS a new column where NULL.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Recency model: WHEN did the engine first mark this place as trending?
--    * matcher refresh   → set once, never overwritten (first viral moment)
--    * discovery insert  → set at insert time (the place is new to us)
--    UI uses it for the «هذا الأسبوع / آخر أسبوعين» filter and the «جديد» badge.
alter table public.places
  add column if not exists trending_first_seen_at timestamptz;

-- Backfill: places that already have a trend score were first seen (at the
-- latest) when their score was last written. Fill-only — never overwrites.
update public.places
   set trending_first_seen_at = trending_updated_at
 where trending_first_seen_at is null
   and trending_score is not null
   and trending_updated_at is not null;

create index if not exists places_trending_first_seen_idx
  on public.places (trending_first_seen_at desc nulls last)
  where trending_first_seen_at is not null;

-- 2) Discovery seen-set — every venue NAME the discovery pipeline has ever
--    extracted, per city. Guarantees a name is resolved through Google at
--    most once ('added'/'existing' are terminal), so re-scans cost ~$0.
--
--    resolution:
--      'added'      → resolved via Google and INSERTed into places (terminal)
--      'existing'   → matched a place already in the catalogue (terminal)
--      'unresolved' → Google returned nothing usable (retryable after 30d)
--      'deferred'   → budget guard refused the call — no money spent
--                     (retryable on the next scan when budget allows)
create table if not exists public.trend_discovery_seen (
  id uuid primary key default gen_random_uuid(),
  city_key text not null,
  normalized_name text not null,
  raw_name text,
  google_place_id text,
  place_id uuid references public.places(id) on delete set null,
  resolution text not null
    check (resolution in ('added','existing','unresolved','deferred')),
  evidence_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (city_key, normalized_name)
);

create index if not exists trend_discovery_seen_city_idx
  on public.trend_discovery_seen (city_key, resolution);

-- Service-role only (admin pipeline). RLS on, NO policies → anon/authed get
-- nothing; the service-role writer bypasses RLS. Same pattern as the other
-- catalogue-write paths (security hardening 2026-07-10).
alter table public.trend_discovery_seen enable row level security;

comment on table public.trend_discovery_seen is
  'Trend-discovery dedup ledger: one row per (city, normalized venue name) the engine has seen. Terminal resolutions (added/existing) are never re-resolved through paid Google calls.';
comment on column public.places.trending_first_seen_at is
  'First time the trending engine marked this place as trending (matcher or discovery). Drives the recency filter + «جديد» badge. Set once; never cleared (append-only).';
