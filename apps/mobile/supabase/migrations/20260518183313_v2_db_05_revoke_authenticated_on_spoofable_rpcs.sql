-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260518183313 :: v2_db_05_revoke_authenticated_on_spoofable_rpcs). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- V2-DB-05: close the spoofing hole. issue_rsvp_ticket and submit_verification_request
-- accept p_user_auth_id as a parameter; any authenticated user could spoof another user's
-- auth_id. Now wrapped by edge functions (rsvp-issue-ticket, submit-verification) that
-- derive the auth_id from the Better Auth session. Revoke authenticated EXECUTE so the
-- client cannot bypass the wrapper.
REVOKE EXECUTE ON FUNCTION public.issue_rsvp_ticket(integer, text) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_verification_request(text, text, text) FROM authenticated, PUBLIC;

-- Service role still has EXECUTE so the edge functions can call them.
GRANT EXECUTE ON FUNCTION public.issue_rsvp_ticket(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_verification_request(text, text, text) TO service_role;;
