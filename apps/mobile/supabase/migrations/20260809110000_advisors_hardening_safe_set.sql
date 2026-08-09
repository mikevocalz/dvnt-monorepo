-- ALREADY APPLIED interactively via MCP 2026-08-09 (see docs/advisors-hardening-plan.md).
-- Recorded here so the ledger reflects it; safe to re-run (idempotent-ish REVOKE/ALTER).
alter function public.set_membership_subs_updated_at() set search_path = public, pg_temp;
alter function public.is_valid_event_tz(text) set search_path = public, pg_temp;
revoke execute on function public.enforce_event_owner_write() from anon, authenticated;
revoke execute on function public.set_membership_subs_updated_at() from anon, authenticated;
revoke execute on function public.is_valid_event_tz(text) from anon, authenticated;
revoke execute on function public.recompute_event_total_attendees(integer) from anon, authenticated;
revoke execute on function public.viewer_can_see_nsfw(integer, integer) from anon, authenticated;
revoke execute on function public.enforce_event_owner_write() from public;
revoke execute on function public.set_membership_subs_updated_at() from public;
revoke execute on function public.is_valid_event_tz(text) from public;
revoke execute on function public.recompute_event_total_attendees(integer) from public;
revoke execute on function public.viewer_can_see_nsfw(integer, integer) from public;
