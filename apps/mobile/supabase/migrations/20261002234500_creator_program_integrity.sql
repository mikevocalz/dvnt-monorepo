-- ══════════════════════════════════════════════════════════════
-- Creator program integrity — make a double credit, a borrowed
-- event and an oversized room unrepresentable.
-- ══════════════════════════════════════════════════════════════
-- 20261002223000_creator_lynk_program.sql created the creator
-- tables. Three holes in that shape are cheap to close now and
-- expensive later, because nothing writes creator_earnings_ledger
-- yet: there is no double payout today, and no backfill to do.
--
-- ── The earnings ledger could not prevent a double credit ──
-- No idempotency key, no uniqueness, and a 'paid' status with no
-- column saying when or in which batch. The pattern below is the
-- one the payout rail already runs, copied rather than reinvented:
--
--   • promoter_ledger_entries, 20260806100000_promoter_economy.sql:
--     CONSTRAINT uniq_promoter_ledger_order_type UNIQUE
--     (order_id, entry_type) — "at most one earning and one
--     reversal per order". Here that is (session_id, kind).
--   • orders, 20260923000000_order_idempotency_key.sql:
--     idempotency_key text + a unique index partial on
--     "key IS NOT NULL", with the writer catching unique_violation
--     and returning the winner's row.
--   • promoter_ledger_entries, 20260807300000_promoter_payout_state.sql:
--     paid_out_at as the settled stamp the writer filters on
--     (.is("paid_out_at", null)), plus a partial index on the
--     unsettled rows. Here that is paid_at + payout_batch_key, and
--     external_ref carries the processor's own transfer id the way
--     stripe_transfer_id does there.
--
-- The deterministic-key half of that pattern lives in the writer,
-- not the schema: payouts-release/index.ts derives
-- `promoter_payout:${eventId}:${promoterId}:${windowKey}` from the
-- business tuple instead of minting a UUID. Whatever writes this
-- table must derive idempotency_key the same way; the unique index
-- is what makes a replay a no-op rather than a second payment.
--
-- ── event_id was a client integer with no foreign key ──
-- A bare bigint accepted any event id, including an id that does
-- not exist and another host's, while compensation_snapshot and
-- referral_code rode along on the same row — the revenue-share
-- attribution path. It becomes integer, matching public.events(id)
-- and every other event_id column in this schema, with a real
-- reference. Ownership is the edge function's job (it uses
-- _shared/event-access.ts); the key only guarantees the event is
-- real.
--
-- ── capacity had no ceiling ──
-- 1..5000 was accepted beside a room that seats twelve.
--
-- Re-runnable: every statement is guarded, and no DML touches an
-- existing row. If the foreign key below fails, a session is
-- pointing at an event that does not exist — that is a finding to
-- look at, not something this migration should quietly null out.
--
-- ON DELETE semantics keep the table's deliberate asymmetry:
-- RESTRICT on creator_user_id so a money row can never lose its
-- owner, SET NULL on the session link so deleting a session cannot
-- delete the earning. event_id follows the session rule — losing
-- an event must not destroy the creator's earning history.

BEGIN;

-- ── 1. creator_lynk_sessions.event_id → a real reference ──────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'creator_lynk_sessions'
      AND column_name = 'event_id'
      AND data_type <> 'integer'
  ) THEN
    ALTER TABLE public.creator_lynk_sessions
      ALTER COLUMN event_id TYPE integer USING event_id::integer;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creator_lynk_sessions_event_id_fkey'
      AND conrelid = 'public.creator_lynk_sessions'::regclass
  ) THEN
    ALTER TABLE public.creator_lynk_sessions
      ADD CONSTRAINT creator_lynk_sessions_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Postgres does not index a foreign key for you, and this one is
-- walked by both the join and the ON DELETE SET NULL sweep.
CREATE INDEX IF NOT EXISTS creator_lynk_sessions_event_idx
  ON public.creator_lynk_sessions (event_id)
  WHERE event_id IS NOT NULL;

-- ── 2. capacity cannot exceed the room it describes ───────────
-- 12 is CALL_HUMAN_CAPACITY in
-- apps/mobile/supabase/functions/_shared/call-capacity.ts. Written
-- as a literal for the same reason admit_call_participant does
-- (20261001140000_call_capacity_twelve.sql): SQL cannot import the
-- constant, and scripts/verify-call-capacity.mjs reads the
-- TypeScript and asserts the database agrees, so the two cannot
-- drift silently.
--
-- Dropped then added so a re-run lands the current definition. The
-- name is the one Postgres generated for the original inline
-- column CHECK, so this replaces it rather than stacking a second.
ALTER TABLE public.creator_lynk_sessions
  DROP CONSTRAINT IF EXISTS creator_lynk_sessions_capacity_check;
ALTER TABLE public.creator_lynk_sessions
  ADD CONSTRAINT creator_lynk_sessions_capacity_check
    CHECK (capacity IS NULL OR (capacity > 0 AND capacity <= 12));

-- ── 3. The earnings ledger ────────────────────────────────────
ALTER TABLE public.creator_earnings_ledger
  ADD COLUMN IF NOT EXISTS idempotency_key  text,
  ADD COLUMN IF NOT EXISTS external_ref     text,
  ADD COLUMN IF NOT EXISTS paid_at          timestamptz,
  ADD COLUMN IF NOT EXISTS payout_batch_key text;

-- The replay guard. Partial on "IS NOT NULL" so a legacy or
-- manually-entered row without a key is still insertable, exactly
-- as orders_idempotency_key_uq is.
CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_idempotency_key_uq
  ON public.creator_earnings_ledger (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- One earning of each kind per session, the (session_id, kind)
-- twin of uniq_promoter_ledger_order_type. Scoped to the three
-- earning kinds: a session earns its flat fee, its revenue share
-- and its attendance bonus once each, whereas refunds,
-- chargebacks and manual corrections are repeatable by design and
-- are deduped by idempotency_key above. session_id is nullable
-- (ON DELETE SET NULL), so the index is partial on it — two
-- orphaned rows must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS creator_earnings_session_kind_uq
  ON public.creator_earnings_ledger (session_id, kind)
  WHERE session_id IS NOT NULL
    AND kind IN ('flat_fee', 'revenue_share', 'attendance_bonus');

-- A paid row carries the instant it was paid. Written as an
-- implication, not an equivalence: a row voided or reversed AFTER
-- payment keeps its paid_at, because clearing it to satisfy a
-- stricter constraint would erase the record of a real payment.
ALTER TABLE public.creator_earnings_ledger
  DROP CONSTRAINT IF EXISTS creator_earnings_paid_requires_timestamp;
ALTER TABLE public.creator_earnings_ledger
  ADD CONSTRAINT creator_earnings_paid_requires_timestamp
    CHECK (status <> 'paid' OR paid_at IS NOT NULL);

-- Settlement hot path, the twin of idx_promoter_ledger_unpaid:
-- unsettled rows for one creator.
CREATE INDEX IF NOT EXISTS creator_earnings_unsettled_idx
  ON public.creator_earnings_ledger (creator_user_id, kind)
  WHERE paid_at IS NULL;

-- Reconciliation reads: "which ledger rows did this transfer pay?"
CREATE INDEX IF NOT EXISTS creator_earnings_external_ref_idx
  ON public.creator_earnings_ledger (external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS creator_earnings_batch_idx
  ON public.creator_earnings_ledger (payout_batch_key)
  WHERE payout_batch_key IS NOT NULL;

-- ── 4. Re-assert the access posture ───────────────────────────
-- Already true after 20261002223000; re-stated so this migration
-- lands the same posture whether or not it runs beside it, and so
-- the new columns are never reachable from a browser or a device.
ALTER TABLE public.creator_lynk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_earnings_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.creator_lynk_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.creator_earnings_ledger FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_lynk_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.creator_earnings_ledger TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
