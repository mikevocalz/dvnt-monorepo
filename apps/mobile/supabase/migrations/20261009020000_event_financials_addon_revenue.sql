-- Add-on revenue in event_financials.
--
-- Cart checkout charges add-on lines (coat check, drinks) on the same order
-- as tickets: orders.subtotal_cents includes them and orders.stripe_fee_cents
-- covers the whole charge. recompute_event_financials summed only
-- tickets.purchase_amount_cents, so event_financials (read by event-analytics
-- and, from this change, payouts-release) dropped every add-on dollar from
-- gross and net.
--
-- Add-on rows (public.order_addons) now count:
--   gross   += unit_price_cents * quantity - refunded_amount_cents, for rows
--              whose status is not 'refunded' (partial refunds come off)
--   refunds += refunded_amount_cents on those rows, plus the full line on
--              'refunded' rows (a status-only refund still refunds the line)
--   fee      = 2.5% of gross + $1 per kept unit, where kept units are kept
--              tickets plus kept add-on units. cart-checkout charges the
--              per-unit fee on every cart unit (computeFeesWithMode quantity =
--              tickets + add-on units), so the estimate follows it.
--
-- order_addons gets the same statement-level transition-table triggers the
-- tickets table has (20260922100000), so row writes refresh the summary.
-- recompute_event_financials writes only event_financials, so no recursion.
--
-- Signature, SECURITY DEFINER, search_path and grants are unchanged.
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
    count(*) FILTER (WHERE status NOT IN ('refunded','void'))
  INTO v_gross, v_refunds, v_kept
  FROM public.tickets
  WHERE event_id = p_event_id;

  SELECT
    COALESCE(sum(greatest(0, unit_price_cents * quantity - refunded_amount_cents))
      FILTER (WHERE status <> 'refunded'), 0),
    COALESCE(sum(least(refunded_amount_cents, unit_price_cents * quantity))
      FILTER (WHERE status <> 'refunded'), 0)
      + COALESCE(sum(unit_price_cents * quantity) FILTER (WHERE status = 'refunded'), 0),
    COALESCE(sum(quantity) FILTER (WHERE status <> 'refunded'), 0)
  INTO v_addon_gross, v_addon_refunds, v_addon_units
  FROM public.order_addons
  WHERE event_id = p_event_id;

  v_gross := v_gross + v_addon_gross;
  v_refunds := v_refunds + v_addon_refunds;

  -- Organizer-facing DVNT fee: 2.5% of gross plus $1 per kept unit.
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

CREATE OR REPLACE FUNCTION public.order_addons_financials_refresh_ins()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id int;
BEGIN
  FOR v_id IN SELECT DISTINCT event_id FROM new_table WHERE event_id IS NOT NULL LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

-- UNION of old and new event ids: event consolidation re-points
-- order_addons.event_id, and both events must be recounted.
CREATE OR REPLACE FUNCTION public.order_addons_financials_refresh_upd()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id int;
BEGIN
  FOR v_id IN
    SELECT event_id FROM (
      SELECT event_id FROM new_table
      UNION
      SELECT event_id FROM old_table
    ) s WHERE event_id IS NOT NULL
  LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.order_addons_financials_refresh_del()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id int;
BEGIN
  FOR v_id IN SELECT DISTINCT event_id FROM old_table WHERE event_id IS NOT NULL LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
  RETURN NULL;
END;
$function$;

-- Transition tables require one trigger per event.
DROP TRIGGER IF EXISTS order_addons_financials_refresh_ins ON public.order_addons;
DROP TRIGGER IF EXISTS order_addons_financials_refresh_upd ON public.order_addons;
DROP TRIGGER IF EXISTS order_addons_financials_refresh_del ON public.order_addons;
CREATE TRIGGER order_addons_financials_refresh_ins
  AFTER INSERT ON public.order_addons
  REFERENCING NEW TABLE AS new_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.order_addons_financials_refresh_ins();
CREATE TRIGGER order_addons_financials_refresh_upd
  AFTER UPDATE ON public.order_addons
  REFERENCING NEW TABLE AS new_table OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.order_addons_financials_refresh_upd();
CREATE TRIGGER order_addons_financials_refresh_del
  AFTER DELETE ON public.order_addons
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.order_addons_financials_refresh_del();

REVOKE ALL ON FUNCTION public.recompute_event_financials(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_addons_financials_refresh_ins() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_addons_financials_refresh_upd() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.order_addons_financials_refresh_del() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_event_financials(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.order_addons_financials_refresh_ins() TO service_role;
GRANT EXECUTE ON FUNCTION public.order_addons_financials_refresh_upd() TO service_role;
GRANT EXECUTE ON FUNCTION public.order_addons_financials_refresh_del() TO service_role;

-- Recompute every event that has tickets, orders or add-on rows.
DO $$
DECLARE v_id int;
BEGIN
  FOR v_id IN
    SELECT DISTINCT event_id
    FROM (
      SELECT event_id FROM public.tickets WHERE event_id IS NOT NULL
      UNION
      SELECT event_id FROM public.orders WHERE event_id IS NOT NULL
      UNION
      SELECT event_id FROM public.order_addons WHERE event_id IS NOT NULL
    ) x
  LOOP
    PERFORM public.recompute_event_financials(v_id);
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
