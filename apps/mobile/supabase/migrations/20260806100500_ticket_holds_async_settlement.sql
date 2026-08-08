-- ══════════════════════════════════════════════════════════════
-- Bank-transfer / delayed-settlement holds (WS-5)
-- ══════════════════════════════════════════════════════════════
-- ticket_holds today models only the synchronous checkout window
-- (minutes-scale expires_at). Delayed payment methods (us_bank_account,
-- customer_balance bank transfer) settle in days — the inventory must
-- stay reserved for the whole processing window or the buyer pays and
-- gets no ticket. `hold_kind` distinguishes the two without a second
-- table; expires_at is already unconstrained, so days-scale values are
-- legal — the kind exists so sweeps and dashboards can tell a stuck
-- checkout from a normal in-flight bank transfer.
ALTER TABLE ticket_holds
  ADD COLUMN IF NOT EXISTS hold_kind text NOT NULL DEFAULT 'checkout';

DO $$ BEGIN
  ALTER TABLE ticket_holds DROP CONSTRAINT IF EXISTS ticket_holds_hold_kind_check;
  ALTER TABLE ticket_holds ADD CONSTRAINT ticket_holds_hold_kind_check
    CHECK (hold_kind IN ('checkout','async_settlement'));
EXCEPTION WHEN others THEN NULL; END $$;

-- RELEASE CONTRACT
--   checkout          — minutes-scale expires_at set at hold creation.
--                       Converted by payment confirmation; expired by
--                       the reconcile-orders sweep (status='active' AND
--                       expires_at < now() → 'expired').
--   async_settlement  — days-scale expires_at covering the processor's
--                       settlement window (set it to the PaymentIntent's
--                       expected window plus margin). Converted by
--                       payment_intent.succeeded; expired EARLY by
--                       payment_intent.payment_failed / .canceled
--                       webhooks; the same reconcile-orders sweep is the
--                       backstop once expires_at finally passes, so an
--                       unhandled webhook can strand inventory for at
--                       most the settlement window, never forever.
COMMENT ON COLUMN ticket_holds.hold_kind IS
  'checkout = synchronous minutes-scale checkout hold; async_settlement = days-scale hold for delayed payment methods (bank transfer / ACH). See release contract in 20260806100500.';

-- The sweep and any settlement dashboard scan active async holds.
CREATE INDEX IF NOT EXISTS idx_ticket_holds_async_active
  ON ticket_holds(expires_at)
  WHERE hold_kind = 'async_settlement' AND status = 'active';

NOTIFY pgrst, 'reload schema';
