BEGIN;
-- Observation only. Inventory is not scheduler activation or proof of alert delivery.
CREATE FUNCTION dvnt_settlement.schedule_inventory() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE n int; visible boolean:=to_regclass('cron.job') IS NOT NULL;
BEGIN
 IF visible THEN
  EXECUTE $q$ SELECT count(*)::int FROM cron.job WHERE active AND
   (command LIKE '%/functions/v1/settlements-process%' OR command ~ '\mcron_settlements_process\M') $q$ INTO n;
 END IF;
 RETURN jsonb_build_object('scheduler_visible',visible,'active_schedules',n);
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.schedule_inventory() FROM PUBLIC,anon,authenticated,service_role;

-- A typed queue, not a fictitious Refund or provider reversal. Lost/won dispute
-- resolution needs verified dispute evidence and an operator decision. No hold
-- is cleared by observation, and original allocations remain immutable.
CREATE VIEW dvnt_settlement.manual_review_queue AS
 SELECT DISTINCT s.order_id,
 CASE WHEN o.status='refunded' THEN 'dispute_refund_state_review'
 ELSE 'dispute_resolution_review' END::text AS reason
 FROM dvnt_settlement.orders s JOIN public.orders o ON o.id=s.order_id
 WHERE EXISTS(SELECT 1 FROM dvnt_settlement.holds h WHERE h.order_id=s.order_id AND h.reason='dispute')
 UNION
 SELECT a.order_id,'missing_recovery_evidence'::text
 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
 WHERE d.state='recovery_required' AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.recoveries r WHERE r.allocation_id=a.id)
 UNION SELECT order_id,'dispute_currency_outflow_review'::text FROM dvnt_settlement.dispute_outflows
 UNION SELECT order_id,'refund_outcome_review'::text FROM dvnt_settlement.refund_outflows
 WHERE state='uncertain' OR (state IN('attempted','submitted') AND created_at<now()-interval '90 minutes');
REVOKE ALL ON dvnt_settlement.manual_review_queue FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_manual_review_queue() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM dvnt_settlement.manual_review_queue q;
$$;
REVOKE ALL ON FUNCTION public.settlement_manual_review_queue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_manual_review_queue() TO service_role;

ALTER FUNCTION public.settlement_health() RENAME TO settlement_health_base;
REVOKE ALL ON FUNCTION public.settlement_health_base() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; external_health jsonb;
BEGIN
 SELECT public.settlement_health_base() || dvnt_settlement.schedule_inventory() || jsonb_build_object(
  'observed_at',now(),'worker_expected',c.checkout_enabled OR c.transfers_enabled OR c.recovery_enabled,
  'schedule_verified',coalesce((dvnt_settlement.schedule_inventory()->>'active_schedules')::int=1
   AND c.last_worker_completed_at>now()-interval '90 minutes',false),
  'platform_payout_policy_blocked',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error='platform_payout_policy_unverified'),
  'manual_review_count',(SELECT count(*) FROM dvnt_settlement.manual_review_queue)) INTO result
 FROM dvnt_settlement.controls c WHERE singleton;
 -- External draft is assembled last. Late-bound so the override definitions
 -- keep their ordering, but missing external observation never returns green.
 SELECT public.settlement_external_recovery_health() INTO external_health;
 RETURN result || external_health || jsonb_build_object('manual_review_count',
  (result->>'manual_review_count')::bigint+(external_health->>'external_recovery_review_required')::bigint);
END $$;
REVOKE ALL ON FUNCTION public.settlement_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_health() TO service_role;

CREATE TABLE dvnt_settlement.readiness_alert_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),issue_codes text[] NOT NULL DEFAULT '{}',last_alerted_at timestamptz
);
ALTER TABLE dvnt_settlement.readiness_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.readiness_alert_state FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_settlement_readiness_alert(p_issue_codes text[]) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE codes text[]; claimed boolean;
BEGIN
 IF p_issue_codes IS NULL OR cardinality(p_issue_codes)>12 OR EXISTS(SELECT 1 FROM unnest(p_issue_codes) code WHERE code IS NULL OR code NOT IN
 ('snapshot_unavailable','checkout_outcome_unknown','due_settlement_attention','bank_delivery_failed','platform_payout_policy_unverified','manual_recovery_review','scheduler_unverified','scheduler_missing','scheduler_duplicate','worker_never_completed','worker_stale','worker_failed'))
 THEN RAISE EXCEPTION 'invalid settlement readiness codes'; END IF;
 SELECT coalesce(array_agg(DISTINCT code ORDER BY code),'{}'::text[]) INTO codes FROM unnest(p_issue_codes) code;
 INSERT INTO dvnt_settlement.readiness_alert_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM dvnt_settlement.readiness_alert_state WHERE singleton FOR UPDATE;
 IF cardinality(codes)=0 THEN
  UPDATE dvnt_settlement.readiness_alert_state SET issue_codes=codes,last_alerted_at=NULL WHERE singleton; RETURN false;
 END IF;
 UPDATE dvnt_settlement.readiness_alert_state SET issue_codes=codes,last_alerted_at=now()
 WHERE singleton AND (last_alerted_at IS NULL OR last_alerted_at<=now()-interval '1 hour' OR issue_codes IS DISTINCT FROM codes);
 claimed:=FOUND; RETURN claimed;
END $$;
REVOKE ALL ON FUNCTION public.claim_settlement_readiness_alert(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_settlement_readiness_alert(text[]) TO service_role;
COMMIT;
