-- ─────────────────────────────────────────────────────────────────────────
-- Security hardening — closes findings from the production-readiness audit.
-- All changes are hardening (removing over-permissive grants/policies) and are
-- reversible. Verified before writing that NO legitimate app flow depends on
-- the objects being dropped:
--   * every `places` write goes through the service-role writer client
--     (createWriteClient), which bypasses RLS — see lib/google/enrich.ts,
--     app/api/places/*  → so dropping the user INSERT/UPDATE policies is safe.
--   * nothing in the app deletes `checkins` (grep: no checkins.delete call).
--   * `place-photos` bucket is public=true and is only ever written via the
--     admin INSERT policy + read via public CDN URL → the broad authed SELECT
--     policy is unnecessary.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) GEOFENCE TRUST ANCHOR — any authenticated user could UPDATE/INSERT any
--    `places` row (incl. lat/lng), letting them move a place next to their
--    couch and defeat create_checkin()'s ≤150 m geofence, or vandalise the
--    shared catalogue. Catalogue writes are service-role only, so users need
--    SELECT only. Drop the two over-permissive policies.
drop policy if exists places_update_authed on public.places;
drop policy if exists places_insert_authed on public.places;

-- 2) POINTS FARMING LOOP — the checkins DELETE policy let a user delete their
--    own check-in and re-check-in unlimited times; both the 30-min cooldown
--    and is_first_visit are derived from `checkins`, while point_events /
--    user_points are never reversed → +8 pts + coins + mayor per loop.
--    Make check-ins append-only for users (function-inserted, never deleted).
drop policy if exists checkins_delete on public.checkins;

-- 3) SECURITY DEFINER function executable by anon — places_top_per_city runs
--    as definer and was callable by the anon role. Restrict to authenticated.
revoke execute on function public.places_top_per_city() from anon;

-- 4) Pin the trigger function's search_path (advisor: function_search_path_mutable).
--    Trigger only stamps updated_at = now(); 'public' is a safe pinned path.
alter function public.tg_user_places_status_updated_at() set search_path = public;

-- 5) Broad public SELECT on the public place-photos bucket lets any authed user
--    LIST every object. Public URL/CDN access does not need this policy; drop it.
drop policy if exists place_photos_select_public on storage.objects;

-- 6) RLS initplan optimisation (advisor: auth_rls_initplan) — wrap auth.uid()
--    in a scalar subselect so it evaluates once per query, not once per row.
drop policy if exists passport_own_rows_select on public.user_places_status;
create policy passport_own_rows_select on public.user_places_status
  for select using ((select auth.uid()) = user_id);

drop policy if exists passport_own_rows_insert on public.user_places_status;
create policy passport_own_rows_insert on public.user_places_status
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists passport_own_rows_update on public.user_places_status;
create policy passport_own_rows_update on public.user_places_status
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists passport_own_rows_delete on public.user_places_status;
create policy passport_own_rows_delete on public.user_places_status
  for delete using ((select auth.uid()) = user_id);
