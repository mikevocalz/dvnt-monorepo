-- Incremental reporting-cache-only fairness; never reapply the cache creation.
-- No enrollment, financial-source mutations, freshness changes or cron changes.
BEGIN;
ALTER TABLE public.platform_fee_reports ADD COLUMN IF NOT EXISTS last_claimed_at timestamptz;
COMMENT ON COLUMN public.platform_fee_reports.last_claimed_at IS
 'Reporting queue fairness cursor; least recently claimed owner/month runs first.';
CREATE OR REPLACE FUNCTION public.claim_platform_fee_snapshots(p_limit integer DEFAULT 10)
RETURNS SETOF public.platform_fee_snapshots LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r platform_fee_snapshots%ROWTYPE; cohort platform_fee_reports%ROWTYPE; i integer;
BEGIN
 -- Terminalize a bounded invalid page, but filter ALL invalid rows out of
 -- the subsequent claim so an empty invalid page cannot hide valid work.
 WITH invalid AS (
 SELECT payment_intent_id FROM platform_fee_snapshots
 WHERE status IN ('pending','refreshing') AND (status='pending' OR leased_until<=clock_timestamp())
 AND (attempts>=5 OR NOT platform_fee_snapshot_scope_valid(payment_intent_id,auth_id,month_start,month_end,order_ids,expected_fee_cents,currency))
 ORDER BY available_at,created_at,payment_intent_id LIMIT 100 FOR UPDATE SKIP LOCKED
 ) UPDATE platform_fee_snapshots s SET status='failed',last_error='source_scope_or_attempts_exhausted',
 amount_cents=NULL,refunded_cents=NULL,verified_at=NULL,staged_amount_cents=NULL,staged_refunded_cents=NULL,staged_verified_at=NULL,
 lease_token=NULL,leased_until=NULL,updated_at=clock_timestamp()
 FROM invalid i WHERE s.payment_intent_id=i.payment_intent_id;
 -- Persist fairness across groups and invocations, not just within a batch.
 -- Lock the cohort before a row, matching enrollment; both use SKIP LOCKED in
 -- this worker, so an overlapping claim/completion never blocks this picker.
 FOR i IN 1..greatest(1,least(coalesce(p_limit,10),25)) LOOP
 SELECT report.* INTO cohort FROM platform_fee_reports report
 WHERE report.target_state='pending' AND report.target_invalid=0
 AND EXISTS(SELECT 1 FROM platform_fee_snapshots s
   WHERE s.auth_id=report.auth_id AND s.month_start=report.month_start
   AND s.order_ids<@report.target_order_ids
   AND s.status IN ('pending','refreshing') AND s.available_at<=clock_timestamp()
   AND s.attempts<5 AND (s.status='pending' OR s.leased_until<=clock_timestamp())
   AND platform_fee_snapshot_scope_valid(s.payment_intent_id,s.auth_id,s.month_start,s.month_end,s.order_ids,s.expected_fee_cents,s.currency))
 ORDER BY report.last_claimed_at NULLS FIRST,report.target_started_at,report.auth_id,report.month_start
 LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN EXIT; END IF;
 SELECT s.* INTO r FROM platform_fee_snapshots s
 WHERE s.auth_id=cohort.auth_id AND s.month_start=cohort.month_start
 AND s.order_ids<@cohort.target_order_ids
 AND s.status IN ('pending','refreshing') AND s.available_at<=clock_timestamp()
 AND s.attempts<5 AND (s.status='pending' OR s.leased_until<=clock_timestamp())
 AND platform_fee_snapshot_scope_valid(s.payment_intent_id,s.auth_id,s.month_start,s.month_end,s.order_ids,s.expected_fee_cents,s.currency)
 ORDER BY s.available_at,s.created_at,s.payment_intent_id LIMIT 1 FOR UPDATE SKIP LOCKED;
 -- Another invocation can own the eligible rows. Rotate this cohort rather
 -- than spin on it, without changing evidence, target membership or attempts.
 UPDATE platform_fee_reports SET last_claimed_at=greatest(clock_timestamp(),coalesce(last_claimed_at,'-infinity'::timestamptz)+interval '1 microsecond')
 WHERE auth_id=cohort.auth_id AND month_start=cohort.month_start;
 IF r.payment_intent_id IS NULL THEN CONTINUE; END IF;
 IF NOT platform_fee_snapshot_scope_valid(r.payment_intent_id,r.auth_id,r.month_start,r.month_end,r.order_ids,r.expected_fee_cents,r.currency) THEN
 UPDATE platform_fee_snapshots SET status='failed',last_error='source_scope_changed',amount_cents=NULL,refunded_cents=NULL,verified_at=NULL,staged_amount_cents=NULL,staged_refunded_cents=NULL,staged_verified_at=NULL,lease_token=NULL,leased_until=NULL,updated_at=clock_timestamp() WHERE payment_intent_id=r.payment_intent_id;
 CONTINUE;
 END IF;
 UPDATE platform_fee_snapshots SET status='refreshing',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
 WHERE payment_intent_id=r.payment_intent_id RETURNING * INTO r;
 RETURN NEXT r;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.claim_platform_fee_snapshots(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_fee_snapshots(integer) TO service_role;
COMMIT;
