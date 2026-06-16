-- ══════════════════════════════════════════════════════════════
-- Tickets RLS lockdown
-- ══════════════════════════════════════════════════════════════
-- Migration 20260333_fix_anon_role_all_tables.sql granted anon
-- SELECT / INSERT / UPDATE on the tickets table with permissive
--   USING (true) WITH CHECK (true)
-- policies. With the Supabase anon key exposed in the mobile app,
-- this let anyone read every ticket (including guest_email,
-- guest_name, qr_token, qr_payload) AND spoof or tamper with any
-- ticket row.
--
-- All client reads that previously hit `from("tickets")` now go
-- through three edge functions:
--
--     get-my-tickets       — caller's own tickets (user_id filter
--                            applied server-side with legacy
--                            integer-id fallback)
--     get-event-tickets    — host-only per-event list, including
--                            the { offline: true } qr_token-only
--                            payload used for offline check-in
--
-- Every ticket write happens via edge fns that use the service role
-- (ticket-checkout, stripe-webhook, ticket-upgrade, ticket-scan,
-- transfer-ticket, organizer-refund, fix-tickets) — none of which
-- are affected by RLS. It is therefore safe to revoke anon's direct
-- table access entirely.

-- 1. Drop the permissive policies
DROP POLICY IF EXISTS tickets_select_anon  ON public.tickets;
DROP POLICY IF EXISTS tickets_insert_anon  ON public.tickets;
DROP POLICY IF EXISTS tickets_update_anon  ON public.tickets;

-- 2. Revoke the broad anon grants added by 20260333
REVOKE SELECT, INSERT, UPDATE ON public.tickets FROM anon;

-- 3. Also revoke on ticket_holds: the holds are created and
--    converted by ticket-checkout / stripe-webhook using the service
--    role. No legitimate anon client read or write exists.
DROP POLICY IF EXISTS ticket_holds_select_anon ON public.ticket_holds;
DROP POLICY IF EXISTS ticket_holds_insert_anon ON public.ticket_holds;
DROP POLICY IF EXISTS ticket_holds_update_anon ON public.ticket_holds;
REVOKE SELECT, INSERT, UPDATE ON public.ticket_holds FROM anon;

-- 4. Keep RLS enabled on tickets. The table now answers only to the
--    service role (edge functions). If a future feature needs an
--    authenticated-role-scoped SELECT, add a tight policy keyed on
--    the Better Auth session token verified by an edge function.

-- 5. Service-role grants are already in place from earlier
--    migrations; re-apply defensively so a fresh environment
--    bootstraps cleanly.
GRANT ALL ON public.tickets      TO service_role;
GRANT ALL ON public.ticket_holds TO service_role;

NOTIFY pgrst, 'reload schema';
