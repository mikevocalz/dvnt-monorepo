-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260614211906 :: lock_event_edit_aggregate_to_service_role). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- get_event_edit_aggregate is SECURITY DEFINER with no host check and isn't
-- wired into the app yet — but it was EXECUTE-able by any authenticated user,
-- who could read ANY event's full edit config (incl. private events). Lock it to
-- service_role (matching save_event_aggregate). When the edit UI is built it'll
-- call through an edge function (service_role) that enforces host ownership.
revoke execute on function public.get_event_edit_aggregate(bigint) from authenticated, public;
-- save_event_aggregate is already service_role-only; ensure no drift.
revoke execute on function public.save_event_aggregate(bigint, jsonb) from authenticated, anon, public;;
