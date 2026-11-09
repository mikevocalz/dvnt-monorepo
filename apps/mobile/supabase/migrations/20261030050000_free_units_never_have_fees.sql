-- SOURCE ONLY until explicit accounting approval. Free tickets stay $0 always.
-- Replace the old all-unit count and the later mixed-cart fee fallback with
-- strictly positive-price fee units. Zero/unknown-price units never create fees.
-- This changes future recomputations and therefore future payout net. No payment,
-- order, refund, transfer or payout status is changed. No cached backfill here.
-- Existing function ownership and grants are preserved by CREATE OR REPLACE.
BEGIN;

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
  v_addon_gross int;
  v_addon_refunds int;
  v_addon_units int;
  v_dvnt_fee int;
  v_stripe_fee int;
  v_net int;
BEGIN
  SELECT
    COALESCE(sum(purchase_amount_cents) FILTER (WHERE status NOT IN ('refunded','void')), 0),
    COALESCE(sum(purchase_amount_cents) FILTER (WHERE status = 'refunded'), 0),
    count(*) FILTER (WHERE status NOT IN ('refunded','void') AND purchase_amount_cents > 0)
  INTO v_gross, v_refunds, v_kept
  FROM public.tickets
  WHERE event_id = p_event_id;

  SELECT
    COALESCE(sum(greatest(0, unit_price_cents * quantity - refunded_amount_cents))
      FILTER (WHERE status <> 'refunded'), 0),
    COALESCE(sum(least(refunded_amount_cents, unit_price_cents * quantity))
      FILTER (WHERE status <> 'refunded'), 0)
      + COALESCE(sum(unit_price_cents * quantity) FILTER (WHERE status = 'refunded'), 0),
    COALESCE(sum(quantity) FILTER (WHERE status <> 'refunded' AND unit_price_cents > 0), 0)
  INTO v_addon_gross, v_addon_refunds, v_addon_units
  FROM public.order_addons
  WHERE event_id = p_event_id;

  v_gross := v_gross + v_addon_gross;
  v_refunds := v_refunds + v_addon_refunds;

  -- Free units never bear a flat fee, even inside a paid mixed cart.
  -- Paid-unit percentage/rounding/refund policy and Stripe ledger are unchanged.
  v_dvnt_fee := round(v_gross * 0.025) + 100 * (v_kept + v_addon_units);

  -- Stripe's actual processor fee is platform accounting, captured from
  -- Stripe balance transactions per paid order. It is displayed separately
  -- and does NOT reduce the organizer payout.
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

COMMIT;
