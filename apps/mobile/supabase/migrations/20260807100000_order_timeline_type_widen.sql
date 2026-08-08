-- ══════════════════════════════════════════════════════════════
-- Widen order_timeline.type CHECK (WS-5 async settlement)
-- ══════════════════════════════════════════════════════════════
-- The original CHECK (20260310_payments_ui_tables.sql) allows only the
-- 8 card-rail types. Two writers already violate it silently (inserts
-- error, errors are unchecked):
--   • reconcile-orders writes type='reconciled'
--   • stripe-webhook's payment_intent.processing handler wanted a
--     dedicated 'payment_processing' type and had to fall back to
--     'payment_authorized' (see its inline comment)
-- Async settlement adds a third need: 'payment_failed' provenance when
-- a bank payment fails days after checkout. Widen the CHECK to the
-- union; no rows change.

ALTER TABLE order_timeline
  DROP CONSTRAINT IF EXISTS order_timeline_type_check;
ALTER TABLE order_timeline
  ADD CONSTRAINT order_timeline_type_check CHECK (type IN (
    'created', 'payment_authorized', 'payment_captured',
    'receipt_generated', 'refund_requested', 'refund_processed',
    'dispute_opened', 'dispute_resolved',
    -- additions ↓
    'payment_processing', 'payment_failed', 'reconciled'
  ));
