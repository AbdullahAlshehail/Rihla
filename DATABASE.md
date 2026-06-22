# Database schema reference

Files: `supabase/migrations/20260602000001_initial_schema.sql` and `*_002_rls_policies.sql`.

## Tables

| Table | Purpose |
|---|---|
| `user_profiles` | Extends `auth.users` with display name + preferences. Auto-created on signup. |
| `trips` | One row per trip. Owns destination, dates, hotel coords, rates snapshot, preferences. |
| `trip_preferences` | Many-to-one weighting of categories per trip (future use). |
| `places` | All places — seeded + Google-cached. Source = `seed` / `google` / `user`. |
| `place_sources` | Cross-references external IDs (Google, TripAdvisor, Viator). |
| `user_saved_places` | Per-user favorites. |
| `user_place_ratings` | Per-user star rating + verdict + tags + note. |
| `itinerary_days` | One row per day in a trip. |
| `itinerary_items` | Place placements in a day's slot (max 3 per slot enforced at API layer). |
| `budget_assumptions` | Per-trip flight/hotel/transport/misc + confidence. |
| `api_cache` | JSON responses from Google APIs, TTL per operation. |
| `ai_cache` | Reserved for future AI summarisation cache. |
| `api_usage_log` | Per-user call counts so we can monitor cost. |

## RLS

Every user-scoped table has RLS enabled. Policies allow read/write only when `auth.uid()` matches the row owner (directly or via trip ownership).

`places`, `place_sources`, `api_cache`, `ai_cache` are **read-only for all authenticated users**. Writes happen via the service-role key from server routes only.

## Auto-create profile on signup

A trigger on `auth.users` inserts a matching `user_profiles` row, so no separate signup flow is required.

## Updated-at triggers

`trips`, `user_profiles`, `user_place_ratings`, `budget_assumptions` all auto-update their `updated_at` column on UPDATE.

## How to add a column safely

Create a new migration file in `supabase/migrations/` named `YYYYMMDDhhmmss_descriptive.sql`. Never edit existing migrations — that breaks deployed environments.
