-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519030551 :: v2_db_05b_lockdown_increment_event_attendees). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- V2-DB-05b — lock down `increment_event_attendees(integer)` so only
-- service_role can call it. Client-side caller was removed in
-- commit 75152639 (it was a redundant second increment alongside
-- trg_maintain_event_total_attendees on the tickets table, causing
-- silent double-counting on every free RSVP).

REVOKE EXECUTE ON FUNCTION public.increment_event_attendees(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_event_attendees(integer) TO service_role;;
