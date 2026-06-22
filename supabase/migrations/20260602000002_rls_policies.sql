-- ─────────────────────────────────────────────────────────────
-- Row-Level Security: every user only sees their own data.
-- Public tables (places, api_cache) are readable by all logged-in users.
-- ─────────────────────────────────────────────────────────────

-- Enable RLS on all user-scoped tables
alter table public.user_profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_preferences enable row level security;
alter table public.user_saved_places enable row level security;
alter table public.user_place_ratings enable row level security;
alter table public.itinerary_days enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.budget_assumptions enable row level security;
alter table public.api_usage_log enable row level security;

-- Public read tables (logged-in users can read; only service role writes)
alter table public.places enable row level security;
alter table public.place_sources enable row level security;
alter table public.api_cache enable row level security;
alter table public.ai_cache enable row level security;

-- ─── user_profiles: read+update own row ──────────────────────
create policy "profiles_select_own" on public.user_profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.user_profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.user_profiles
  for insert with check (auth.uid() = id);

-- ─── trips: full CRUD on own trips ───────────────────────────
create policy "trips_select_own" on public.trips
  for select using (auth.uid() = user_id);
create policy "trips_insert_own" on public.trips
  for insert with check (auth.uid() = user_id);
create policy "trips_update_own" on public.trips
  for update using (auth.uid() = user_id);
create policy "trips_delete_own" on public.trips
  for delete using (auth.uid() = user_id);

-- ─── trip_preferences: bound to trip ownership ───────────────
create policy "trip_prefs_all_own" on public.trip_preferences
  for all using (
    exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- ─── user_saved_places: own only ─────────────────────────────
create policy "saved_select_own" on public.user_saved_places
  for select using (auth.uid() = user_id);
create policy "saved_modify_own" on public.user_saved_places
  for all using (auth.uid() = user_id);

-- ─── user_place_ratings: own only ────────────────────────────
create policy "ratings_select_own" on public.user_place_ratings
  for select using (auth.uid() = user_id);
create policy "ratings_modify_own" on public.user_place_ratings
  for all using (auth.uid() = user_id);

-- ─── itinerary_days: via trip ownership ──────────────────────
create policy "days_all_own" on public.itinerary_days
  for all using (
    exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- ─── itinerary_items: via day → trip ownership ───────────────
create policy "items_all_own" on public.itinerary_items
  for all using (
    exists (
      select 1 from public.itinerary_days d
      join public.trips t on t.id = d.trip_id
      where d.id = day_id and t.user_id = auth.uid()
    )
  );

-- ─── budget_assumptions: via trip ownership ──────────────────
create policy "budget_all_own" on public.budget_assumptions
  for all using (
    exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- ─── api_usage_log: insert+select own ────────────────────────
create policy "usage_insert_own" on public.api_usage_log
  for insert with check (auth.uid() = user_id or user_id is null);
create policy "usage_select_own" on public.api_usage_log
  for select using (auth.uid() = user_id);

-- ─── places, place_sources, api_cache, ai_cache: read for all logged-in
create policy "places_read_all" on public.places
  for select using (auth.role() = 'authenticated');
create policy "place_sources_read_all" on public.place_sources
  for select using (auth.role() = 'authenticated');
create policy "api_cache_read_all" on public.api_cache
  for select using (auth.role() = 'authenticated');
create policy "ai_cache_read_all" on public.ai_cache
  for select using (auth.role() = 'authenticated');
-- NOTE: writes to these tables go through service-role key in API routes only.
