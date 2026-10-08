-- Stripe processing fee is a separate ledger from DVNT's platform fee.
--
-- event_financials previously hard-coded stripe_fee_cents = 0 even though
-- live Stripe balance transactions carry real processor fees. The webhook and
-- reconciler now write Charge.balance_transaction.fee to a NEW column,
-- orders.stripe_fee_cents. orders.processing_fee_cents is left alone: it is
-- the buyer receipt "Processing" line (purchases) and is subtracted from
-- host net (host-transactions), and Stripe's fee must reach neither.
--
-- Additive only: two nullable columns, no defaults, no constraints.
-- stripe_fee_cents NULL means "not synced yet"; 0 is a real synced value.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_fee_attempted_at timestamptz;

COMMENT ON COLUMN public.orders.stripe_fee_cents IS
  'Stripe processor fee (balance_transaction.fee) allocated to this order. Platform accounting only; never shown to buyers, never deducted from host net.';
COMMENT ON COLUMN public.orders.stripe_fee_attempted_at IS
  'Last time reconcile-orders tried to read stripe_fee_cents from Stripe. Orders backfill oldest-attempt first.';

-- Backfill scan for reconcile-orders: paid event-ticket orders still unsynced.
CREATE INDEX IF NOT EXISTS idx_orders_stripe_fee_backfill
  ON public.orders (stripe_fee_attempted_at NULLS FIRST, paid_at)
  WHERE type = 'event_ticket' AND status = 'paid' AND stripe_fee_cents IS NULL;

CREATE OR REPLACE FUNCTION public.recompute_event_financials(p_event_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gross int;
  v_refunds int;
  v_kept int;
  v_dvnt_fee int;
  v_stripe_fee int;
  v_net int;
BEGIN
  SELECT
    COALESCE(sum(purchase_amount_cents) FILTER (WHERE status NOT IN ('refunded','void')), 0),
    COALESCE(sum(purchase_amount_cents) FILTER (WHERE status = 'refunded'), 0),
    count(*) FILTER (WHERE status NOT IN ('refunded','void'))
  INTO v_gross, v_refunds, v_kept
  FROM public.tickets
  WHERE event_id = p_event_id;

  -- Organizer-facing DVNT fee remains the existing policy component.
  v_dvnt_fee := round(v_gross * 0.025) + 100 * v_kept;

  -- Stripe's actual processor fee is platform accounting, captured from
  -- Stripe balance transactions per paid order. It is displayed separately
  -- and does NOT silently reduce the organizer payout.
  SELECT COALESCE(sum(stripe_fee_cents), 0)::int
  INTO v_stripe_fee
  FROM public.orders
  WHERE event_id = p_event_id
    AND type = 'event_ticket'
    AND paid_at IS NOT NULL
    AND stripe_fee_cents >= 0;

  v_net := greatest(0, v_gross - v_dvnt_fee);

  INSERT INTO public.event_financials
    (event_id, gross_cents, refunds_cents, dvnt_fee_cents, stripe_fee_cents, net_cents, calculated_at)
  VALUES
    (p_event_id, v_gross, v_refunds, v_dvnt_fee, v_stripe_fee, v_net, now())
  ON CONFLICT (event_id) DO UPDATE SET
    gross_cents = EXCLUDED.gross_cents,
    refunds_cents = EXCLUDED.refunds_cents,
    dvnt_fee_cents = EXCLUDED.dvnt_fee_cents,
    stripe_fee_cents = EXCLUDED.stripe_fee_cents,
    net_cents = EXCLUDED.net_cents,
    calculated_at = EXCLUDED.calculated_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.orders_financials_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_event_id := OLD.event_id;
  ELSE
    v_event_id := NEW.event_id;
  END IF;
  IF v_event_id IS NOT NULL THEN
    PERFORM public.recompute_event_financials(v_event_id);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS orders_financials_refresh ON public.orders;
CREATE TRIGGER orders_financials_refresh
AFTER INSERT OR DELETE OR UPDATE OF
  stripe_fee_cents, status, paid_at, event_id
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.orders_financials_refresh();

REVOKE ALL ON FUNCTION public.orders_financials_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orders_financials_refresh() TO service_role;

-- Recompute existing summaries. stripe_fee_cents will fill progressively
-- via reconcile-orders for historical paid Stripe orders.
DO $$
DECLARE v_id int;
BEGIN
  FOR v_id IN
    SELECT DISTINCT event_id
    FROM (
      SELECT event_id FROM public.tickets WHERE event_id IS NOT NULL
      UNION
      SELECT event_id FROM public.orders WHERE event_id IS NOT NULL
    ) x
  LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
