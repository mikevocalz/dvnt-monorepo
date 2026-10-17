-- Store why a checkout did not complete independently from the legacy
-- orders.status='payment_failed' state, which also covers timeouts.
-- This is additive: no status changes, no historical guesswork/backfill.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_failure_reason text,
  ADD COLUMN IF NOT EXISTS checkout_failure_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_checkout_failure_reason_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_checkout_failure_reason_check CHECK (
        checkout_failure_reason IS NULL OR checkout_failure_reason IN (
          'checkout_expired', 'checkout_abandoned', 'payment_cancelled',
          'payment_declined', 'payment_attempt_failed', 'async_payment_failed',
          'payment_reference_missing', 'technical_failure'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_checkout_failure_code_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_checkout_failure_code_check CHECK (
        checkout_failure_code IS NULL OR
        checkout_failure_code ~ '^[a-z0-9_]{1,64}$'
      );
  END IF;
END $$;

-- Success can arrive after a failed attempt or an expired checkout.
-- Always clear stale failure diagnostics on recovery; never override money
-- state or attempt to backfill old failures without Stripe evidence.
CREATE OR REPLACE FUNCTION public.clear_checkout_failure_on_payment_recovery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.checkout_failure_reason := NULL;
    NEW.checkout_failure_code := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clear_checkout_failure_on_payment_recovery ON public.orders;
CREATE TRIGGER clear_checkout_failure_on_payment_recovery
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.clear_checkout_failure_on_payment_recovery();

COMMENT ON COLUMN public.orders.checkout_failure_reason IS
  'Why an event checkout did not complete; null = not yet classified, NOT a card decline.';
COMMENT ON COLUMN public.orders.checkout_failure_code IS
  'Validated non-sensitive Stripe error code/decline code (not message or card data).';

-- An embedded Checkout's explicit Cancel button calls Stripe /expire.
-- Persist that *verified* reason after the provider confirms expiry. The
-- Stripe expiry webhook races this endpoint, so also allow replacing its
-- generic "checkout_expired" reason; do not override a real decline, a paid
-- order, or any other settled outcome. The RPC is service-role-only, atomic
-- and idempotent; callers insert a human-readable timeline only on TRUE.
CREATE OR REPLACE FUNCTION public.mark_embed_checkout_cancelled(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $
DECLARE
  v_changed boolean;
BEGIN
  UPDATE public.orders
  SET status = 'payment_failed',
      checkout_failure_reason = 'payment_cancelled',
      checkout_failure_code = NULL,
      updated_at = now()
  WHERE id = p_order_id
    AND (
      status = 'payment_pending'
      OR (
        status = 'payment_failed'
        AND (
          checkout_failure_reason IS NULL
          OR checkout_failure_reason = 'checkout_expired'
        )
      )
    );
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$;

REVOKE ALL ON FUNCTION public.mark_embed_checkout_cancelled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_embed_checkout_cancelled(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
