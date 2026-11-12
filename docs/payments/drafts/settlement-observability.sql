BEGIN;
ALTER TABLE dvnt_settlement.controls ADD COLUMN last_worker_started_at timestamptz,
 ADD COLUMN last_worker_completed_at timestamptz, ADD COLUMN last_worker_error_at timestamptz,
 ADD COLUMN last_worker_summary jsonb,
 ADD COLUMN platform_payout_policy_verified boolean, ADD COLUMN platform_payout_policy_checked_at timestamptz;
-- Advance before work, so a killed invocation cannot pin the first phase.
ALTER TABLE dvnt_settlement.controls ADD COLUMN worker_phase integer NOT NULL DEFAULT 0 CHECK(worker_phase BETWEEN 0 AND 4);
CREATE FUNCTION public.settlement_worker_next_phase() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE phase integer;
BEGIN
 UPDATE dvnt_settlement.controls SET worker_phase=(worker_phase+1)%5 WHERE singleton
 RETURNING (worker_phase+4)%5 INTO phase;
 RETURN phase;
END $$;
REVOKE ALL ON FUNCTION public.settlement_worker_next_phase() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_worker_next_phase() TO service_role;
-- Operational attention only; these rows never authorize financial retries.
CREATE TABLE dvnt_settlement.runtime_attention(
 phase text NOT NULL CHECK(phase IN ('refund','recovery','bank','order','cleanup')),
 work_key text NOT NULL CHECK(length(work_key) BETWEEN 1 AND 200),
 first_exhausted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_exhausted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(phase,work_key)
);
REVOKE ALL ON dvnt_settlement.runtime_attention FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_runtime_observation(p_phase text,p_work_key text,p_outcome text,p_run_started_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_phase IS NULL OR p_phase NOT IN ('refund','recovery','bank','order','cleanup') OR p_work_key IS NULL
  OR length(p_work_key) NOT BETWEEN 1 AND 200 OR p_outcome IS NULL OR p_outcome NOT IN ('budget','completed')
  OR p_run_started_at IS NULL OR NOT isfinite(p_run_started_at) OR p_run_started_at>clock_timestamp()
 THEN RAISE EXCEPTION 'invalid runtime observation'; END IF;
 IF p_outcome='budget' THEN
  INSERT INTO dvnt_settlement.runtime_attention(phase,work_key) VALUES(p_phase,p_work_key)
  ON CONFLICT(phase,work_key) DO UPDATE SET last_exhausted_at=clock_timestamp();
 ELSE
  -- An older overlapping invocation must not erase a newer exhausted attempt.
  DELETE FROM dvnt_settlement.runtime_attention WHERE phase=p_phase AND work_key=p_work_key
   AND last_exhausted_at<p_run_started_at;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.settlement_runtime_observation(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_runtime_observation(text,text,text,timestamptz) TO service_role;
CREATE FUNCTION public.settlement_worker_observation(p_phase text,p_summary jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_phase NOT IN ('started','completed','error') THEN RAISE EXCEPTION 'unknown worker phase'; END IF;
 UPDATE dvnt_settlement.controls SET
 last_worker_started_at=CASE WHEN p_phase='started' THEN clock_timestamp() ELSE last_worker_started_at END,
 last_worker_completed_at=CASE WHEN p_phase='completed' THEN clock_timestamp() ELSE last_worker_completed_at END,
 last_worker_error_at=CASE WHEN p_phase='error' THEN clock_timestamp() ELSE last_worker_error_at END,
 last_worker_summary=p_summary WHERE singleton;
 RETURN jsonb_build_object('ok',true,'observed_at',clock_timestamp());
END $$;
CREATE FUNCTION public.settlement_platform_policy_observation(p_verified boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_verified IS NULL THEN RAISE EXCEPTION 'policy observation required'; END IF;
 UPDATE dvnt_settlement.controls SET platform_payout_policy_verified=p_verified,platform_payout_policy_checked_at=now() WHERE singleton;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.settlement_platform_policy_observation(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_platform_policy_observation(boolean) TO service_role;
CREATE FUNCTION public.settlement_health() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('checkout_enabled',c.checkout_enabled,'transfers_enabled',c.transfers_enabled,
 'recovery_enabled',c.recovery_enabled,'release_policy_configured',EXISTS(SELECT 1 FROM dvnt_settlement.release_policies),
 'platform_payout_policy_verified',c.platform_payout_policy_verified,'platform_payout_policy_checked_at',c.platform_payout_policy_checked_at,
 'schedule_verified',false,'last_started_at',c.last_worker_started_at,'last_completed_at',c.last_worker_completed_at,
 'last_error_at',c.last_worker_error_at,'last_summary',c.last_worker_summary,
 'worker_never_completed',c.last_worker_completed_at IS NULL,
 'oldest_due_at',(SELECT min(due_at) FROM (
  SELECT greatest(s.release_at,coalesce(dvnt_settlement.event_release_at(o.event_id),s.release_at)) AS due_at
  FROM dvnt_settlement.orders s JOIN public.orders o ON o.id=s.order_id
  JOIN dvnt_settlement.allocations a ON a.order_id=s.order_id JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
  WHERE d.state IN ('held','reserved','uncertain') AND a.amount_cents>0
   AND NOT (a.role='promoter' AND dvnt_settlement.promoter_obligation_satisfied(a.id))
  UNION ALL
  SELECT greatest(c.release_not_before,coalesce(dvnt_settlement.event_release_at(o.event_id),c.release_not_before))
  FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id
  WHERE o.status IN ('paid','partially_refunded','refunded','disputed')
   AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.orders s WHERE s.order_id=c.order_id)
 ) obligations WHERE due_at<=now()),
 -- Separate operational observation: a provider outcome is unknown, not a
 -- declaration that payment or a debt exists. Future events remain quiet.
 'oldest_checkout_outcome_unknown_at',(SELECT min(greatest(c.outcome_unknown_since,c.release_not_before,dvnt_settlement.event_release_at(o.event_id)))
  FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id
  WHERE c.outcome_unknown_since IS NOT NULL AND c.retired_at IS NULL
   AND greatest(c.release_not_before,dvnt_settlement.event_release_at(o.event_id))<=now()
   AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.orders s WHERE s.order_id=c.order_id)),
 'blocked_order_count',(SELECT count(*) FROM dvnt_settlement.checkouts WHERE last_error IS NOT NULL),
 'onboarding_or_account_blocked',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error IN ('onboarding_required','recipient_restricted')),
 'organizer_waiting_on_promoter',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error='promoter_pending'),
 'held_promoter_liabilities',(SELECT coalesce(jsonb_object_agg(currency,cents),'{}'::jsonb) FROM (
  SELECT s.currency,sum(a.amount_cents) AS cents FROM dvnt_settlement.allocations a
  JOIN dvnt_settlement.orders s ON s.order_id=a.order_id JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
  WHERE a.role='promoter' AND d.state IN ('held','reserved','uncertain')
   AND NOT dvnt_settlement.promoter_obligation_satisfied(a.id) GROUP BY s.currency) p),
 'funding_blocked',(SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error='funding_required'),
 'runtime_budget_blocked',(SELECT count(*) FROM dvnt_settlement.runtime_attention)+
  (SELECT count(*) FROM dvnt_settlement.checkouts WHERE last_error='runtime_budget_required')+
  (SELECT count(*) FROM dvnt_settlement.deliveries WHERE last_error='runtime_budget_required'),
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
