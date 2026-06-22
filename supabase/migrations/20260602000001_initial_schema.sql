-- ─────────────────────────────────────────────────────────────
-- Rihla — Initial schema (Phase 0 / 1)
-- All tables for users, trips, places, itinerary, budget, cache.
-- ─────────────────────────────────────────────────────────────

create extension if not exists "uuid-ossp";

-- ─── User profile (extends auth.users) ────────────────────────
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  default_currency text not null default 'SAR',
  default_persons int not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─── Trips ────────────────────────────────────────────────────
create table public.trips (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'رحلتي',
  destination_city text,
  start_date date,
  end_date date,
  travelers int not null default 2,
  budget_style text check (budget_style in ('economical','mid','luxury')) default 'mid',
  hotel_name text,
  hotel_lat double precision,
  hotel_lng double precision,
  hotel_place_id text,
  hotel_address text,
  rates jsonb not null default '{"SAR":1,"EUR":4.25,"USD":3.75,"GBP":4.85,"AED":1.02}'::jsonb,
  rates_updated date,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index trips_user_id_idx on public.trips(user_id);

-- ─── Trip preferences (categories user cares about) ──────────
create table public.trip_preferences (
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  weight numeric default 1.0,
  primary key (trip_id, category)
);

-- ─── Places (cached + seeded) ────────────────────────────────
-- A place may originate from Google Places (cached) or from seed data.
create table public.places (
  id uuid primary key default uuid_generate_v4(),
  google_place_id text unique,
  external_source text default 'seed', -- 'google' | 'seed' | 'user'
  name text not null,
  category text not null,        -- food | coffee | sight | nature | event | sweet | bar
  kind text,                     -- fine_dining | specialty | museum | etc.
  city text not null,
  city_label text,
  lat double precision,
  lng double precision,
  address text,
  phone text,
  website text,
  rating numeric,                -- Google rating (e.g. 4.6)
  review_count int,
  price_level int,               -- 1..4 (€)
  cost_estimate numeric,         -- in native currency
  cost_currency text default 'EUR',
  cost_confidence text default 'medium' check (cost_confidence in ('high','medium','low')),
  opening_hours jsonb,           -- 7-day array of strings, [] = closed that day
  open_status_cache text,        -- "open" | "shut" | "free" (refreshed periodically)
  photo_url text,
  photo_urls text[],
  google_maps_url text,
  tags text[],
  highlights text[],
  tip text,                      -- short curated note (Arabic)
  hidden_gem_score numeric,
  is_editor_pick boolean default false,
  data_freshness timestamptz default now(),
  created_at timestamptz not null default now()
);
create index places_city_idx on public.places(city);
create index places_category_idx on public.places(category);
create index places_google_id_idx on public.places(google_place_id);

-- ─── Place sources (cross-reference external IDs) ────────────
create table public.place_sources (
  place_id uuid not null references public.places(id) on delete cascade,
  source text not null,          -- 'google' | 'tripadvisor' | 'viator' | etc.
  external_id text not null,
  source_url text,
  primary key (place_id, source)
);

-- ─── User saved places (favorites) ───────────────────────────
create table public.user_saved_places (
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  saved_at timestamptz not null default now(),
  notes text,
  primary key (user_id, place_id)
);

-- ─── User place ratings (personal stars + verdict + tags) ────
create table public.user_place_ratings (
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  stars int check (stars between 1 and 5),
  verdict text check (verdict in ('love','meh','skip')),
  tags text[],                   -- e.g. ['p_high','romantic','sweets_great']
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, place_id)
);

-- ─── Itinerary (day + slot + place) ──────────────────────────
create table public.itinerary_days (
  id uuid primary key default uuid_generate_v4(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  day_date date not null,
  city text,
  notes text,
  created_at timestamptz not null default now(),
  unique (trip_id, day_date)
);

create table public.itinerary_items (
  id uuid primary key default uuid_generate_v4(),
  day_id uuid not null references public.itinerary_days(id) on delete cascade,
  place_id uuid not null references public.places(id) on delete cascade,
  slot text not null check (slot in ('morning','midday','afternoon','evening','night')),
  position int not null default 0, -- ordering within slot (0,1,2)
  user_note text,
  custom_cost_sar numeric,         -- user override
  transport_mode text,             -- 'walk' | 'drive' | 'taxi' | 'transit'
  created_at timestamptz not null default now()
);
create index itinerary_items_day_idx on public.itinerary_items(day_id);

-- ─── Budget assumptions (user-editable per trip) ─────────────
create table public.budget_assumptions (
  trip_id uuid primary key references public.trips(id) on delete cascade,
  flight_total_sar numeric default 0,
  hotel_per_night_sar numeric default 0,
  nights int default 0,
  transport_daily_sar numeric default 0,
  misc_daily_sar numeric default 0,
  confidence text default 'medium' check (confidence in ('high','medium','low')),
  notes text,
  updated_at timestamptz not null default now()
);

-- ─── API cache (Postgres-backed, avoids Redis dependency) ────
-- Keyed by hash of (operation + params). Stores JSON response.
create table public.api_cache (
  cache_key text primary key,
  operation text not null,       -- 'places_search' | 'place_details' | 'routes' | 'geocode'
  response jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index api_cache_expires_idx on public.api_cache(expires_at);

-- ─── AI cache (for future use; no AI in MVP) ─────────────────
create table public.ai_cache (
  cache_key text primary key,
  prompt_hash text not null,
  model text,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- ─── API usage log (cost control) ────────────────────────────
create table public.api_usage_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete set null,
  operation text not null,
  cache_hit boolean default false,
  created_at timestamptz not null default now()
);
create index api_usage_user_idx on public.api_usage_log(user_id, created_at desc);

-- ─── Auto-update timestamps ──────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();
create trigger user_profiles_touch before update on public.user_profiles
  for each row execute function public.touch_updated_at();
create trigger ratings_touch before update on public.user_place_ratings
  for each row execute function public.touch_updated_at();
create trigger budget_touch before update on public.budget_assumptions
  for each row execute function public.touch_updated_at();

-- ─── Auto-create user_profiles on signup ─────────────────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
