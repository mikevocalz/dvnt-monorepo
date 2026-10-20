-- Do not count free RSVPs/comp tickets as fee-bearing sales.
-- The previous count(*) added $1 to event_financials for every kept ticket,
-- even when its order recorded zero total and zero fees. The summary feeds
-- both event-analytics and payouts-release, so this is not a UI-only fix.
--
-- Count a kept unit only when its purchase price is positive OR its linked
-- order records a positive charge and a platform fee. The latter preserves
-- existing paid-cart charges on zero-price units without changing checkout.
-- Apply the same rule to add-ons. Keep gross/refunds, percentage rounding,
-- Stripe's separate processor-fee ledger and clamped net unchanged.
--
-- This migration refreshes cached summaries only. It does not change orders,
-- tickets, Stripe payments, transfers or payout status. Apply to production
-- only after separately approving the migration and cached-data repair.
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
    COALESCE(sum(t.purchase_amount_cents) FILTER (WHERE t.status NOT IN ('refunded','void')), 0),
    COALESCE(sum(t.purchase_amount_cents) FILTER (WHERE t.status = 'refunded'), 0),
    count(*) FILTER (
      WHERE t.status NOT IN ('refunded','void')
        AND (t.purchase_amount_cents > 0 OR (
          o.total_cents > 0 AND greatest(
            coalesce(o.organizer_fee_cents, 0), coalesce(o.buyer_fee_cents, 0),
            coalesce(o.platform_fee_cents, 0), coalesce(o.dvnt_total_fee_cents, 0)
          ) > 0
        ))
    )
  INTO v_gross, v_refunds, v_kept
  FROM public.tickets t
  LEFT JOIN public.orders o ON o.id = t.order_id
  WHERE t.event_id = p_event_id;

  SELECT
    COALESCE(sum(greatest(0, a.unit_price_cents * a.quantity - a.refunded_amount_cents))
      FILTER (WHERE a.status <> 'refunded'), 0),
    COALESCE(sum(least(a.refunded_amount_cents, a.unit_price_cents * a.quantity))
      FILTER (WHERE a.status <> 'refunded'), 0)
      + COALESCE(sum(a.unit_price_cents * a.quantity) FILTER (WHERE a.status = 'refunded'), 0),
    COALESCE(sum(a.quantity) FILTER (
      WHERE a.status <> 'refunded'
        AND (a.unit_price_cents > 0 OR (
          o.total_cents > 0 AND greatest(
            coalesce(o.organizer_fee_cents, 0), coalesce(o.buyer_fee_cents, 0),
            coalesce(o.platform_fee_cents, 0), coalesce(o.dvnt_total_fee_cents, 0)
          ) > 0
        ))
    ), 0)
  INTO v_addon_gross, v_addon_refunds, v_addon_units
  FROM public.order_addons a
  LEFT JOIN public.orders o ON o.id = a.order_id
  WHERE a.event_id = p_event_id;

  v_gross := v_gross + v_addon_gross;
  v_refunds := v_refunds + v_addon_refunds;

  -- Free/comp issuance must not invent a flat fee. Paid mixed carts are
  -- different: their recorded fees already cover every unit, including
  -- zero-price tickets/add-ons. Preserve those rather than rewriting history.
  -- The percentage component and paid-unit/refund policy are unchanged.
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

-- Event consolidation deliberately leaves orders on their original event
-- while moving ticket/add-on rows. A fee correction must refresh every event
-- that currently derives fee-bearing units from this order, not just its owner.
CREATE OR REPLACE FUNCTION public.orders_financials_refresh()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_old_event_id integer;
  v_new_event_id integer;
  v_event_id integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_order_id := OLD.id;
    v_old_event_id := OLD.event_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_order_id := NEW.id;
    v_new_event_id := NEW.event_id;
  END IF;

  FOR v_event_id IN
    SELECT event_id FROM (
      SELECT v_old_event_id AS event_id
      UNION SELECT v_new_event_id
      UNION SELECT t.event_id FROM public.tickets t WHERE t.order_id = v_order_id
      UNION SELECT a.event_id FROM public.order_addons a WHERE a.order_id = v_order_id
    ) affected WHERE event_id IS NOT NULL ORDER BY event_id
  LOOP
    PERFORM public.recompute_event_financials(v_event_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

-- The fee-bearing-unit predicate now depends on these order fields, so a
-- fee correction must refresh the cached summary even without a status change.
DROP TRIGGER IF EXISTS orders_financials_refresh ON public.orders;
CREATE TRIGGER orders_financials_refresh
AFTER INSERT OR DELETE OR UPDATE OF
  stripe_fee_cents, status, paid_at, event_id, total_cents,
  organizer_fee_cents, buyer_fee_cents, platform_fee_cents, dvnt_total_fee_cents
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.orders_financials_refresh();

-- Preserve the existing restricted callable surface; no new public RPC.
REVOKE ALL ON FUNCTION public.recompute_event_financials(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_event_financials(integer) TO service_role;
REVOKE ALL ON FUNCTION public.orders_financials_refresh() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orders_financials_refresh() TO service_role;

-- Refresh only events that can have changed: a zero/unknown-price kept unit.
-- Reapplying is safe and never alters the source order/payment ledger.
DO $$
DECLARE v_id int;
BEGIN
  FOR v_id IN
    SELECT t.event_id FROM public.tickets t
      WHERE t.event_id IS NOT NULL AND coalesce(t.purchase_amount_cents, 0) <= 0
        AND t.status NOT IN ('refunded', 'void')
    UNION
    SELECT a.event_id FROM public.order_addons a
      WHERE a.event_id IS NOT NULL AND a.unit_price_cents <= 0
        AND a.status <> 'refunded'
  LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
END $$;

COMMIT;
