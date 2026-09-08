-- Group voting / suggestions / anonymous comments on a trip, shared via an
-- unguessable token. Participants need NO account; ALL their reads/writes go
-- through token-validated server routes that use the service role.
--
-- Security model (Fable-designed, Option C, 2026-09-08):
--   * These tables carry ZERO anon/insert RLS policies (default-deny). Only the
--     trip owner can SELECT/DELETE via the authed client. The anon key can
--     therefore never write here directly — participant writes only exist
--     through /api/vote/[token] (service role, token-gated, trip_id derived
--     server-side from the token, never trusted from the client body).
--   * voter_id is a client-generated uuid kept in the visitor's localStorage.
--     It is non-PII, used only for de-dupe, and is NEVER serialised back out.
--   * Votes are ADVISORY: nothing here writes into itinerary_days/items. Votes
--     surface only as aggregate "hype" counts in the owner UI. The owner keeps
--     full control of the plan.

alter table public.trips add column if not exists share_token text unique;

-- One vote = "I want this stop". Unique per (trip, item, voter) blocks doubles.
create table if not exists public.trip_votes (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  itinerary_item_id uuid not null references public.itinerary_items(id) on delete cascade,
  voter_id uuid not null,
  created_at timestamptz not null default now(),
  unique (trip_id, itinerary_item_id, voter_id)
);
create index if not exists trip_votes_trip_idx on public.trip_votes(trip_id);

-- "Suggest an extra place" — free text; owner may add it to the plan manually.
create table if not exists public.trip_suggestions (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  voter_id uuid not null,
  name text not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists trip_suggestions_trip_idx on public.trip_suggestions(trip_id);

-- Anonymous comment wall. voter_id stored for spam caps only; never displayed.
create table if not exists public.trip_comments (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  voter_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists trip_comments_trip_idx on public.trip_comments(trip_id);

alter table public.trip_votes enable row level security;
alter table public.trip_suggestions enable row level security;
alter table public.trip_comments enable row level security;

-- Owner-only SELECT + DELETE. Deliberately NO insert/update policies → default
-- deny for anon; participant inserts happen only via the service-role route.
create policy "trip_votes_owner_select" on public.trip_votes for select
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
create policy "trip_votes_owner_delete" on public.trip_votes for delete
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

create policy "trip_suggestions_owner_select" on public.trip_suggestions for select
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
create policy "trip_suggestions_owner_delete" on public.trip_suggestions for delete
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

create policy "trip_comments_owner_select" on public.trip_comments for select
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
create policy "trip_comments_owner_delete" on public.trip_comments for delete
  using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));
