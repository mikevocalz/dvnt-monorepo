BEGIN;
ALTER TABLE dvnt_settlement.controls ADD COLUMN last_worker_started_at timestamptz,
 ADD COLUMN last_worker_completed_at timestamptz, ADD COLUMN last_worker_error_at timestamptz,
 ADD COLUMN last_worker_summary jsonb;
CREATE FUNCTION public.settlement_worker_observation(p_phase text,p_summary jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_phase NOT IN ('started','completed','error') THEN RAISE EXCEPTION 'unknown worker phase'; END IF;
 UPDATE dvnt_settlement.controls SET
 last_worker_started_at=CASE WHEN p_phase='started' THEN clock_timestamp() ELSE last_worker_started_at END,
 last_worker_completed_at=CASE WHEN p_phase='completed' THEN clock_timestamp() ELSE last_worker_completed_at END,
 last_worker_error_at=CASE WHEN p_phase='error' THEN clock_timestamp() ELSE last_worker_error_at END,
 last_worker_summary=p_summary WHERE singleton;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.settlement_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('checkout_enabled',c.checkout_enabled,'transfers_enabled',c.transfers_enabled,
 'recovery_enabled',c.recovery_enabled,'release_policy_configured',c.release_delay_seconds IS NOT NULL,
 'schedule_verified',false,'last_started_at',c.last_worker_started_at,'last_completed_at',c.last_worker_completed_at,
 'last_error_at',c.last_worker_error_at,'last_summary',c.last_worker_summary,
 'worker_never_completed',c.last_worker_completed_at IS NULL,
 'oldest_due_at',(SELECT min(s.release_at) FROM dvnt_settlement.orders s JOIN dvnt_settlement.allocations a ON a.order_id=s.order_id
  JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id WHERE d.state IN ('held','reserved','uncertain') AND s.release_at<=now()),
 'blocked_order_count',(SELECT count(*) FROM dvnt_settlement.checkouts WHERE last_error IS NOT NULL),
 'onboarding_or_account_blocked',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error IN ('onboarding_required','recipient_restricted')),
 'organizer_waiting_on_promoter',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error='promoter_pending'),
 'held_promoter_liabilities',(SELECT coalesce(jsonb_object_agg(currency,cents),'{}'::jsonb) FROM (
  SELECT s.currency,sum(a.amount_cents) AS cents FROM dvnt_settlement.allocations a
  JOIN dvnt_settlement.orders s ON s.order_id=a.order_id JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
  WHERE a.role='promoter' AND d.state IN ('held','reserved','uncertain')
   AND NOT dvnt_settlement.promoter_obligation_satisfied(a.id) GROUP BY s.currency) p),
 'funding_blocked',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error='funding_required'),
 'source_audit_blocked',(SELECT count(*) FROM dvnt_settlement.checkouts WHERE last_error IN ('source_audit_limit','source_verification_stale'))+
  (SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error IN ('source_audit_limit','source_verification_stale')),
 'uncertain_transfers',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE state IN ('reserved','uncertain')),
 'recovery_due',(SELECT count(*) FROM dvnt_settlement.recoveries WHERE state<>'recovered'),
 'quarantined_refunds',(SELECT count(*) FROM dvnt_settlement.refunds WHERE state='quarantined'),
 'unverified_bank_deliveries',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE state='transferred' AND bank_payout_state='unverified'),
 'failed_bank_deliveries',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE bank_payout_state='failed'))
 FROM dvnt_settlement.controls c WHERE singleton;
$$;
REVOKE ALL ON FUNCTION public.settlement_worker_observation(text,jsonb),public.settlement_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_worker_observation(text,jsonb),public.settlement_health() TO service_role;
CREATE OR REPLACE FUNCTION public.settlement_actor_summary(p_actor text,p_event_id int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('verified',true,'rows',coalesce(jsonb_agg(to_jsonb(summary)),'[]'::jsonb)) FROM (
 SELECT s.currency,a.role AS recipient_role,
 CASE WHEN d.state IN ('uncertain','recovery_required') OR d.last_error IS NOT NULL THEN 'needs_review'
 WHEN d.state='held' THEN 'awaiting_settlement'
 WHEN d.state='reserved' THEN 'transfer_submitted'
 WHEN d.bank_payout_state='failed' THEN 'bank_failed'
 WHEN d.bank_payout_state='paid' THEN 'bank_paid'
 WHEN d.bank_payout_state='pending' THEN 'bank_pending'
 ELSE 'in_connected_balance' END AS stage,
 sum(a.amount_cents)::bigint AS amount_cents,count(*)::int AS allocation_count,
 CASE WHEN count(bp.allocation_id)=count(*) THEN sum((bp.proof->>'netContributionCents')::bigint) END AS bank_net_contribution_cents
 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.orders s ON s.order_id=a.order_id
 JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id LEFT JOIN dvnt_settlement.bank_proofs bp ON bp.allocation_id=a.id JOIN public.orders o ON o.id=a.order_id
 WHERE o.event_id=p_event_id AND p_actor IS NOT NULL AND a.recipient_user_id=p_actor
 GROUP BY s.currency,a.role,stage
 ) summary;
$$;


COMMIT;
