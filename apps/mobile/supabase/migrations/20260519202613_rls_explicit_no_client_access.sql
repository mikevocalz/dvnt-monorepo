-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519202613 :: rls_explicit_no_client_access). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- The advisor flagged both tables for having RLS enabled but no
-- policies. Adding an explicit "no client access" policy makes the
-- intent visible:
--   * service_role bypasses RLS, so edge functions still read/write.
--   * authenticated + anon get nothing from PostgREST.
-- This is what was previously implicit via the missing policy; we
-- just make it loud so the next reviewer doesn't think the policy
-- was forgotten.

-- video_room_kicks: also revokes the dead `authenticated` SELECT grant
-- that did nothing once RLS was on but suggested otherwise.
REVOKE SELECT ON public.video_room_kicks FROM authenticated;

CREATE POLICY video_room_kicks_no_client_access
  ON public.video_room_kicks
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY wallet_registrations_no_client_access
  ON public.wallet_registrations
  FOR ALL
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);;
