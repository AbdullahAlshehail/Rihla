-- Passport feature: track countries the user has visited or wants to visit,
-- plus cities within each visited country. One row per (user, entity).
--
-- entity_type = 'country'  → entity_key = ISO 3166-1 alpha-2 (e.g. "FR")
-- entity_type = 'city'     → entity_key = "<COUNTRY>:<slug>"  (e.g. "FR:nice")
-- status      = 'visited' | 'wishlist'

create table if not exists user_places_status (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  entity_type   text not null check (entity_type in ('country', 'city')),
  entity_key    text not null,
  status        text not null check (status in ('visited', 'wishlist')),
  visited_year  int  check (visited_year is null or (visited_year between 1900 and 2100)),
  city_label    text,   -- Display label for cities (Arabic preferred)
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, entity_type, entity_key)
);

-- Fast lookups by user (loads the whole passport in one query).
create index if not exists user_places_status_user_idx
  on user_places_status (user_id);

-- Fast "which country does this city belong to" lookups.
create index if not exists user_places_status_country_prefix_idx
  on user_places_status (user_id, entity_key text_pattern_ops)
  where entity_type = 'city';

alter table user_places_status enable row level security;

-- Owner-only access: users can only see/modify their own rows.
drop policy if exists "passport_own_rows_select" on user_places_status;
create policy "passport_own_rows_select" on user_places_status
  for select using (auth.uid() = user_id);

drop policy if exists "passport_own_rows_insert" on user_places_status;
create policy "passport_own_rows_insert" on user_places_status
  for insert with check (auth.uid() = user_id);

drop policy if exists "passport_own_rows_update" on user_places_status;
create policy "passport_own_rows_update" on user_places_status
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "passport_own_rows_delete" on user_places_status;
create policy "passport_own_rows_delete" on user_places_status
  for delete using (auth.uid() = user_id);

-- Keep updated_at fresh on any change.
create or replace function tg_user_places_status_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists user_places_status_updated_at on user_places_status;
create trigger user_places_status_updated_at
  before update on user_places_status
  for each row execute function tg_user_places_status_updated_at();
