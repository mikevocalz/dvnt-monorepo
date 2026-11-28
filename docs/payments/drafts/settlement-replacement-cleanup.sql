-- DRAFT. Install after settlement-replacement.sql. No schedule or gate enabled.
-- CAPABILITY GATES: default-off CHECKOUT_REPLACEMENT_CLEANUP_ENABLED worker env,
-- checkout_replacement_enabled AND replacement_cleanup_enabled database flags.
-- Reviewed buyer terms must disclose the 60-minute cancellation window. A TTL
-- only authorizes a cancellation attempt. It never proves nonpayment.
-- Required release evidence: exact canceled, zero-money, charge-free intent;
-- hosted also exact expired/unpaid session. No bound PI is manual attention.
-- Hosted cleanup only expires Checkout; it never directly cancels Checkout's
-- owned PI. Expiry that leaves a nonterminal PI remains held for reconciliation.
-- Unknown mutation delivery is never retried, even after idempotency retention.
-- Operator review/alert delivery and sandbox cancellation proof are release
-- gates; this source installs neither scheduler nor external alert destination.
-- Actor-wide active reservation bounds (2 attempts / 40 units / 20 per attempt)
-- are enforced by settlement-replacement.sql under replacement-buyer mutex.
-- Never-dispatched tombstones cannot be revived; any later replacement needs
-- its own explicit, reviewed authorization path, not a new idempotency key.
BEGIN;
ALTER TABLE dvnt_settlement.controls ADD COLUMN replacement_cleanup_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE dvnt_settlement.replacement_cleanup (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 due_at timestamptz NOT NULL, next_check_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','blocked','uncertain','released','not_dispatched','fulfilled')),
 attempted_at timestamptz, action text CHECK(action IN('cancel_intent','expire_session')),
 provider_object_id text, idempotency_key text UNIQUE,
 dispatch_closed_at timestamptz, proof jsonb, reason text,
 last_checked_at timestamptz, completed_at timestamptz,
 CHECK((attempted_at IS NULL)=(action IS NULL)),
 CHECK((attempted_at IS NULL)=(provider_object_id IS NULL)),
 CHECK((attempted_at IS NULL)=(idempotency_key IS NULL))
);
ALTER TABLE dvnt_settlement.replacement_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.replacement_cleanup FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dvnt_settlement.seed_replacement_cleanup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO dvnt_settlement.replacement_cleanup(order_id,due_at,next_check_at)
 SELECT NEW.successor_order_id,c.created_at+interval '1 hour',c.created_at+interval '1 hour'
 FROM dvnt_settlement.checkouts c WHERE c.order_id=NEW.successor_order_id;
 RETURN NEW;
END $$;
CREATE TRIGGER seed_replacement_cleanup AFTER INSERT ON dvnt_settlement.checkout_replacements
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.seed_replacement_cleanup();
INSERT INTO dvnt_settlement.replacement_cleanup(order_id,due_at,next_check_at)
 SELECT r.successor_order_id,c.created_at+interval '1 hour',c.created_at+interval '1 hour'
 FROM dvnt_settlement.checkout_replacements r JOIN dvnt_settlement.checkouts c ON c.order_id=r.successor_order_id;
CREATE FUNCTION dvnt_settlement.freeze_replacement_cleanup() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'cleanup evidence immutable'; END IF;
 IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.due_at IS DISTINCT FROM OLD.due_at
 OR (OLD.attempted_at IS NOT NULL AND ROW(NEW.attempted_at,NEW.action,NEW.provider_object_id,NEW.idempotency_key)
  IS DISTINCT FROM ROW(OLD.attempted_at,OLD.action,OLD.provider_object_id,OLD.idempotency_key))
 OR (OLD.dispatch_closed_at IS NOT NULL AND NEW.dispatch_closed_at IS DISTINCT FROM OLD.dispatch_closed_at)
 OR (OLD.proof IS NOT NULL AND NEW.proof IS DISTINCT FROM OLD.proof)
 OR (OLD.completed_at IS NOT NULL AND ROW(NEW.completed_at,NEW.state) IS DISTINCT FROM ROW(OLD.completed_at,OLD.state))
 THEN RAISE EXCEPTION 'cleanup evidence immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_replacement_cleanup BEFORE UPDATE OR DELETE ON dvnt_settlement.replacement_cleanup
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_replacement_cleanup();
CREATE TRIGGER no_truncate_replacement_cleanup BEFORE TRUNCATE ON dvnt_settlement.replacement_cleanup
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.reject_external_change();

-- Terminal cleanup is immutable and never requeued. Clear matching operational
-- attention in the same transaction, not by scanning completed work forever.
CREATE FUNCTION dvnt_settlement.clear_terminal_cleanup_runtime() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.completed_at IS NOT NULL AND NEW.state IN ('released','not_dispatched','fulfilled') THEN
  DELETE FROM dvnt_settlement.runtime_attention WHERE phase='cleanup' AND work_key=NEW.order_id::text;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clear_terminal_cleanup_runtime AFTER INSERT OR UPDATE OF completed_at,state
 ON dvnt_settlement.replacement_cleanup FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.clear_terminal_cleanup_runtime();
REVOKE ALL ON FUNCTION dvnt_settlement.clear_terminal_cleanup_runtime() FROM PUBLIC,anon,authenticated,service_role;

-- Both paths lock cleanup before attention. This serializes a late budget
-- report with terminal completion and cannot erase any unresolved attempt.
ALTER FUNCTION public.settlement_runtime_observation(text,text,text,timestamptz) RENAME TO settlement_runtime_observation_before_cleanup;
REVOKE ALL ON FUNCTION public.settlement_runtime_observation_before_cleanup(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_runtime_observation(p_phase text,p_work_key text,p_outcome text,p_run_started_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q dvnt_settlement.replacement_cleanup%ROWTYPE;
BEGIN
 IF p_phase='cleanup' THEN
  IF p_work_key IS NULL OR p_work_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR p_outcome IS NULL
   OR p_outcome NOT IN ('budget','completed') OR p_run_started_at IS NULL OR NOT isfinite(p_run_started_at)
   OR p_run_started_at>clock_timestamp() THEN RAISE EXCEPTION 'invalid runtime observation'; END IF;
  SELECT * INTO STRICT q FROM dvnt_settlement.replacement_cleanup WHERE order_id=p_work_key::uuid FOR UPDATE;
  p_work_key:=q.order_id::text;
  IF q.completed_at IS NOT NULL AND q.state IN ('released','not_dispatched','fulfilled') THEN
   DELETE FROM dvnt_settlement.runtime_attention WHERE phase='cleanup' AND work_key=p_work_key;
   RETURN jsonb_build_object('ok',true,'terminal',true);
  END IF;
 END IF;
 RETURN public.settlement_runtime_observation_before_cleanup(p_phase,p_work_key,p_outcome,p_run_started_at);
END $$;
REVOKE ALL ON FUNCTION public.settlement_runtime_observation(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_runtime_observation(text,text,text,timestamptz) TO service_role;

CREATE FUNCTION dvnt_settlement.lock_replacement_cleanup(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; ancestor uuid;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE successor_order_id=o.id)
 THEN RAISE EXCEPTION 'not a replacement successor'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement-buyer:'||
  CASE WHEN o.user_id IS NOT NULL THEN 'member:'||o.user_id ELSE 'guest:'||lower(o.guest_email) END,2));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout:'||
  CASE WHEN o.user_id IS NOT NULL THEN 'member:'||o.user_id ELSE 'guest:'||lower(o.guest_email) END||':'||o.event_id::text,1));
 FOR ancestor IN WITH RECURSIVE chain(id,depth) AS(SELECT o.id,0 UNION ALL
  SELECT r.original_order_id,c.depth+1 FROM dvnt_settlement.checkout_replacements r JOIN chain c ON r.successor_order_id=c.id)
  SELECT id FROM chain ORDER BY depth DESC LOOP
  PERFORM 1 FROM public.carts WHERE id=(SELECT cart_id FROM public.orders WHERE id=ancestor) FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=ancestor FOR UPDATE;
 END LOOP;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.controls WHERE singleton AND checkout_replacement_enabled AND replacement_cleanup_enabled)
 THEN RAISE EXCEPTION 'replacement cleanup disabled'; END IF;
 PERFORM 1 FROM dvnt_settlement.checkouts WHERE order_id=o.id FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.replacement_cleanup WHERE order_id=o.id FOR UPDATE;
END $$;

CREATE FUNCTION public.settlement_replacement_cleanup_candidates(p_limit int DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected uuid[];
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.controls WHERE singleton AND checkout_replacement_enabled AND replacement_cleanup_enabled)
 THEN RETURN '[]'; END IF;
 SELECT ARRAY(SELECT order_id FROM dvnt_settlement.replacement_cleanup WHERE completed_at IS NULL
  AND due_at<=clock_timestamp() AND next_check_at<=clock_timestamp()
  ORDER BY last_checked_at NULLS FIRST,due_at,order_id LIMIT greatest(1,least(coalesce(p_limit,20),50)) FOR UPDATE SKIP LOCKED) INTO selected;
 UPDATE dvnt_settlement.replacement_cleanup SET last_checked_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '5 minutes'
  WHERE order_id=ANY(selected);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('order_id',id) ORDER BY n) FROM unnest(selected) WITH ORDINALITY AS s(id,n)),'[]');
END $$;

CREATE FUNCTION public.settlement_replacement_cleanup_context(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE; q dvnt_settlement.replacement_cleanup%ROWTYPE; policy dvnt_settlement.funding_policy%ROWTYPE;
BEGIN
 PERFORM dvnt_settlement.lock_replacement_cleanup(p_order_id);
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id;
 SELECT * INTO STRICT q FROM dvnt_settlement.replacement_cleanup WHERE order_id=o.id;
 IF q.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'terminal',true,'state',q.state); END IF;
 IF q.due_at>clock_timestamp() THEN RAISE EXCEPTION 'replacement checkout window still open'; END IF;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.replacement_inventory_releases WHERE order_id=o.id AND reason='fulfilled')
 OR (o.status='paid' AND (SELECT count(*) FROM public.tickets WHERE order_id=o.id)>=o.quantity) THEN
  UPDATE dvnt_settlement.replacement_cleanup SET state='fulfilled',completed_at=clock_timestamp(),reason=NULL WHERE order_id=o.id;
  RETURN jsonb_build_object('ok',true,'terminal',true,'state','fulfilled');
 END IF;
 SELECT * INTO STRICT policy FROM dvnt_settlement.funding_policy WHERE singleton;
 RETURN jsonb_build_object('ok',true,'terminal',false,'order_id',o.id,'snapshot',c.snapshot,
  'stripe_payment_intent_id',o.stripe_payment_intent_id,'stripe_checkout_session_id',o.stripe_checkout_session_id,
  'platform_account',policy.platform_account,'livemode',policy.livemode,'never_dispatched',c.attempted_at IS NULL,
  'cleanup_attempted',q.attempted_at IS NOT NULL,'due_at',q.due_at);
END $$;

-- The pre-cancel evidence repeats all identity/economics/zero-money checks.
-- It authorizes just one cancellation attempt, never inventory release.
CREATE FUNCTION public.settlement_replacement_cleanup_claim(p_order_id uuid,p_intent jsonb,p_session jsonb,
 p_platform_account text,p_livemode boolean,p_charges jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;c dvnt_settlement.checkouts%ROWTYPE;q dvnt_settlement.replacement_cleanup%ROWTYPE;
 policy dvnt_settlement.funding_policy%ROWTYPE; gross bigint; tax bigint; hosted boolean; action_name text; object_id text;
BEGIN
 PERFORM dvnt_settlement.lock_replacement_cleanup(p_order_id);
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id;
 SELECT * INTO STRICT q FROM dvnt_settlement.replacement_cleanup WHERE order_id=o.id;
 IF q.completed_at IS NOT NULL OR q.attempted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'claimed',false); END IF;
 IF q.due_at>clock_timestamp() OR c.attempted_at IS NULL THEN RAISE EXCEPTION 'cleanup not due or provider not dispatched'; END IF;
 PERFORM dvnt_settlement.replacement_assert_clear(o.id);
 SELECT * INTO STRICT policy FROM dvnt_settlement.funding_policy WHERE singleton;
 IF p_platform_account IS DISTINCT FROM policy.platform_account OR p_livemode IS DISTINCT FROM policy.livemode OR p_charges IS DISTINCT FROM '[]'::jsonb
 THEN RAISE EXCEPTION 'cleanup account or charges invalid'; END IF;
 gross:=(c.snapshot->'order'->>'total_cents')::bigint;
 hosted:=c.snapshot->>'rail' IN('ticket-checkout','guest-checkout');
 IF hosted THEN
  IF o.stripe_checkout_session_id IS NULL OR jsonb_typeof(p_session) IS DISTINCT FROM 'object'
   OR p_session->>'id' IS DISTINCT FROM o.stripe_checkout_session_id OR p_session->>'id' !~ '^cs_[A-Za-z0-9_]+$'
   OR p_session->>'object' IS DISTINCT FROM 'checkout.session' OR p_session->>'mode' IS DISTINCT FROM 'payment'
   OR p_session->>'status' IS DISTINCT FROM 'open' OR p_session->>'payment_status' IS DISTINCT FROM 'unpaid'
   OR p_session->'livemode' IS DISTINCT FROM to_jsonb(policy.livemode) OR p_session->>'currency' IS DISTINCT FROM o.currency
   OR p_session->'amount_subtotal' IS DISTINCT FROM to_jsonb(gross) OR p_session->>'payment_intent' IS DISTINCT FROM o.stripe_payment_intent_id
   OR p_session->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
   OR p_session->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
   OR jsonb_typeof(p_session->'total_details'->'amount_tax') IS DISTINCT FROM 'number'
   OR (p_session->'total_details'->>'amount_tax')::numeric<0
   OR trunc((p_session->'total_details'->>'amount_tax')::numeric)<>(p_session->'total_details'->>'amount_tax')::numeric
   OR p_session->'total_details'->'amount_discount' IS DISTINCT FROM '0'::jsonb
   OR p_session->'total_details'->'amount_shipping' IS DISTINCT FROM '0'::jsonb
   THEN RAISE EXCEPTION 'cleanup hosted evidence invalid'; END IF;
  tax:=(p_session->'total_details'->>'amount_tax')::bigint;gross:=gross+tax;
  IF p_session->'amount_total' IS DISTINCT FROM to_jsonb(gross) THEN RAISE EXCEPTION 'cleanup session amount invalid'; END IF;
  action_name:='expire_session';object_id:=o.stripe_checkout_session_id;
 ELSE
  IF p_session IS NOT NULL OR o.stripe_checkout_session_id IS NOT NULL THEN RAISE EXCEPTION 'unexpected cleanup session'; END IF;
  action_name:='cancel_intent';object_id:=o.stripe_payment_intent_id;
 END IF;
 IF o.stripe_payment_intent_id IS NULL OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object'
 OR p_intent->>'object' IS DISTINCT FROM 'payment_intent' OR p_intent->>'id' IS DISTINCT FROM o.stripe_payment_intent_id
 OR p_intent->>'id' !~ '^pi_[A-Za-z0-9_]+$' OR p_intent->>'status' IS NULL
 OR p_intent->>'status' NOT IN('requires_payment_method','requires_confirmation','requires_action')
 OR p_intent->'livemode' IS DISTINCT FROM to_jsonb(policy.livemode) OR p_intent->>'currency' IS DISTINCT FROM o.currency
 OR p_intent->'amount' IS DISTINCT FROM to_jsonb(gross) OR p_intent->'amount_received' IS DISTINCT FROM '0'::jsonb
 OR p_intent->'amount_capturable' IS DISTINCT FROM '0'::jsonb OR p_intent->'latest_charge' IS DISTINCT FROM 'null'::jsonb
 OR p_intent->'transfer_data' IS DISTINCT FROM 'null'::jsonb OR p_intent->'application_fee_amount' IS DISTINCT FROM 'null'::jsonb
 OR p_intent->'on_behalf_of' IS DISTINCT FROM 'null'::jsonb
 OR p_intent->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
 OR p_intent->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
 THEN RAISE EXCEPTION 'cleanup active zero-money evidence invalid'; END IF;
 UPDATE dvnt_settlement.replacement_cleanup SET state='uncertain',attempted_at=clock_timestamp(),action=action_name,
  provider_object_id=object_id,idempotency_key='dvnt:replacement-cleanup:v1:'||o.id::text,
  reason='cancellation_outcome_unknown',next_check_at=clock_timestamp()+interval '5 minutes' WHERE order_id=o.id;
 RETURN jsonb_build_object('ok',true,'claimed',true,'action',action_name,'provider_object_id',object_id,
  'idempotency_key','dvnt:replacement-cleanup:v1:'||o.id::text);
END $$;

CREATE FUNCTION public.settlement_replacement_cleanup_release(p_order_id uuid,p_intent jsonb DEFAULT NULL,p_session jsonb DEFAULT NULL,
 p_platform_account text DEFAULT NULL,p_livemode boolean DEFAULT NULL,p_charges jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;c dvnt_settlement.checkouts%ROWTYPE;q dvnt_settlement.replacement_cleanup%ROWTYPE;v_proof jsonb;next_state text;
BEGIN
 PERFORM dvnt_settlement.lock_replacement_cleanup(p_order_id);
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id;
 SELECT * INTO STRICT q FROM dvnt_settlement.replacement_cleanup WHERE order_id=o.id;
 IF q.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'state',q.state); END IF;
 IF q.due_at>clock_timestamp() THEN RAISE EXCEPTION 'replacement checkout window still open'; END IF;
 PERFORM dvnt_settlement.replacement_assert_clear(o.id);
 IF c.attempted_at IS NULL THEN
  IF o.stripe_payment_intent_id IS NOT NULL OR o.stripe_checkout_session_id IS NOT NULL OR p_intent IS NOT NULL OR p_session IS NOT NULL
   THEN RAISE EXCEPTION 'never-dispatched evidence inconsistent'; END IF;
  v_proof:=jsonb_build_object('version',1,'order_id',o.id,'kind','durable_dispatch_never_authorized','observed_at',clock_timestamp());
  next_state:='not_dispatched';
 ELSE
  v_proof:=dvnt_settlement.replacement_proof(o.id,p_intent,p_session,p_platform_account,p_livemode,p_charges);
  next_state:='released';
 END IF;
 UPDATE dvnt_settlement.replacement_cleanup SET dispatch_closed_at=clock_timestamp(),proof=v_proof,
  state=next_state,completed_at=clock_timestamp(),reason=NULL WHERE order_id=o.id;
 INSERT INTO dvnt_settlement.replacement_inventory_releases(order_id,reason,proof) VALUES(o.id,'canceled',v_proof)
  ON CONFLICT(order_id,reason) DO NOTHING;
 UPDATE public.ticket_holds SET status='expired',expires_at=least(expires_at,clock_timestamp())
  WHERE status='active' AND payment_intent_id IN('replacement:'||o.id::text,o.stripe_payment_intent_id,o.stripe_checkout_session_id);
 UPDATE public.cart_holds SET released=true,released_at=clock_timestamp(),expires_at=least(expires_at,clock_timestamp())
  WHERE cart_id=o.cart_id AND NOT released;
 RETURN jsonb_build_object('ok',true,'state',next_state);
END $$;

CREATE FUNCTION public.settlement_replacement_cleanup_observe(p_order_id uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_reason IS NULL OR p_reason NOT IN('processing','provider_link_missing','payment_or_financial_review','cancellation_outcome_unknown','proof_unavailable')
 THEN RAISE EXCEPTION 'invalid cleanup reason'; END IF;
 UPDATE dvnt_settlement.replacement_cleanup SET state=CASE WHEN attempted_at IS NULL THEN 'blocked' ELSE 'uncertain' END,
  reason=p_reason,last_checked_at=clock_timestamp(),next_check_at=clock_timestamp()+interval '30 minutes'
  WHERE order_id=p_order_id AND completed_at IS NULL;
 RETURN jsonb_build_object('ok',true);
END $$;

-- A request that never crossed the provider claim may release its reservation
-- only after permanently closing dispatch in the same locked transaction.
ALTER FUNCTION public.claim_settlement_checkout(uuid,jsonb) RENAME TO claim_settlement_checkout_before_cleanup;
REVOKE ALL ON FUNCTION public.claim_settlement_checkout_before_cleanup(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_settlement_checkout(p_order_id uuid,p_params jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM dvnt_settlement.replacement_cleanup WHERE order_id=p_order_id AND dispatch_closed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'replacement dispatch permanently closed'; END IF;
 -- The nested dispatch gate serializes on the same order/checkout locks as
 -- cleanup. After a concurrent close, released holds block the nested claim.
 RETURN public.claim_settlement_checkout_before_cleanup(p_order_id,p_params);
END $$;

CREATE FUNCTION public.settlement_replacement_cleanup_health() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('ok',true,'enabled',(SELECT replacement_cleanup_enabled FROM dvnt_settlement.controls WHERE singleton),
 'overdue_count',count(*) FILTER(WHERE completed_at IS NULL AND due_at<clock_timestamp()-interval '30 minutes'),
 'attention_count',count(*) FILTER(WHERE completed_at IS NULL AND state IN('blocked','uncertain')),
 'unknown_count',count(*) FILTER(WHERE completed_at IS NULL AND (reason IN('provider_link_missing','cancellation_outcome_unknown','proof_unavailable'))),
 'processing_count',count(*) FILTER(WHERE completed_at IS NULL AND reason='processing'),
 'oldest_due_at',min(due_at) FILTER(WHERE completed_at IS NULL)) FROM dvnt_settlement.replacement_cleanup;
$$;

-- Observation remains live even with cancellation gates off. An abandoned
-- reservation is an operator obligation, not a signal to retry payment.
CREATE FUNCTION public.settlement_replacement_cleanup_review_queue(p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
  SELECT order_id,coalesce(reason,'cleanup_overdue') AS reason,due_at,state
  FROM dvnt_settlement.replacement_cleanup WHERE completed_at IS NULL
   AND (state IN('blocked','uncertain') OR due_at<now()-interval '30 minutes')
  ORDER BY due_at,order_id LIMIT greatest(1,least(coalesce(p_limit,100),100))
 ) q;
$$;
ALTER FUNCTION public.settlement_health() RENAME TO settlement_health_before_replacement_cleanup;
REVOKE ALL ON FUNCTION public.settlement_health_before_replacement_cleanup() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE health jsonb; cleanup jsonb; needs_review bigint;
BEGIN
 health:=public.settlement_health_before_replacement_cleanup();
 cleanup:=public.settlement_replacement_cleanup_health();
 SELECT count(*) INTO needs_review FROM dvnt_settlement.replacement_cleanup WHERE completed_at IS NULL
  AND (state IN('blocked','uncertain') OR due_at<now()-interval '30 minutes');
 RETURN health || jsonb_build_object('replacement_inventory',cleanup,
  'manual_review_count',(health->>'manual_review_count')::bigint+needs_review,
  'worker_expected',(health->>'worker_expected')::boolean OR EXISTS(SELECT 1 FROM dvnt_settlement.controls
    WHERE singleton AND checkout_replacement_enabled AND replacement_cleanup_enabled));
END $$;
REVOKE ALL ON FUNCTION public.settlement_health() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.settlement_health() TO service_role;

DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='dvnt_settlement' AND p.proname IN('seed_replacement_cleanup','freeze_replacement_cleanup','lock_replacement_cleanup'))
 OR (n.nspname='public' AND (p.proname LIKE 'settlement_replacement_cleanup_%' OR p.proname='claim_settlement_checkout')) LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated,service_role';
  IF f.nspname='public' THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';END IF;
 END LOOP;
END $$;
COMMIT;
