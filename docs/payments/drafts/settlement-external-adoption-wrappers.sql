-- Future runtime adoption only. Keep event→source→controls ordering with the
-- reported-payment quarantine transaction. Never wrap reconciliation of money
-- that might already have been sent: those outcomes remain recordable/reviewable.
ALTER FUNCTION public.settlement_reserve(uuid,text,bigint,bigint) RENAME TO reserve_before_external_event;
ALTER FUNCTION public.reserve_before_external_event(uuid,text,bigint,bigint) SET SCHEMA dvnt_settlement;
CREATE FUNCTION public.settlement_reserve(p_allocation uuid,p_destination text,p_available bigint,p_balance_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM dvnt_settlement.assert_no_external_event_quarantine((SELECT order_id FROM dvnt_settlement.allocations WHERE id=p_allocation));
 RETURN dvnt_settlement.reserve_before_external_event(p_allocation,p_destination,p_available,p_balance_epoch);
END $$;
ALTER FUNCTION dvnt_settlement.reserve(uuid,text) RENAME TO reserve_before_external_event;
CREATE FUNCTION dvnt_settlement.reserve(p_allocation uuid,p_destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM dvnt_settlement.assert_no_external_event_quarantine((SELECT order_id FROM dvnt_settlement.allocations WHERE id=p_allocation));
 RETURN dvnt_settlement.reserve_before_external_event(p_allocation,p_destination);
END $$;
ALTER FUNCTION public.settlement_verify_source(uuid,text,text,text,bigint,bigint) RENAME TO verify_source_before_external_event;
ALTER FUNCTION public.verify_source_before_external_event(uuid,text,text,text,bigint,bigint) SET SCHEMA dvnt_settlement;
CREATE FUNCTION public.settlement_verify_source(p_order_id uuid,p_charge text,p_pi text,p_currency text,p_gross bigint,p_tax bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM dvnt_settlement.assert_no_external_event_quarantine(p_order_id);
 RETURN dvnt_settlement.verify_source_before_external_event(p_order_id,p_charge,p_pi,p_currency,p_gross,p_tax);
END $$;
ALTER FUNCTION dvnt_settlement.enroll(uuid,text,text,text,bigint,timestamptz) RENAME TO enroll_before_external_event;
CREATE FUNCTION dvnt_settlement.enroll(p_order uuid,p_charge text,p_pi text,p_currency text,p_gross bigint,p_release_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM dvnt_settlement.assert_no_external_event_quarantine(p_order);
 PERFORM dvnt_settlement.enroll_before_external_event(p_order,p_charge,p_pi,p_currency,p_gross,p_release_at);
END $$;
ALTER FUNCTION public.claim_settlement_checkout(uuid,jsonb) RENAME TO claim_checkout_before_external_event;
ALTER FUNCTION public.claim_checkout_before_external_event(uuid,jsonb) SET SCHEMA dvnt_settlement;
CREATE FUNCTION public.claim_settlement_checkout(p_order_id uuid,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM dvnt_settlement.assert_no_external_event_quarantine(p_order_id);
 RETURN dvnt_settlement.claim_checkout_before_external_event(p_order_id,p_params);
END $$;
ALTER FUNCTION public.prepare_settlement_checkout(jsonb,text) RENAME TO prepare_checkout_before_external_event;
ALTER FUNCTION public.prepare_checkout_before_external_event(jsonb,text) SET SCHEMA dvnt_settlement;
CREATE FUNCTION public.prepare_settlement_checkout(p_snapshot jsonb,p_request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid int := (p_snapshot->'order'->>'event_id')::int;
BEGIN
 -- No source order exists yet. Match the report's first lock before its helper
 -- creates an order, then let the original API validate the complete snapshot.
 PERFORM 1 FROM public.events WHERE id=eid FOR SHARE;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_quarantines WHERE event_id=eid)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=eid)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_reviews WHERE event_id=eid)
 THEN RAISE EXCEPTION 'external payment event quarantine blocks runtime checkout'; END IF;
 RETURN dvnt_settlement.prepare_checkout_before_external_event(p_snapshot,p_request_key);
END $$;
REVOKE ALL ON FUNCTION public.settlement_reserve(uuid,text,bigint,bigint),public.settlement_verify_source(uuid,text,text,text,bigint,bigint),public.claim_settlement_checkout(uuid,jsonb),public.prepare_settlement_checkout(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_reserve(uuid,text,bigint,bigint),public.settlement_verify_source(uuid,text,text,text,bigint,bigint),public.claim_settlement_checkout(uuid,jsonb),public.prepare_settlement_checkout(jsonb,text) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM PUBLIC,anon,authenticated,service_role;
