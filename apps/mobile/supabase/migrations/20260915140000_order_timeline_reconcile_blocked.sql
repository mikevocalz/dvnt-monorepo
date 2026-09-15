-- ══════════════════════════════════════════════════════════════
-- Widen order_timeline.type CHECK: add 'reconcile_blocked'
-- ══════════════════════════════════════════════════════════════
-- reconcile-orders now refuses to flip a paid-at-Stripe order to 'paid'
-- when no tickets exist and it cannot issue for that rail (cart / guest /
-- missing hold). It leaves the order payment_pending and records a
-- 'reconcile_blocked' timeline entry so the situation is visible. The
-- insert's error is unchecked, so without this the entry would be dropped
-- silently — the same failure the 20260807100000 widen fixed for
-- 'reconciled'. No rows change.

ALTER TABLE order_timeline
  DROP CONSTRAINT IF EXISTS order_timeline_type_check;
ALTER TABLE order_timeline
  ADD CONSTRAINT order_timeline_type_check CHECK (type IN (
    'created', 'payment_authorized', 'payment_captured',
    'receipt_generated', 'refund_requested', 'refund_processed',
    'dispute_opened', 'dispute_resolved',
    'payment_processing', 'payment_failed', 'reconciled',
    -- additions ↓
    'reconcile_blocked'
  ));
