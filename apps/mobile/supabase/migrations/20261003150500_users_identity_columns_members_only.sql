-- Signed-out visitors (the bare anon key) can no longer read a member's
-- sexuality, gender or event_audience from public.users. Signed-in members
-- (authenticated, via the Better Auth -> Supabase JWT bridge) still can.
--
-- Before this migration (after 20261003150400, read 2026-10-03):
--   anon and authenticated both hold column SELECT on every users column
--   except the 13 private ones, so any holder of the anon key in an app
--   bundle could list every member's sexual orientation, gender and the
--   audience they want events with.
--
-- What reads these columns:
--   - The member's own row, signed in: welcome (native + web) and web
--     edit-profile read sexuality, event_audience; auth.getProfile reads
--     gender. Those run as authenticated.
--   - auth-sync and update-profile edge functions, as service_role.
--   - The CMS member sync, over a direct Postgres connection.
--   No view, policy or function references these columns (checked against
--   pg_rewrite, pg_policy and pg_proc on 2026-10-03), and public.users is in
--   no publication, so Realtime does not carry them either.
--
-- pronouns stays readable by anon: it is shown on the signed-out public
-- profile page as a display field the member sets for others to see.
--
-- Column privileges only. Row visibility (the policies) is unchanged.
-- Filtering or ordering on these columns as anon is a 42501 too.

begin;

revoke select (sexuality, gender, event_audience) on public.users from anon;
grant select (sexuality, gender, event_audience) on public.users to authenticated;

commit;
