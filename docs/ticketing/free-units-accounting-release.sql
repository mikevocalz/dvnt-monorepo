-- GENERIC TRANSACTIONAL RELEASE TEMPLATE.
-- Supply separately reviewed private bounds for every __EXPECTED_*__ token.
-- No private production measurements belong in this repository.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';
-- Freeze all financial source rows, including first free units on new events.
-- NOWAIT refuses active writers; subsequent writers wait only until this transaction ends.
LOCK TABLE public.tickets, public.order_addons, public.orders IN SHARE MODE NOWAIT;
-- SOURCE ONLY until explicit accounting approval. Free tickets stay $0 always.
-- Replace the old all-unit count and the later mixed-cart fee fallback with
-- strictly positive-price fee units. Zero/unknown-price units never create fees.
-- This changes future recomputations and therefore future payout net. No payment,
-- order, refund, transfer or payout status is changed. No cached backfill here.
-- Existing function ownership and grants are preserved by CREATE OR REPLACE.

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


-- GENERIC OPERATOR TEMPLATE, not an automatic migration.
-- Replace every __EXPECTED_*__ token using separately reviewed private bounds.
-- Missing substitutions fail closed. Coordinate against payout execution.
CREATE TEMP TABLE free_unit_repair_targets ON COMMIT DROP AS
SELECT DISTINCT event_id FROM (
 SELECT event_id FROM public.tickets WHERE purchase_amount_cents = 0
   AND status NOT IN ('void','refunded')
 UNION SELECT event_id FROM public.order_addons WHERE unit_price_cents = 0
   AND status <> 'refunded'
) x WHERE event_id IS NOT NULL;
DO $$ DECLARE v_id integer; BEGIN
 IF (SELECT count(*) FROM public.tickets WHERE purchase_amount_cents=0 AND status NOT IN ('void','refunded')) <> __EXPECTED_FREE_TICKET_COUNT__
   OR EXISTS(SELECT 1 FROM public.tickets WHERE (purchase_amount_cents IS NULL OR purchase_amount_cents<0) AND status NOT IN ('void','refunded'))
   OR EXISTS(SELECT 1 FROM public.order_addons WHERE (unit_price_cents IS NULL OR unit_price_cents<0) AND status<>'refunded') THEN
   RAISE EXCEPTION 'Reviewed free/unknown unit counts changed; re-audit before repair';
 END IF;
 IF (SELECT count(*) FROM free_unit_repair_targets) <> __EXPECTED_EVENT_COUNT__ THEN
   RAISE EXCEPTION 'Reviewed affected-event count changed; re-audit before repair';
 END IF;
 FOR v_id IN SELECT event_id FROM free_unit_repair_targets ORDER BY event_id LOOP
   PERFORM 1 FROM public.events WHERE id=v_id FOR UPDATE NOWAIT;
   PERFORM 1 FROM public.event_financials WHERE event_id=v_id FOR UPDATE NOWAIT;
   IF NOT FOUND THEN RAISE EXCEPTION 'Financial snapshot missing; re-audit'; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM public.events e JOIN free_unit_repair_targets t ON t.event_id=e.id
   WHERE e.payout_status IS DISTINCT FROM 'pending') THEN
   RAISE EXCEPTION 'Payout state changed; do not repair concurrently with payouts';
 END IF;
END $$;
CREATE TEMP TABLE free_unit_repair_before ON COMMIT DROP AS
SELECT f.* FROM public.event_financials f JOIN free_unit_repair_targets t USING(event_id);
DO $$ DECLARE v_id integer; v_fee_delta bigint; v_net_delta bigint; v_net_events integer; BEGIN
 IF EXISTS(SELECT 1 FROM free_unit_repair_before WHERE gross_cents IS NULL OR refunds_cents IS NULL
   OR dvnt_fee_cents IS NULL OR stripe_fee_cents IS NULL OR net_cents IS NULL) THEN
   RAISE EXCEPTION 'Financial snapshot contains unknown money; re-audit';
 END IF;
 FOR v_id IN SELECT event_id FROM free_unit_repair_targets ORDER BY event_id LOOP
   PERFORM public.recompute_event_financials(v_id);
 END LOOP;
 SELECT sum(b.dvnt_fee_cents-f.dvnt_fee_cents),sum(f.net_cents-b.net_cents),count(*) FILTER(WHERE f.net_cents>b.net_cents)
 INTO v_fee_delta,v_net_delta,v_net_events FROM free_unit_repair_before b
 JOIN public.event_financials f USING(event_id);
 IF v_fee_delta IS DISTINCT FROM __EXPECTED_FEE_REDUCTION_CENTS__ OR v_net_delta IS DISTINCT FROM __EXPECTED_NET_INCREASE_CENTS__ OR v_net_events IS DISTINCT FROM __EXPECTED_NET_EVENT_COUNT__ THEN
   RAISE EXCEPTION 'Reviewed accounting delta changed (fee %, net %); repair rolled back',v_fee_delta,v_net_delta;
 END IF;
 IF EXISTS (SELECT 1 FROM free_unit_repair_before b JOIN public.event_financials f USING(event_id)
   WHERE b.gross_cents IS DISTINCT FROM f.gross_cents OR b.refunds_cents IS DISTINCT FROM f.refunds_cents
      OR b.stripe_fee_cents IS DISTINCT FROM f.stripe_fee_cents) THEN
   RAISE EXCEPTION 'Unexpected non-platform monetary change; repair rolled back';
 END IF;
END $$;

COMMIT;
