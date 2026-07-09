-- ─────────────────────────────────────────────────────────────────────────
-- Social layer: check-ins (geofenced), friendships, presence, mayors,
-- points/coins, streaks. Additive-only. Every new table has RLS. The
-- anti-cheat backbone is server-side: check-ins can ONLY be created through
-- the SECURITY DEFINER `create_checkin()` function, which validates the
-- submitted GPS is within 150 m of the place — a direct PostgREST insert is
-- blocked by RLS (no INSERT policy on the table).
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Extend profiles with social identity (semi-public: name/avatar/handle).
alter table public.user_profiles
  add column if not exists username text unique,
  add column if not exists avatar_emoji text,
  add column if not exists home_city text,
  add column if not exists bio text;

-- ── Distance helper (metres) — Haversine in SQL. IMMUTABLE so the geofence
--    check is cheap and inlinable.
create or replace function public.geo_distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ── Friendship helper for RLS (SECURITY DEFINER avoids policy recursion).
--    True when an ACCEPTED friendship exists between the caller and `other`.
create or replace function public.is_friend(other uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and ((f.a = auth.uid() and f.b = other)
        or (f.b = auth.uid() and f.a = other))
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) friendships — one canonical row per pair (a < b) to dedupe.
create table if not exists public.friendships (
  a            uuid not null references auth.users(id) on delete cascade,
  b            uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (a, b),
  check (a < b)
);
alter table public.friendships enable row level security;

-- See friendships you are part of.
drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select using (auth.uid() = a or auth.uid() = b);
-- Writes go through functions only (send/respond) — no client insert/update.

-- ─────────────────────────────────────────────────────────────────────────
-- 3) checkins — geofenced presence. INSERT only via create_checkin().
create table if not exists public.checkins (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  place_id       uuid references public.places(id) on delete set null,
  lat            double precision,
  lng            double precision,
  rating         int check (rating is null or (rating between 1 and 5)),
  vibes          text[],
  shout          text,
  points_awarded int not null default 0,
  is_first_visit boolean not null default false,
  created_at     timestamptz not null default now()
);
alter table public.checkins enable row level security;

create index if not exists checkins_place_recent_idx
  on public.checkins (place_id, created_at desc);
create index if not exists checkins_user_idx
  on public.checkins (user_id, created_at desc);

-- Read own + friends' check-ins (drives presence, feed, mayor).
drop policy if exists checkins_select on public.checkins;
create policy checkins_select on public.checkins
  for select using (auth.uid() = user_id or public.is_friend(user_id));
-- Undo your own check-in.
drop policy if exists checkins_delete on public.checkins;
create policy checkins_delete on public.checkins
  for delete using (auth.uid() = user_id);
-- NO insert/update policy → direct inserts blocked; create_checkin() only.

-- ─────────────────────────────────────────────────────────────────────────
-- 4) points ledger + coin balance.
create table if not exists public.user_points (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  coins      int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.user_points enable row level security;
drop policy if exists user_points_select on public.user_points;
create policy user_points_select on public.user_points
  for select using (auth.uid() = user_id or public.is_friend(user_id));

create table if not exists public.point_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,
  points     int not null,
  checkin_id uuid references public.checkins(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.point_events enable row level security;
create index if not exists point_events_user_idx on public.point_events (user_id, created_at desc);
drop policy if exists point_events_select on public.point_events;
create policy point_events_select on public.point_events
  for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) streaks (daily activity).
create table if not exists public.user_streaks (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_active    date,
  freezes        int not null default 2,
  updated_at     timestamptz not null default now()
);
alter table public.user_streaks enable row level security;
drop policy if exists user_streaks_select on public.user_streaks;
create policy user_streaks_select on public.user_streaks
  for select using (auth.uid() = user_id or public.is_friend(user_id));

-- ─────────────────────────────────────────────────────────────────────────
-- 6) create_checkin() — THE anti-cheat gate. Validates GPS ≤ 150 m from the
--    place, computes points, updates coins + streak, inserts the row. Runs
--    as definer so it can write the RLS-locked tables; still scoped to the
--    authenticated caller (auth.uid()).
create or replace function public.create_checkin(
  p_place_id uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_rating   int default null,
  p_vibes    text[] default null,
  p_shout    text default null
) returns public.checkins
language plpgsql security definer set search_path = public as $$
declare
  uid        uuid := auth.uid();
  plat       double precision;
  plng       double precision;
  dist       double precision;
  first_v    boolean;
  pts        int := 5;                 -- base
  kept       boolean := false;
  today      date := (now() at time zone 'utc')::date;
  st         public.user_streaks%rowtype;
  new_row    public.checkins%rowtype;
begin
  if uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'location_required';
  end if;

  select lat, lng into plat, plng from public.places where id = p_place_id;
  if plat is null or plng is null then
    raise exception 'place_has_no_coordinates';
  end if;

  dist := public.geo_distance_m(p_lat, p_lng, plat, plng);
  if dist > 150 then
    raise exception 'too_far:%', round(dist)::text;  -- geofence gate
  end if;

  -- First visit ever to this place?
  select not exists (
    select 1 from public.checkins c where c.user_id = uid and c.place_id = p_place_id
  ) into first_v;

  -- Streak: did the caller act yesterday (or already today)?
  select * into st from public.user_streaks where user_id = uid;
  if st.user_id is null then
    insert into public.user_streaks (user_id, current_streak, longest_streak, last_active)
      values (uid, 1, 1, today)
      returning * into st;
    kept := true;
  elsif st.last_active = today then
    kept := false;                          -- already counted today
  elsif st.last_active = today - 1 then
    update public.user_streaks
      set current_streak = st.current_streak + 1,
          longest_streak = greatest(st.longest_streak, st.current_streak + 1),
          last_active = today, updated_at = now()
      where user_id = uid;
    kept := true;
  else
    update public.user_streaks
      set current_streak = 1, last_active = today, updated_at = now()
      where user_id = uid;
    kept := true;
  end if;

  -- Points model (README): base 5; +3 first; +2 rated; +2 shout; +1 vibes; +2 streak-keep
  if first_v then pts := pts + 3; end if;
  if p_rating is not null then pts := pts + 2; end if;
  if p_shout is not null and length(trim(p_shout)) > 0 then pts := pts + 2; end if;
  if p_vibes is not null and array_length(p_vibes, 1) > 0 then pts := pts + 1; end if;
  if kept then pts := pts + 2; end if;

  insert into public.checkins (user_id, place_id, lat, lng, rating, vibes, shout, points_awarded, is_first_visit)
    values (uid, p_place_id, p_lat, p_lng, p_rating, p_vibes, nullif(trim(coalesce(p_shout,'')), ''), pts, first_v)
    returning * into new_row;

  insert into public.point_events (user_id, kind, points, checkin_id)
    values (uid, 'checkin', pts, new_row.id);

  insert into public.user_points (user_id, coins, updated_at)
    values (uid, pts, now())
    on conflict (user_id) do update set coins = public.user_points.coins + pts, updated_at = now();

  return new_row;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Friend request functions (SECURITY DEFINER, caller-scoped).
create or replace function public.send_friend_request(to_user uuid)
returns public.friendships
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lo  uuid := least(uid, to_user);
  hi  uuid := greatest(uid, to_user);
  row public.friendships%rowtype;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if uid = to_user then raise exception 'cannot_friend_self'; end if;
  insert into public.friendships (a, b, requested_by, status)
    values (lo, hi, uid, 'pending')
    on conflict (a, b) do update
      set status = case when public.friendships.status = 'blocked'
                        then public.friendships.status else 'pending' end,
          updated_at = now()
    returning * into row;
  return row;
end;
$$;

create or replace function public.respond_friend_request(from_user uuid, accept boolean)
returns public.friendships
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lo  uuid := least(uid, from_user);
  hi  uuid := greatest(uid, from_user);
  row public.friendships%rowtype;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update public.friendships
    set status = case when accept then 'accepted' else 'blocked' end,
        updated_at = now()
    where a = lo and b = hi and requested_by = from_user
    returning * into row;
  if row.a is null then raise exception 'no_pending_request'; end if;
  return row;
end;
$$;

-- Lock down execution to authenticated users.
revoke all on function public.create_checkin(uuid,double precision,double precision,int,text[],text) from public;
grant execute on function public.create_checkin(uuid,double precision,double precision,int,text[],text) to authenticated;
revoke all on function public.send_friend_request(uuid) from public;
grant execute on function public.send_friend_request(uuid) to authenticated;
revoke all on function public.respond_friend_request(uuid,boolean) from public;
grant execute on function public.respond_friend_request(uuid,boolean) to authenticated;
