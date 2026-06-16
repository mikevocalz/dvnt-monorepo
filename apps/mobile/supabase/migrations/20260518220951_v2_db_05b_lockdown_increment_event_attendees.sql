-- V2-DB-05b — lock down `increment_event_attendees(integer)` so only
-- service_role can call it. The client-side caller in
-- `lib/api/events.ts` was removed in commit 75152639 (it was a
-- redundant second increment alongside the
-- `trg_maintain_event_total_attendees` trigger on the tickets table,
-- causing silent double-counting on every free RSVP).
--
-- With no legitimate client caller, the function only needs to be
-- callable by:
--   - service_role (for any future admin / reconcile scripts run from
--     edge functions with the service role key)
--   - the table-owner role (postgres) implicitly for trigger contexts
--
-- Revoke EXECUTE from anon (already revoked earlier in V2-DB-03), from
-- authenticated, and from PUBLIC. Re-grant explicitly to service_role
-- so the cascade from PUBLIC doesn't accidentally also revoke from
-- service_role (which inherits PUBLIC).

REVOKE EXECUTE ON FUNCTION public.increment_event_attendees(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_event_attendees(integer) TO service_role;
