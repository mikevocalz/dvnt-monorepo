-- ══════════════════════════════════════════════════════════════
-- Promoter payout state (WS-6) — settle the rev-share ledger at
-- event payout time.
-- ══════════════════════════════════════════════════════════════
-- The promoter economy migration (20260806100000) records signed
-- earning/reversal rows in promoter_ledger_entries as orders are paid
-- and refunded. Those rows accrue but are never disbursed. This
-- migration adds the disbursement bookkeeping that `payouts-release`
-- stamps when it nets each promoter's cut out of the organizer's
-- transfer and pays it to the promoter's own connected account:
--
--   • promoter_ledger_entries.paid_out_at   — when this row was settled
--   • promoter_ledger_entries.payout_status — pending → paid | held
--   • promoter_ledger_entries.payout_note   — human reason for a hold
--   • event_promoters.stripe_account_id     — promoter's Connect acct
--   • event_promoters.payouts_enabled       — Connect payouts capability
--
-- A promoter with no connected account has their share HELD (never
-- dropped): the earning rows stay paid_out_at IS NULL with
-- payout_status='held' and a note, so a later payout run settles them
-- once the promoter connects. Re-running is idempotent — a stamped
-- (paid_out_at IS NOT NULL) row is never reconsidered, and the Stripe
-- transfer carries a deterministic Idempotency-Key per
-- (event, promoter, payout window), so a replay never double-pays.

-- ── 1. Ledger disbursement columns ───────────────────────────
ALTER TABLE promoter_ledger_entries
  ADD COLUMN IF NOT EXISTS paid_out_at   timestamptz,
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_note   text;

-- Guard the payout_status vocabulary (additive; dropped-then-added so a
-- re-run lands the current definition).
ALTER TABLE promoter_ledger_entries
  DROP CONSTRAINT IF EXISTS promoter_ledger_entries_payout_status_check;
ALTER TABLE promoter_ledger_entries
  ADD CONSTRAINT promoter_ledger_entries_payout_status_check
    CHECK (payout_status IN ('pending','paid','held'));

-- Hot path for settlement: unpaid rows for an event, by promoter.
CREATE INDEX IF NOT EXISTS idx_promoter_ledger_unpaid
  ON promoter_ledger_entries(event_id, promoter_id)
  WHERE paid_out_at IS NULL;

-- ── 2. Promoter connected-account columns ────────────────────
-- Distinct from organizer_accounts (host_id-keyed). A promoter linked
-- to a DVNT account may reuse their organizer Connect account; an
-- external promoter (user_id NULL) can only be paid once a
-- stripe_account_id is set here. NULL = no account yet ⇒ HOLD.
ALTER TABLE event_promoters
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS payouts_enabled   boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
