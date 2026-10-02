-- Guest-phone comp idempotency index, split out of 20261002190000.
--
-- One statement, one lock. A unique index build on public.tickets holds a SHARE
-- lock on the table until it finishes, which blocks every INSERT and UPDATE:
-- checkout, scanning, transfers. Keeping it in its own migration means the lock
-- covers this statement only, and an operator can take it off the deploy path
-- entirely (see below).
--
-- CONCURRENTLY is NOT used here. These migrations run inside a transaction
-- (supabase CLI wraps each file), and Postgres rejects CREATE INDEX
-- CONCURRENTLY inside a transaction block outright. The same constraint is
-- recorded in 20260810221239_roster_indexes.sql and
-- 20260519201909_add_missing_fk_indexes.sql.
--
-- If public.tickets has grown enough that a SHARE lock is not acceptable, build
-- the index out of band FIRST, with psql in autocommit:
--
--   \i scripts/operations/tickets-guest-phone-index-concurrently.sql
--
-- then deploy. IF NOT EXISTS makes this statement a no-op and the ledger still
-- records the migration, so the repo and the database do not drift.
--
-- Additive only. No DML, nothing dropped, nothing rewritten.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS tickets_active_guest_phone_tier_uidx
  ON public.tickets(event_id, ticket_type_id, guest_phone_e164)
  WHERE guest_phone_e164 IS NOT NULL
    AND status IN ('active', 'scanned', 'transfer_pending');

COMMIT;
