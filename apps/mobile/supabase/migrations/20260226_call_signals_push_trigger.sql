-- ================================================================
-- Call Push Notification Setup
-- ================================================================
--
-- When a call_signals row is inserted with status='ringing',
-- a push notification is sent to the callee to wake/alert the app
-- even when it's backgrounded or killed.
--
-- ARCHITECTURE:
--   The trigger function calls the send_notification Edge Function
--   via pg_net. Secrets (URL + service_role key) are stored ONLY
--   in the database function body (applied via psql, never in git).
--   This migration file is a TEMPLATE — run the actual CREATE
--   FUNCTION via psql with real credentials substituted.
--
-- TO APPLY (run via psql, NOT via git):
--   See scripts/apply-call-push-trigger.sh
-- ================================================================

-- Grant access to push_tokens and call_signals for the edge function
GRANT ALL ON public.push_tokens TO service_role;
GRANT ALL ON public.call_signals TO service_role;
