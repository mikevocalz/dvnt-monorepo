-- DRAFT: requires explicit approval before migration, enrollment or provider sync.
-- Empty queue only; never enrolls historical orders or changes money/ticket rows.
BEGIN;
CREATE TABLE public.platform_fee_snapshots (
 payment_intent_id text PRIMARY KEY, auth_id text NOT NULL,
 month_start timestamptz NOT NULL, month_end timestamptz NOT NULL,
 order_ids uuid[] NOT NULL CHECK(cardinality(order_ids)>0),
 expected_fee_cents bigint NOT NULL CHECK(expected_fee_cents>0), currency text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','refreshing','verified','failed')),
 amount_cents bigint,refunded_cents bigint,verified_at timestamptz,
 staged_amount_cents bigint,staged_refunded_cents bigint,staged_verified_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,leased_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(month_end>month_start)
);
ALTER TABLE public.platform_fee_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_fee_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.platform_fee_snapshots TO service_role;
CREATE INDEX platform_fee_snapshots_ready ON public.platform_fee_snapshots(available_at,created_at) WHERE status IN ('pending','refreshing');
CREATE INDEX platform_fee_snapshots_scope ON public.platform_fee_snapshots(auth_id,month_start);

-- Scope proof is repeated before any worker receives a PaymentIntent identifier.
CREATE FUNCTION public.platform_fee_snapshot_scope_valid(p_pi text,p_auth text,p_start timestamptz,p_end timestamptz,p_ids uuid[],p_fee bigint,p_currency text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT array_agg(o.id ORDER BY o.id)=p_ids
 AND bool_and(coalesce(e.host_id=p_auth AND o.type='event_ticket' AND o.status IN ('paid','partially_refunded','refunded')
 AND o.paid_at>=p_start AND o.paid_at<p_end AND o.paid_at<=now()
 AND lower(o.currency)=p_currency AND coalesce(o.charge_model,'destination_charge')='destination_charge'
 AND o.total_cents>=0 AND (o.total_cents>0 OR coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END)=0)
 AND coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END)>=0
 AND (o.platform_fee_cents IS NULL OR o.dvnt_total_fee_cents IS NULL OR o.platform_fee_cents=o.dvnt_total_fee_cents),false))
 AND sum(coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END))=p_fee
 FROM orders o LEFT JOIN events e ON e.id=o.event_id WHERE o.stripe_payment_intent_id=p_pi),false)
$$;

CREATE TABLE public.platform_fee_reports (
 auth_id text NOT NULL,month_start timestamptz NOT NULL,month_end timestamptz NOT NULL,
 target_through timestamptz NOT NULL,target_started_at timestamptz NOT NULL DEFAULT now(),
 target_order_ids uuid[] NOT NULL DEFAULT '{}',target_fingerprint jsonb,target_invalid integer NOT NULL DEFAULT 0,
 target_state text NOT NULL DEFAULT 'pending' CHECK(target_state IN ('pending','complete','failed')),
 published_through timestamptz,published_order_ids uuid[],published_fingerprint jsonb,
 published_amount_cents bigint,published_currency text,published_verified_at timestamptz,
 PRIMARY KEY(auth_id,month_start)
);
ALTER TABLE public.platform_fee_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_fee_reports FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.platform_fee_reports TO service_role;

-- A fingerprint is internal financial provenance, never returned to the browser.
CREATE FUNCTION public.platform_fee_report_source(p_auth text,p_ids uuid[],p_start timestamptz,p_end timestamptz,p_through timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_ids IS NOT DISTINCT FROM (
 SELECT coalesce(array_agg(all_orders.id ORDER BY all_orders.id),'{}'::uuid[]) FROM orders all_orders JOIN events all_events ON all_events.id=all_orders.event_id
 WHERE all_events.host_id=p_auth AND all_orders.type='event_ticket' AND all_orders.status IN ('paid','partially_refunded','refunded')
 AND all_orders.paid_at>=p_start AND all_orders.paid_at<p_end AND all_orders.paid_at<=p_through
 ) AND NOT EXISTS (
 SELECT 1 FROM orders sibling WHERE sibling.stripe_payment_intent_id IN (SELECT scoped.stripe_payment_intent_id FROM orders scoped WHERE scoped.id=ANY(p_ids) AND scoped.stripe_payment_intent_id IS NOT NULL)
 AND NOT(sibling.id=ANY(p_ids))
 ) AND count(o.id)=cardinality(p_ids) AND coalesce(bool_and(coalesce(
 e.host_id=p_auth AND o.type='event_ticket' AND o.status IN ('paid','partially_refunded','refunded')
 AND o.paid_at>=p_start AND o.paid_at<p_end AND o.paid_at<=p_through,false)),true)
 THEN coalesce(jsonb_agg(jsonb_build_array(o.id,o.event_id,o.stripe_payment_intent_id,o.currency,o.total_cents,o.platform_fee_cents,o.dvnt_total_fee_cents,o.paid_at,o.charge_model) ORDER BY o.id),'[]'::jsonb) END
 FROM unnest(p_ids) wanted(id) LEFT JOIN orders o ON o.id=wanted.id LEFT JOIN events e ON e.id=o.event_id
$$;

CREATE FUNCTION public.publish_platform_fee_report(p_auth text,p_start timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r platform_fee_reports%ROWTYPE;g record;s platform_fee_snapshots%ROWTYPE;v_amount bigint:=0;v_oldest timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO r FROM platform_fee_reports WHERE auth_id=p_auth AND month_start=p_start FOR UPDATE;
 IF NOT FOUND OR r.target_state<>'pending' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM platform_fee_snapshots queued WHERE queued.auth_id=p_auth AND queued.month_start=p_start AND queued.order_ids<@r.target_order_ids AND queued.status='failed') THEN
 UPDATE platform_fee_reports SET target_state='failed' WHERE auth_id=p_auth AND month_start=p_start;RETURN;END IF;
 -- Avoid rescanning every source order and snapshot for each individual
 -- completion. Full provenance is checked once the target queue is drained.
 IF EXISTS(SELECT 1 FROM platform_fee_snapshots queued WHERE queued.auth_id=p_auth AND queued.month_start=p_start AND queued.order_ids<@r.target_order_ids AND queued.status IN ('pending','refreshing')) THEN RETURN;END IF;
 IF r.target_invalid>0 OR r.target_fingerprint IS NULL OR platform_fee_report_source(r.auth_id,r.target_order_ids,r.month_start,r.month_end,r.target_through) IS DISTINCT FROM r.target_fingerprint THEN
 UPDATE platform_fee_reports SET target_state='failed' WHERE auth_id=p_auth AND month_start=p_start;RETURN;END IF;
 FOR g IN SELECT o.stripe_payment_intent_id pi,array_agg(o.id ORDER BY o.id) ids,
 sum(coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END)) fee,
 bool_and(coalesce(o.total_cents=0,false)) all_free FROM orders o WHERE o.id=ANY(r.target_order_ids) GROUP BY o.stripe_payment_intent_id LOOP
 IF g.fee=0 AND g.all_free THEN CONTINUE;END IF;
 SELECT * INTO s FROM platform_fee_snapshots WHERE payment_intent_id=g.pi AND auth_id=p_auth AND month_start=p_start;
 IF NOT FOUND OR s.order_ids IS DISTINCT FROM g.ids OR s.expected_fee_cents IS DISTINCT FROM g.fee OR s.status='failed' THEN
 UPDATE platform_fee_reports SET target_state='failed' WHERE auth_id=p_auth AND month_start=p_start;RETURN;END IF;
 IF s.status<>'verified' OR s.staged_verified_at IS NULL OR s.staged_verified_at<r.target_started_at-interval '20 hours' THEN RETURN;END IF;
 IF s.staged_amount_cents IS DISTINCT FROM g.fee OR s.currency<>'usd' OR s.staged_refunded_cents IS NULL OR s.staged_refunded_cents<0 OR s.staged_refunded_cents>g.fee THEN
 UPDATE platform_fee_reports SET target_state='failed' WHERE auth_id=p_auth AND month_start=p_start;RETURN;END IF;
 v_amount:=v_amount+s.staged_amount_cents-s.staged_refunded_cents;
 v_oldest:=least(v_oldest,s.staged_verified_at);
 END LOOP;
 UPDATE platform_fee_reports SET target_state='complete',published_through=target_through,published_order_ids=target_order_ids,
 published_fingerprint=target_fingerprint,published_amount_cents=v_amount,published_currency=CASE WHEN cardinality(target_order_ids)=0 THEN NULL ELSE 'usd' END,published_verified_at=v_oldest
 WHERE auth_id=p_auth AND month_start=p_start;
END $$;

CREATE FUNCTION public.enroll_platform_fee_snapshots(p_auth_id text,p_month_start timestamptz,p_month_end timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE g record;s platform_fee_snapshots%ROWTYPE;r platform_fee_reports%ROWTYPE;v_invalid integer:=0;v_enrolled integer:=0;v_ids uuid[];v_through timestamptz:=clock_timestamp();v_new boolean;v_report jsonb;
BEGIN
 IF nullif(btrim(p_auth_id),'') IS NULL THEN RAISE insufficient_privilege USING MESSAGE='Not authorized'; END IF;
 IF p_month_start IS DISTINCT FROM (date_trunc('month',v_through AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York')
 OR p_month_end IS DISTINCT FROM ((date_trunc('month',v_through AT TIME ZONE 'America/New_York')+interval '1 month') AT TIME ZONE 'America/New_York')
 THEN RAISE invalid_parameter_value USING MESSAGE='Only the current reporting month can be enrolled'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('platform-fee-enrollment'),hashtext(p_auth_id||p_month_start::text));
 SELECT * INTO r FROM platform_fee_reports WHERE auth_id=p_auth_id AND month_start=p_month_start FOR UPDATE;
 v_new:=NOT FOUND;
 IF NOT v_new THEN
 PERFORM publish_platform_fee_report(p_auth_id,p_month_start);
 SELECT * INTO r FROM platform_fee_reports WHERE auth_id=p_auth_id AND month_start=p_month_start;
 v_new:=r.target_state IN ('complete','failed') AND r.target_started_at<=v_through-interval '15 minutes';
 END IF;
 IF v_new THEN
 SELECT coalesce(array_agg(o.id ORDER BY o.id),'{}'::uuid[]) INTO v_ids FROM orders o JOIN events e ON e.id=o.event_id
 WHERE e.host_id=p_auth_id AND o.type='event_ticket' AND o.status IN ('paid','partially_refunded','refunded')
 AND o.paid_at>=p_month_start AND o.paid_at<p_month_end AND o.paid_at<=v_through;
 INSERT INTO platform_fee_reports(auth_id,month_start,month_end,target_through,target_started_at,target_order_ids,target_fingerprint)
 VALUES(p_auth_id,p_month_start,p_month_end,v_through,v_through,v_ids,platform_fee_report_source(p_auth_id,v_ids,p_month_start,p_month_end,v_through))
 ON CONFLICT(auth_id,month_start) DO UPDATE SET target_through=v_through,target_started_at=v_through,target_order_ids=v_ids,
 target_fingerprint=EXCLUDED.target_fingerprint,target_invalid=0,target_state='pending';
 FOR g IN SELECT o.stripe_payment_intent_id pi,array_agg(o.id ORDER BY o.id) ids,count(*)::integer n,
 sum(coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END)) fee,
 min(lower(o.currency)) currency,bool_and(coalesce(o.total_cents=0,false)) all_free,
 bool_and(coalesce(coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END)>=0
 AND (o.platform_fee_cents IS NULL OR o.dvnt_total_fee_cents IS NULL OR o.platform_fee_cents=o.dvnt_total_fee_cents)
 AND o.total_cents>=0 AND (o.total_cents>0 OR coalesce(o.platform_fee_cents,o.dvnt_total_fee_cents,CASE WHEN o.total_cents=0 THEN 0 END)=0) AND lower(o.currency)='usd' AND coalesce(o.charge_model,'destination_charge')='destination_charge',false)) valid
 FROM orders o WHERE o.id=ANY(v_ids) GROUP BY o.stripe_payment_intent_id LOOP
 IF g.valid IS DISTINCT FROM true OR g.fee IS NULL THEN v_invalid:=v_invalid+g.n;CONTINUE;END IF;
 IF g.fee=0 THEN IF NOT g.all_free THEN v_invalid:=v_invalid+g.n;END IF;CONTINUE;END IF;
 IF g.pi IS NULL OR g.pi !~ '^pi_[A-Za-z0-9]+$' OR NOT platform_fee_snapshot_scope_valid(g.pi,p_auth_id,p_month_start,p_month_end,g.ids,g.fee,g.currency) THEN v_invalid:=v_invalid+g.n;CONTINUE;END IF;
 SELECT * INTO s FROM platform_fee_snapshots WHERE payment_intent_id=g.pi FOR UPDATE;
 IF FOUND AND (s.auth_id<>p_auth_id OR s.month_start<>p_month_start OR s.month_end<>p_month_end) THEN v_invalid:=v_invalid+g.n;CONTINUE;END IF;
 INSERT INTO platform_fee_snapshots(payment_intent_id,auth_id,month_start,month_end,order_ids,expected_fee_cents,currency)
 VALUES(g.pi,p_auth_id,p_month_start,p_month_end,g.ids,g.fee,g.currency)
 ON CONFLICT(payment_intent_id) DO UPDATE SET order_ids=EXCLUDED.order_ids,expected_fee_cents=EXCLUDED.expected_fee_cents,currency=EXCLUDED.currency,
 status='pending',amount_cents=NULL,refunded_cents=NULL,verified_at=NULL,staged_amount_cents=NULL,staged_refunded_cents=NULL,staged_verified_at=NULL,
 available_at=v_through,attempts=0,lease_token=NULL,leased_until=NULL,last_error=NULL,updated_at=v_through
 WHERE platform_fee_snapshots.order_ids IS DISTINCT FROM EXCLUDED.order_ids
 OR platform_fee_snapshots.expected_fee_cents IS DISTINCT FROM EXCLUDED.expected_fee_cents
 OR platform_fee_snapshots.currency IS DISTINCT FROM EXCLUDED.currency
 OR platform_fee_snapshots.verified_at IS NULL OR platform_fee_snapshots.verified_at<v_through-interval '20 hours'
 OR platform_fee_snapshots.status IN ('pending','refreshing')
 OR (platform_fee_snapshots.status='failed' AND platform_fee_snapshots.available_at<=v_through);
 v_enrolled:=v_enrolled+1;
 END LOOP;
 UPDATE platform_fee_reports SET target_invalid=v_invalid,target_state=CASE WHEN v_invalid>0 THEN 'failed' ELSE 'pending' END WHERE auth_id=p_auth_id AND month_start=p_month_start;
 PERFORM publish_platform_fee_report(p_auth_id,p_month_start);
 END IF;
 SELECT * INTO r FROM platform_fee_reports WHERE auth_id=p_auth_id AND month_start=p_month_start;
 IF r.published_amount_cents IS NOT NULL AND r.published_fingerprint IS NOT NULL AND r.published_verified_at>=v_through-interval '24 hours'
 AND platform_fee_report_source(r.auth_id,r.published_order_ids,r.month_start,r.month_end,r.published_through) IS NOT DISTINCT FROM r.published_fingerprint THEN
 v_report:=jsonb_build_object('status','ready','amountCents',r.published_amount_cents,'currency',r.published_currency,'asOf',r.published_verified_at,'through',r.published_through);
 ELSE
 v_report:=jsonb_build_object('status',CASE WHEN r.target_state='failed' OR r.published_amount_cents IS NOT NULL THEN 'unavailable' ELSE 'pending' END,'amountCents',NULL,'currency','usd','asOf',NULL,'through',r.target_through);
 END IF;
 RETURN jsonb_build_object('ok',true,'enrolled',v_enrolled,'invalid',r.target_invalid,'expected_orders',cardinality(r.target_order_ids),'invalid_orders',r.target_invalid,'report',v_report);
END $$;

CREATE FUNCTION public.claim_platform_fee_snapshots(p_limit integer DEFAULT 10)
RETURNS SETOF public.platform_fee_snapshots LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r platform_fee_snapshots%ROWTYPE;
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
 FOR r IN SELECT * FROM platform_fee_snapshots WHERE status IN ('pending','refreshing') AND available_at<=clock_timestamp()
 AND EXISTS(SELECT 1 FROM platform_fee_reports report WHERE report.auth_id=platform_fee_snapshots.auth_id AND report.month_start=platform_fee_snapshots.month_start AND report.target_state='pending' AND report.target_invalid=0 AND platform_fee_snapshots.order_ids<@report.target_order_ids)
 AND attempts<5 AND platform_fee_snapshot_scope_valid(payment_intent_id,auth_id,month_start,month_end,order_ids,expected_fee_cents,currency)
 AND (status='pending' OR leased_until<=clock_timestamp())
 ORDER BY available_at,created_at,payment_intent_id LIMIT greatest(1,least(coalesce(p_limit,10),25)) FOR UPDATE SKIP LOCKED
 LOOP
 IF NOT platform_fee_snapshot_scope_valid(r.payment_intent_id,r.auth_id,r.month_start,r.month_end,r.order_ids,r.expected_fee_cents,r.currency) THEN
 UPDATE platform_fee_snapshots SET status='failed',last_error='source_scope_changed',amount_cents=NULL,refunded_cents=NULL,verified_at=NULL,staged_amount_cents=NULL,staged_refunded_cents=NULL,staged_verified_at=NULL,lease_token=NULL,leased_until=NULL,updated_at=clock_timestamp() WHERE payment_intent_id=r.payment_intent_id;
 CONTINUE;
 END IF;
 UPDATE platform_fee_snapshots SET status='refreshing',attempts=attempts+1,lease_token=gen_random_uuid(),leased_until=clock_timestamp()+interval '2 minutes',updated_at=clock_timestamp()
 WHERE payment_intent_id=r.payment_intent_id RETURNING * INTO r;
 RETURN NEXT r;
 END LOOP;
END $$;

CREATE FUNCTION public.complete_platform_fee_snapshot(p_payment_intent_id text,p_lease uuid,p_amount_cents bigint DEFAULT NULL,p_refunded_cents bigint DEFAULT NULL,p_currency text DEFAULT NULL,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r platform_fee_snapshots%ROWTYPE;v_error text:=p_error;
BEGIN
 SELECT * INTO r FROM platform_fee_snapshots WHERE payment_intent_id=p_payment_intent_id;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('platform-fee-enrollment'),hashtext(r.auth_id||r.month_start::text));
 SELECT * INTO r FROM platform_fee_snapshots WHERE payment_intent_id=p_payment_intent_id AND lease_token=p_lease AND status='refreshing' AND leased_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT platform_fee_snapshot_scope_valid(r.payment_intent_id,r.auth_id,r.month_start,r.month_end,r.order_ids,r.expected_fee_cents,r.currency) THEN v_error:='source_scope_changed'; END IF;
 IF v_error IS NULL AND (p_amount_cents IS DISTINCT FROM r.expected_fee_cents OR p_currency IS DISTINCT FROM r.currency
 OR p_refunded_cents IS NULL OR p_refunded_cents<0 OR p_refunded_cents>p_amount_cents) THEN v_error:='provider_fee_mismatch'; END IF;
 IF v_error IS NULL THEN
 UPDATE platform_fee_snapshots SET status='verified',amount_cents=p_amount_cents,refunded_cents=p_refunded_cents,verified_at=clock_timestamp(),staged_amount_cents=p_amount_cents,staged_refunded_cents=p_refunded_cents,staged_verified_at=clock_timestamp(),last_error=NULL,lease_token=NULL,leased_until=NULL,updated_at=clock_timestamp() WHERE payment_intent_id=r.payment_intent_id;

 PERFORM publish_platform_fee_report(r.auth_id,r.month_start);
 ELSE
 UPDATE platform_fee_snapshots SET status=CASE WHEN r.attempts>=5 OR v_error IN ('source_scope_changed','provider_fee_mismatch') THEN 'failed' ELSE 'pending' END,
 available_at=clock_timestamp()+make_interval(secs=>least(3600,30*(2^least(r.attempts,8))::integer)),last_error=left(v_error,100),
 amount_cents=CASE WHEN v_error='source_scope_changed' THEN NULL ELSE amount_cents END,
 refunded_cents=CASE WHEN v_error='source_scope_changed' THEN NULL ELSE refunded_cents END,
 verified_at=CASE WHEN v_error='source_scope_changed' THEN NULL ELSE verified_at END,
 staged_amount_cents=NULL,staged_refunded_cents=NULL,staged_verified_at=NULL,lease_token=NULL,leased_until=NULL,updated_at=clock_timestamp() WHERE payment_intent_id=r.payment_intent_id;
 END IF;
 PERFORM publish_platform_fee_report(r.auth_id,r.month_start);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.platform_fee_snapshot_scope_valid(text,text,timestamptz,timestamptz,uuid[],bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enroll_platform_fee_snapshots(text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_platform_fee_snapshots(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_platform_fee_snapshot(text,uuid,bigint,bigint,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_fee_snapshot_scope_valid(text,text,timestamptz,timestamptz,uuid[],bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enroll_platform_fee_snapshots(text,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_platform_fee_snapshots(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_platform_fee_snapshot(text,uuid,bigint,bigint,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.platform_fee_report_source(text,uuid[],timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.publish_platform_fee_report(text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_fee_report_source(text,uuid[],timestamptz,timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_platform_fee_report(text,timestamptz) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
