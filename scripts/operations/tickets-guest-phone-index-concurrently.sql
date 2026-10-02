-- Builds tickets_active_guest_phone_tier_uidx without blocking writes.
--
-- Run this BEFORE deploying migration 20261002190100 when public.tickets is
-- large enough that a SHARE lock on it is not acceptable. The migration uses
-- IF NOT EXISTS, so once this has run the deploy is a no-op on this index and
-- the migration ledger still records the version.
--
--   psql "$DATABASE_URL" -f scripts/operations/tickets-guest-phone-index-concurrently.sql
--
-- CONCURRENTLY cannot run inside a transaction block, so there is no BEGIN here
-- and ON_ERROR_STOP is the only guard. Adds an index. No DML, nothing dropped.
\set ON_ERROR_STOP on

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS tickets_active_guest_phone_tier_uidx
  ON public.tickets(event_id, ticket_type_id, guest_phone_e164)
  WHERE guest_phone_e164 IS NOT NULL
    AND status IN ('active', 'scanned', 'transfer_pending');

-- A CONCURRENTLY build that fails leaves the index behind marked INVALID, and
-- an invalid unique index enforces nothing. Fail loudly rather than let the
-- deploy read "index exists" as "index works". Recovery is DROP INDEX
-- CONCURRENTLY on the invalid one, then re-run this file.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'tickets_active_guest_phone_tier_uidx'
      AND NOT i.indisvalid
  ) THEN
    RAISE EXCEPTION
      'tickets_active_guest_phone_tier_uidx is INVALID — the concurrent build failed. '
      'DROP INDEX CONCURRENTLY public.tickets_active_guest_phone_tier_uidx; then re-run this file.';
  END IF;
END $$;
