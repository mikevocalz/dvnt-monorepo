-- OPERATOR ARTIFACT ONLY. NOT AN AUTO-APPLIED MIGRATION.
-- Requires explicit approval for $950 fee reduction / $763 pre-promoter net
-- increase measured 2026-10-30, plus payout-execution coordination.
-- Apply corrected function first; no orders/tickets/payments/payouts are changed.
BEGIN;
CREATE TEMP TABLE free_unit_repair_targets ON COMMIT DROP AS
SELECT DISTINCT event_id FROM (
 SELECT event_id FROM public.tickets WHERE purchase_amount_cents = 0
   AND status NOT IN ('void','refunded')
 UNION SELECT event_id FROM public.order_addons WHERE unit_price_cents = 0
   AND status <> 'refunded'
) x WHERE event_id IS NOT NULL;
DO $$ DECLARE v_id integer; BEGIN
 IF (SELECT count(*) FROM free_unit_repair_targets) <> 26 THEN
   RAISE EXCEPTION 'Reviewed affected-event count changed; re-audit before repair';
 END IF;
 FOR v_id IN SELECT event_id FROM free_unit_repair_targets ORDER BY event_id LOOP
   PERFORM 1 FROM public.events WHERE id=v_id FOR UPDATE NOWAIT;
   PERFORM 1 FROM public.event_financials WHERE event_id=v_id FOR UPDATE NOWAIT;
   IF NOT FOUND THEN RAISE EXCEPTION 'Financial snapshot missing; re-audit'; END IF;
 END LOOP;
 IF EXISTS (SELECT 1 FROM public.events e JOIN free_unit_repair_targets t ON t.event_id=e.id
   WHERE e.payout_status IN ('released','processing')) THEN
   RAISE EXCEPTION 'Payout state changed; do not repair concurrently with payouts';
 END IF;
END $$;
CREATE TEMP TABLE free_unit_repair_before ON COMMIT DROP AS
SELECT f.* FROM public.event_financials f JOIN free_unit_repair_targets t USING(event_id);
DO $$ DECLARE v_id integer; v_fee_delta bigint; v_net_delta bigint; BEGIN
 FOR v_id IN SELECT event_id FROM free_unit_repair_targets ORDER BY event_id LOOP
   PERFORM public.recompute_event_financials(v_id);
 END LOOP;
 SELECT sum(b.dvnt_fee_cents-f.dvnt_fee_cents),sum(f.net_cents-b.net_cents)
 INTO v_fee_delta,v_net_delta FROM free_unit_repair_before b
 JOIN public.event_financials f USING(event_id);
 IF v_fee_delta IS DISTINCT FROM 95000 OR v_net_delta IS DISTINCT FROM 76300 THEN
   RAISE EXCEPTION 'Reviewed accounting delta changed (fee %, net %); repair rolled back',v_fee_delta,v_net_delta;
 END IF;
 IF EXISTS (SELECT 1 FROM free_unit_repair_before b JOIN public.event_financials f USING(event_id)
   WHERE b.gross_cents IS DISTINCT FROM f.gross_cents OR b.refunds_cents IS DISTINCT FROM f.refunds_cents
      OR b.stripe_fee_cents IS DISTINCT FROM f.stripe_fee_cents) THEN
   RAISE EXCEPTION 'Unexpected non-platform monetary change; repair rolled back';
 END IF;
END $$;
COMMIT;
