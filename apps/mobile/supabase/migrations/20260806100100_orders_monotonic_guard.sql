-- ══════════════════════════════════════════════════════════════
-- Orders monotonic guard (I5 analog for order money state)
-- ══════════════════════════════════════════════════════════════
-- Mirrors the membership_subscriptions guard (20260630120000):
-- without `last_event_at`, an out-of-order Stripe webhook replay can
-- silently overwrite a newer money state (e.g. `payment_failed` from
-- a delayed retry lands after `paid` → buyer's paid order flips back).
-- All webhook writes to order money state should route through
-- upsert_order_money_state; a stale event (older event.created) is a
-- guaranteed no-op.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

-- Backfill: existing rows were last touched at updated_at (same
-- convention as the membership_subscriptions backfill).
UPDATE orders
SET last_event_at = updated_at
WHERE last_event_at IS NULL;

-- Despite the "upsert" name (kept parallel to
-- upsert_membership_subscription), orders are CREATED by checkout
-- flows — webhooks only move money state, so this is an
-- update-if-newer. Returns TRUE if the write applied, FALSE if the
-- order is missing or the event was stale.
-- Optional params use COALESCE so a status-only event (e.g.
-- payment_intent.processing) never nulls out previously-written
-- Stripe refs or timestamps. Amounts stay integer cents and are not
-- writable here — money totals are set at order creation and by
-- refund flows, not by state-transition events.
CREATE OR REPLACE FUNCTION public.upsert_order_money_state(
  p_order_id                 uuid,
  p_status                   text,
  p_event_created_at         timestamptz,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_payment_method_last4     text DEFAULT NULL,
  p_payment_method_brand     text DEFAULT NULL,
  p_paid_at                  timestamptz DEFAULT NULL,
  p_refunded_at              timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_applied boolean;
BEGIN
  UPDATE orders
  SET
    status                   = p_status,
    stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
    payment_method_last4     = COALESCE(p_payment_method_last4, payment_method_last4),
    payment_method_brand     = COALESCE(p_payment_method_brand, payment_method_brand),
    paid_at                  = COALESCE(p_paid_at, paid_at),
    refunded_at              = COALESCE(p_refunded_at, refunded_at),
    last_event_at            = p_event_created_at,
    updated_at               = now()
  WHERE id = p_order_id
    AND (last_event_at IS NULL OR last_event_at < p_event_created_at);

  -- TRUE if the row's last_event_at moved forward (write applied).
  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_order_money_state(
  uuid, text, timestamptz, text, text, text, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_order_money_state(
  uuid, text, timestamptz, text, text, text, timestamptz, timestamptz
) TO service_role;

NOTIFY pgrst, 'reload schema';
