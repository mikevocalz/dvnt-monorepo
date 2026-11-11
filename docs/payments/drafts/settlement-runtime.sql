BEGIN;
ALTER TABLE dvnt_settlement.controls ADD COLUMN checkout_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN owner_host_ids text[] NOT NULL DEFAULT '{}',
 ADD COLUMN release_delay_seconds integer CHECK(release_delay_seconds>=0),
 ADD COLUMN funding_epoch bigint NOT NULL DEFAULT 0;
-- No default is a safe risk reserve. Reviewed rollout must configure each
-- currency for platform-paid Connect fees, refunds, disputes and balance risk.
-- This does not fund or enroll legacy destination-charge commission debt.
CREATE TABLE dvnt_settlement.currency_reserves (
 currency text PRIMARY KEY CHECK(currency ~ '^[a-z]{3}$'),
 reserve_cents bigint NOT NULL CHECK(reserve_cents>=0),
 policy_reference text NOT NULL CHECK(length(btrim(policy_reference))>0)
);
ALTER TABLE dvnt_settlement.currency_reserves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.currency_reserves FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE dvnt_settlement.event_stops(event_id int PRIMARY KEY REFERENCES public.events(id),reason text NOT NULL CHECK(reason IN ('dispute_only','manual','recovery')));
ALTER TABLE dvnt_settlement.event_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.event_stops FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE dvnt_settlement.deliveries ADD COLUMN completed_at timestamptz, ADD COLUMN last_error text;
ALTER TABLE dvnt_settlement.allocations ADD COLUMN recipient_user_id text;
CREATE TABLE dvnt_settlement.checkouts (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id), request_scope text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 stripe_params jsonb, attempted_at timestamptz, source_verified_at timestamptz,
 -- Scheduling/observation only. None of these fields reduces a liability.
 outcome_unknown_since timestamptz, reconciliation_attempts int NOT NULL DEFAULT 0 CHECK(reconciliation_attempts BETWEEN 0 AND 20),
 next_check_at timestamptz, retired_at timestamptz,
 last_error text, last_checked_at timestamptz, release_not_before timestamptz NOT NULL, organizer_user_id text NOT NULL, promoter_id uuid, promoter_user_id text
);
ALTER TABLE dvnt_settlement.checkouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.checkouts FROM PUBLIC,anon,authenticated,service_role;


CREATE INDEX settlement_checkout_retry ON dvnt_settlement.checkouts(next_check_at,last_checked_at,order_id)
 WHERE attempted_at IS NOT NULL AND retired_at IS NULL;
-- A separate scheduling mutex avoids changing the financial source->controls
-- lock order. Small batches rotate guaranteed partitions instead of starving.
CREATE TABLE dvnt_settlement.queue_cursor(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),turn int NOT NULL DEFAULT 0 CHECK(turn BETWEEN 0 AND 3));
INSERT INTO dvnt_settlement.queue_cursor DEFAULT VALUES;
ALTER TABLE dvnt_settlement.queue_cursor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.queue_cursor FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION dvnt_settlement.wake_checkout_reconciliation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF ROW(NEW.status,NEW.stripe_payment_intent_id,NEW.stripe_checkout_session_id)
 IS DISTINCT FROM ROW(OLD.status,OLD.stripe_payment_intent_id,OLD.stripe_checkout_session_id) THEN
  UPDATE dvnt_settlement.checkouts SET next_check_at=NULL,retired_at=NULL,reconciliation_attempts=0 WHERE order_id=NEW.id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.wake_checkout_reconciliation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER wake_settlement_checkout AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.wake_checkout_reconciliation();

-- Only a trusted adapter's freshly retrieved, fully bound PI can establish a
-- known nonpaid observation. Null/malformed/contradictory proof fails closed.
-- This RPC never clears a hold, reservation, allocation, or financial evidence.
CREATE FUNCTION public.settlement_checkout_observation(p_order_id uuid,p_outcome text,p_intent jsonb DEFAULT NULL,p_session jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE; gross bigint; attempts int; retire boolean:=false;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id FOR UPDATE;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR c.attempted_at IS NULL
  OR p_outcome IS NULL OR p_outcome NOT IN ('unknown','nonpaid') THEN RAISE EXCEPTION 'invalid checkout observation'; END IF;
 attempts:=least(c.reconciliation_attempts+1,20);
 IF p_outcome='unknown' THEN
  UPDATE dvnt_settlement.checkouts SET outcome_unknown_since=coalesce(outcome_unknown_since,now()),retired_at=NULL,
   reconciliation_attempts=attempts,next_check_at=now()+make_interval(secs=>least(3600,300*power(2,least(attempts-1,4)))::int)
   WHERE order_id=p_order_id;
 ELSE
  gross:=(c.snapshot->'order'->>'total_cents')::bigint;
  IF c.snapshot->>'rail' IN ('ticket-checkout','guest-checkout') AND o.stripe_checkout_session_id IS NULL
   THEN RAISE EXCEPTION 'hosted nonpaid observation requires exact session proof'; END IF;
  IF o.stripe_checkout_session_id IS NOT NULL THEN
   IF p_session IS NULL OR jsonb_typeof(p_session)<>'object'
    OR p_session->>'id' IS DISTINCT FROM o.stripe_checkout_session_id
    OR p_session->>'id' !~ '^cs_[A-Za-z0-9_]+$'
    OR p_session->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
    OR p_session->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
    OR p_session->>'currency' IS DISTINCT FROM o.currency
    OR p_session->'amount_subtotal' IS DISTINCT FROM to_jsonb(gross)
    OR p_session->>'payment_intent' IS DISTINCT FROM o.stripe_payment_intent_id
    OR p_session->>'payment_status' IS DISTINCT FROM 'unpaid'
    OR p_session->>'status' IS NULL OR p_session->>'status' NOT IN ('open','complete','expired')
    OR jsonb_typeof(p_session->'total_details'->'amount_tax') IS DISTINCT FROM 'number'
    OR (p_session->'total_details'->>'amount_tax')::bigint<0
    OR p_session->'total_details'->'amount_discount' IS DISTINCT FROM '0'::jsonb
    OR p_session->'total_details'->'amount_shipping' IS DISTINCT FROM '0'::jsonb
   THEN RAISE EXCEPTION 'invalid nonpaid session proof'; END IF;
   gross:=gross+(p_session->'total_details'->>'amount_tax')::bigint;
   IF p_session->'amount_total' IS DISTINCT FROM to_jsonb(gross) THEN RAISE EXCEPTION 'invalid nonpaid session amount'; END IF;
  ELSIF p_session IS NOT NULL THEN RAISE EXCEPTION 'unexpected session proof'; END IF;
  IF p_intent IS NULL OR jsonb_typeof(p_intent)<>'object' OR o.stripe_payment_intent_id IS NULL
   OR p_intent->>'id' IS DISTINCT FROM o.stripe_payment_intent_id
   OR p_intent->>'id' !~ '^pi_[A-Za-z0-9_]+$'
   OR p_intent->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
   OR p_intent->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
   OR p_intent->>'currency' IS DISTINCT FROM o.currency
   OR p_intent->'amount' IS DISTINCT FROM to_jsonb(gross)
   OR p_intent->'amount_received' IS DISTINCT FROM '0'::jsonb
   OR p_intent->'latest_charge' IS DISTINCT FROM 'null'::jsonb
   OR p_intent->>'status' IS NULL OR p_intent->>'status' NOT IN ('requires_payment_method','requires_confirmation','requires_action','processing','requires_capture','canceled')
   OR coalesce(p_intent->'transfer_data','null'::jsonb)<>'null'::jsonb
   OR coalesce(p_intent->'application_fee_amount','null'::jsonb)<>'null'::jsonb
   OR coalesce(p_intent->'on_behalf_of','null'::jsonb)<>'null'::jsonb
   OR o.status IS NULL OR o.status NOT IN ('created','payment_pending','payment_failed','canceled','cancelled','failed')
   OR o.paid_at IS NOT NULL OR c.source_verified_at IS NOT NULL
   OR EXISTS(SELECT 1 FROM dvnt_settlement.orders WHERE order_id=o.id)
   OR EXISTS(SELECT 1 FROM dvnt_settlement.allocations WHERE order_id=o.id)
  THEN RAISE EXCEPTION 'invalid nonpaid intent proof'; END IF;
  retire:=p_intent->>'status'='canceled'
   AND (o.stripe_checkout_session_id IS NULL OR p_session->>'status'='expired')
   AND coalesce(c.last_error,'') NOT LIKE 'hold:%'
   AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.holds WHERE order_id=o.id);
  UPDATE dvnt_settlement.checkouts SET outcome_unknown_since=NULL,reconciliation_attempts=attempts,
   retired_at=CASE WHEN retire THEN now() ELSE NULL END,
   next_check_at=least(now()+make_interval(secs=>least(21600,300*power(2,least(attempts-1,7)))::int),
    greatest(now(),greatest(c.release_not_before,dvnt_settlement.event_release_at(o.event_id)))+interval '1 hour')
   WHERE order_id=p_order_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'retired',retire);
END $$;


CREATE FUNCTION dvnt_settlement.freeze_prepared_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c dvnt_settlement.checkouts%ROWTYPE;
BEGIN
 SELECT * INTO c FROM dvnt_settlement.checkouts WHERE order_id=OLD.id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF ROW(NEW.charge_model,NEW.subtotal_cents,NEW.organizer_fee_cents,NEW.promoter_commission_amount_cents,
  NEW.promoter_id,NEW.promoter_code,NEW.event_id,NEW.user_id,NEW.guest_email,NEW.type,NEW.currency,NEW.quantity,NEW.cart_id)
 IS DISTINCT FROM ROW(OLD.charge_model,OLD.subtotal_cents,OLD.organizer_fee_cents,OLD.promoter_commission_amount_cents,
  OLD.promoter_id,OLD.promoter_code,OLD.event_id,OLD.user_id,OLD.guest_email,OLD.type,OLD.currency,OLD.quantity,OLD.cart_id)
 OR (OLD.stripe_payment_intent_id IS NOT NULL AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id)
 OR (OLD.stripe_checkout_session_id IS NOT NULL AND NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id)
 OR NEW.tax_cents<0 OR NEW.total_cents IS DISTINCT FROM (c.snapshot->'order'->>'total_cents')::bigint+coalesce(NEW.tax_cents,0)
 THEN RAISE EXCEPTION 'prepared checkout economics and identity are immutable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.freeze_prepared_order() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER freeze_prepared_settlement BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_prepared_order();

CREATE FUNCTION dvnt_settlement.bind_allocation_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c dvnt_settlement.checkouts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=NEW.order_id;
 IF NEW.role='organizer' THEN NEW.recipient_id:=c.organizer_user_id; NEW.recipient_user_id:=c.organizer_user_id;
 ELSE
  IF c.promoter_id IS NULL THEN RAISE EXCEPTION 'missing locked promoter identity'; END IF;
  NEW.recipient_id:=c.promoter_id::text; NEW.recipient_user_id:=c.promoter_user_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.bind_allocation_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bind_settlement_recipient BEFORE INSERT ON dvnt_settlement.allocations
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.bind_allocation_identity();

-- The same catalog item can arrive through hosted, native or cart checkout.
-- IDs of cart lines and request keys are attempt identities, not a different
-- purchase. Unknown selection shapes fail closed for this buyer/event only.
CREATE FUNCTION dvnt_settlement.checkout_selections_overlap(p_left jsonb,p_right jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE selection jsonb; line jsonb; targets text[]; left_targets text[]; side int:=0;
BEGIN
 FOREACH selection IN ARRAY ARRAY[p_left,p_right] LOOP
  side:=side+1; targets:='{}';
  IF jsonb_typeof(selection) IS DISTINCT FROM 'object' THEN RETURN true; END IF;
  IF nullif(selection->>'ticket_type_id','') IS NOT NULL THEN
   targets:=array_append(targets,'tier:'||((selection->>'ticket_type_id')::uuid)::text);
  END IF;
  IF selection ? 'lines' THEN
   IF jsonb_typeof(selection->'lines') IS DISTINCT FROM 'array' THEN RETURN true; END IF;
   FOR line IN SELECT value FROM jsonb_array_elements(selection->'lines') LOOP
    IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RETURN true; END IF;
    IF nullif(line->>'tier_id','') IS NOT NULL AND nullif(line->>'addon_id','') IS NULL THEN
     targets:=array_append(targets,'tier:'||((line->>'tier_id')::uuid)::text);
    ELSIF nullif(line->>'addon_id','') IS NOT NULL AND nullif(line->>'tier_id','') IS NULL THEN
     targets:=array_append(targets,'addon:'||((line->>'addon_id')::uuid)::text||':variant:'||coalesce((nullif(line->>'variant_id','')::uuid)::text,''));
    ELSE RETURN true;
    END IF;
   END LOOP;
  END IF;
  IF cardinality(targets)=0 THEN RETURN true; END IF;
  IF side=1 THEN left_targets:=targets; END IF;
 END LOOP;
 RETURN left_targets && targets;
EXCEPTION WHEN invalid_text_representation THEN
 -- PostgreSQL accepts multiple spellings of a UUID. Malformed historical
 -- selections cannot safely establish that two pending purchases differ.
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.checkout_selections_overlap(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prepare_settlement_checkout(p_snapshot jsonb,p_request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb:=p_snapshot->'order'; c dvnt_settlement.checkouts%ROWTYPE;
 o public.orders%ROWTYPE; scope text; host text; release_at timestamptz; delay_seconds integer; promoter public.event_promoters%ROWTYPE;
BEGIN
 IF NOT (SELECT checkout_enabled FROM dvnt_settlement.controls WHERE singleton) THEN RAISE EXCEPTION 'separate checkout disabled'; END IF;
 IF v IS NULL OR jsonb_typeof(v)<>'object' OR p_snapshot->>'rail' IS NULL
 OR v->>'total_cents' IS NULL OR v->>'quantity' IS NULL OR v->>'subtotal_cents' IS NULL
 OR v->>'organizer_fee_cents' IS NULL OR v->>'event_id' IS NULL OR v->>'currency' IS NULL
 OR p_request_key IS NULL OR length(p_request_key)<16 OR length(p_request_key)>128
 OR p_snapshot->>'rail' NOT IN ('ticket-checkout','guest-checkout','cart-checkout','create-payment-intent')
 OR coalesce(v->>'user_id',v->>'guest_email','')='' OR (v->>'total_cents')::bigint<=0
 OR (v->>'quantity')::int<=0 OR (v->>'subtotal_cents')::bigint<0
 OR (v->>'organizer_fee_cents')::bigint<0 OR v->>'currency' !~ '^[a-z]{3}$' THEN RAISE EXCEPTION 'invalid checkout snapshot'; END IF;
 scope:=(p_snapshot->>'rail')||':'||coalesce(v->>'user_id',lower(v->>'guest_email'))||':'||p_request_key;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(scope,0));
 SELECT * INTO c FROM dvnt_settlement.checkouts WHERE request_scope=scope FOR UPDATE;
 IF FOUND THEN
  IF c.snapshot IS DISTINCT FROM p_snapshot THEN RAISE EXCEPTION 'checkout replay mismatch'; END IF;
  IF v->>'user_id' IS NULL THEN RAISE EXCEPTION 'guest replay requires secure recovery'; END IF;
  SELECT * INTO STRICT o FROM public.orders WHERE id=c.order_id;
 ELSE
  -- A remounted client that lost its key cannot silently create a second
  -- payment for the same selection while the earlier outcome is unresolved.
  -- All paid rails share this mutex. Rail-scoped locks allow simultaneous
  -- hosted/native requests to both observe no prior attempt and charge twice.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout:'||
   CASE WHEN v->>'user_id' IS NOT NULL THEN 'member:'||(v->>'user_id') ELSE 'guest:'||lower(v->>'guest_email') END||':'||((v->>'event_id')::int)::text,1));
  IF EXISTS(SELECT 1 FROM dvnt_settlement.checkouts prior JOIN public.orders old ON old.id=prior.order_id
   WHERE dvnt_settlement.checkout_selections_overlap(prior.snapshot->'selection',p_snapshot->'selection')
   AND old.event_id=(v->>'event_id')::int AND old.status IS DISTINCT FROM 'paid'
   AND (CASE WHEN v->>'user_id' IS NOT NULL THEN old.user_id=v->>'user_id' ELSE old.user_id IS NULL AND lower(old.guest_email)=lower(v->>'guest_email') END))
  THEN RAISE EXCEPTION 'existing checkout requires reconciliation'; END IF;
  IF v->>'cart_id' IS NOT NULL THEN
   PERFORM 1 FROM public.carts WHERE id=(v->>'cart_id')::uuid FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.orders WHERE cart_id=(v->>'cart_id')::uuid) THEN RAISE EXCEPTION 'cart already has payment'; END IF;
  END IF;
  SELECT host_id::text,dvnt_settlement.event_release_at(id) INTO STRICT host,release_at FROM public.events WHERE id=(v->>'event_id')::int FOR SHARE;
  IF release_at IS NULL OR NOT isfinite(release_at) THEN RAISE EXCEPTION 'event end missing'; END IF;
  IF host IS NULL THEN RAISE EXCEPTION 'organizer identity missing'; END IF;
  IF v->>'promoter_code' IS NOT NULL THEN
   SELECT * INTO STRICT promoter FROM public.event_promoters WHERE event_id=(v->>'event_id')::int
    AND upper(code)=upper(v->>'promoter_code') AND status='active' FOR SHARE;
   IF (v->>'promoter_commission_amount_cents') IS NULL OR
      (v->>'promoter_commission_bps')::int IS DISTINCT FROM promoter.promoter_commission_bps OR
      (v->>'promoter_customer_discount_bps')::int IS DISTINCT FROM promoter.customer_discount_bps THEN
    RAISE EXCEPTION 'promoter snapshot changed';
   END IF;
  END IF;
  IF (coalesce((v->>'promoter_commission_amount_cents')::bigint,0)>0 AND promoter.id IS NULL)
   OR coalesce((v->>'promoter_commission_amount_cents')::bigint,0)<0 OR
   coalesce((v->>'promoter_commission_amount_cents')::bigint,0)>(v->>'subtotal_cents')::bigint-(v->>'organizer_fee_cents')::bigint THEN
   RAISE EXCEPTION 'commission exceeds organizer allocation'; END IF;
  INSERT INTO public.orders(user_id,guest_email,guest_phone,type,status,charge_model,event_id,quantity,currency,
   subtotal_cents,total_cents,platform_fee_cents,buyer_pct_fee_cents,buyer_per_ticket_fee_cents,buyer_fee_cents,
   org_pct_fee_cents,org_per_ticket_fee_cents,organizer_fee_cents,dvnt_total_fee_cents,fee_policy_version,
   cart_id,promo_code_id,discount_cents,promoter_id,promoter_code,promoter_policy_version,promoter_original_amount_cents,
   promoter_customer_discount_bps,promoter_discount_amount_cents,promoter_discounted_amount_cents,
   promoter_commission_bps,promoter_commission_amount_cents)
  VALUES(v->>'user_id',lower(v->>'guest_email'),v->>'guest_phone','event_ticket','payment_pending','separate_charges_and_transfers',
   (v->>'event_id')::int,(v->>'quantity')::int,v->>'currency',(v->>'subtotal_cents')::int,(v->>'total_cents')::int,
   (v->>'platform_fee_cents')::int,(v->>'buyer_pct_fee_cents')::int,(v->>'buyer_per_ticket_fee_cents')::int,(v->>'buyer_fee_cents')::int,
   (v->>'org_pct_fee_cents')::int,(v->>'org_per_ticket_fee_cents')::int,(v->>'organizer_fee_cents')::int,(v->>'dvnt_total_fee_cents')::int,v->>'fee_policy_version',
   (v->>'cart_id')::uuid,(v->>'promo_code_id')::uuid,(v->>'discount_cents')::int,promoter.id,v->>'promoter_code',v->>'promoter_policy_version',
   (v->>'promoter_original_amount_cents')::int,(v->>'promoter_customer_discount_bps')::int,(v->>'promoter_discount_amount_cents')::int,
   (v->>'promoter_discounted_amount_cents')::int,(v->>'promoter_commission_bps')::int,(v->>'promoter_commission_amount_cents')::int)
  RETURNING * INTO o;
  IF promoter.id IS NOT NULL THEN
   INSERT INTO public.promoter_attributions(order_id,promoter_id,locked_rev_share_bps,locked_customer_discount_bps,
    locked_promoter_commission_bps,locked_promoter_discount_amount_cents,locked_promoter_commission_amount_cents)
   VALUES(o.id,promoter.id,coalesce(promoter.rev_share_bps,0),promoter.customer_discount_bps,promoter.promoter_commission_bps,
    o.promoter_discount_amount_cents,o.promoter_commission_amount_cents);
  END IF;
  INSERT INTO dvnt_settlement.checkouts(order_id,request_scope,snapshot,release_not_before,organizer_user_id,promoter_id,promoter_user_id) VALUES(o.id,scope,p_snapshot,release_at,host,promoter.id,promoter.user_id) RETURNING * INTO c;
 END IF;
 RETURN jsonb_build_object('ok',true,'order_id',o.id,'charge_model',o.charge_model,
  'idempotency_key','dvnt:checkout:v1:'||o.id::text,'created_at',c.created_at,
  'stripe_payment_intent_id',o.stripe_payment_intent_id,'stripe_checkout_session_id',o.stripe_checkout_session_id);
END $$;

CREATE FUNCTION public.claim_settlement_checkout(p_order_id uuid,p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c dvnt_settlement.checkouts%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id FOR UPDATE;
 IF NOT (SELECT checkout_enabled FROM dvnt_settlement.controls WHERE singleton) THEN RAISE EXCEPTION 'checkout disabled'; END IF;
 IF c.attempted_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'claimed',false); END IF;
 IF p_params IS NULL OR jsonb_typeof(p_params)<>'object' THEN RAISE EXCEPTION 'missing provider params'; END IF;
 UPDATE dvnt_settlement.checkouts SET stripe_params=p_params,attempted_at=now() WHERE order_id=p_order_id;
 RETURN jsonb_build_object('ok',true,'claimed',true,'idempotency_key','dvnt:checkout:v1:'||p_order_id::text);
END $$;

CREATE FUNCTION public.finalize_settlement_checkout(p_order_id uuid,p_payment_intent_id text,p_checkout_session_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR
  NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts WHERE order_id=o.id AND attempted_at IS NOT NULL) OR
  (p_payment_intent_id IS NULL AND p_checkout_session_id IS NULL) OR
  (p_payment_intent_id IS NOT NULL AND p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$') OR
  (p_checkout_session_id IS NOT NULL AND p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$') OR
  (o.stripe_payment_intent_id IS NOT NULL AND p_payment_intent_id IS DISTINCT FROM o.stripe_payment_intent_id) OR
  (o.stripe_checkout_session_id IS NOT NULL AND p_checkout_session_id IS DISTINCT FROM o.stripe_checkout_session_id)
 THEN RAISE EXCEPTION 'payment linkage mismatch'; END IF;
 UPDATE public.orders SET stripe_payment_intent_id=coalesce(p_payment_intent_id,stripe_payment_intent_id),
  stripe_checkout_session_id=coalesce(p_checkout_session_id,stripe_checkout_session_id) WHERE id=o.id;
 -- A freshly verified webhook may repeat the same linkage after a backoff.
 -- Wake observation only; it cannot clear holds or establish source funding.
 UPDATE dvnt_settlement.checkouts SET next_check_at=NULL,retired_at=NULL,reconciliation_attempts=0 WHERE order_id=o.id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.settlement_candidates(p_limit int DEFAULT 100,p_order_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE chosen uuid[]; n int:=greatest(1,least(coalesce(p_limit,100),100)); v_turn int; quotas int[];
BEGIN
 IF p_order_id IS NULL THEN
  SELECT q.turn INTO v_turn FROM dvnt_settlement.queue_cursor q WHERE singleton FOR UPDATE;
  quotas:=CASE WHEN n>=4 THEN ARRAY[greatest(1,n*25/100),n-greatest(1,n*25/100)-2*greatest(1,n*15/100),greatest(1,n*15/100),greatest(1,n*15/100)]
   ELSE ARRAY[0,0,0,0] END;
  IF n<4 THEN
   FOR i IN 0..n-1 LOOP quotas[1+(v_turn+i)%4]:=1; END LOOP;
   UPDATE dvnt_settlement.queue_cursor SET turn=(v_turn+n)%4 WHERE singleton;
  END IF;
  WITH releases AS MATERIALIZED (
   SELECT e.id,dvnt_settlement.event_release_at(e.id) AS release_at FROM public.events e
   WHERE EXISTS(SELECT 1 FROM public.orders o JOIN dvnt_settlement.checkouts c ON c.order_id=o.id
    WHERE o.event_id=e.id AND c.attempted_at IS NOT NULL)
  ), eligible AS (
   SELECT c.order_id,c.last_checked_at,c.created_at,
    CASE WHEN EXISTS(SELECT 1 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
      WHERE a.order_id=o.id AND d.state IN ('reserved','uncertain','recovery_required')) THEN 1
     WHEN s.order_id IS NOT NULL THEN 2
     WHEN greatest(c.release_not_before,r.release_at)<=now()
      AND (c.outcome_unknown_since IS NOT NULL OR o.status IN ('paid','partially_refunded','refunded','disputed')) THEN 3 ELSE 4 END AS bucket
   FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id LEFT JOIN dvnt_settlement.orders s ON s.order_id=o.id JOIN releases r ON r.id=o.event_id
   WHERE o.charge_model='separate_charges_and_transfers' AND c.attempted_at IS NOT NULL
    AND ((s.order_id IS NULL AND c.retired_at IS NULL AND (c.next_check_at IS NULL OR c.next_check_at<=now()))
     OR EXISTS(SELECT 1 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
      WHERE a.order_id=o.id AND (d.state IN ('reserved','uncertain','recovery_required')
       OR (d.state='held' AND greatest(s.release_at,r.release_at)<=now()
        AND NOT (a.role='promoter' AND dvnt_settlement.promoter_obligation_satisfied(a.id))))))
  ), ranked AS (
   SELECT *,row_number() OVER(PARTITION BY bucket ORDER BY last_checked_at NULLS FIRST,created_at,order_id) AS rank FROM eligible
  )
  SELECT ARRAY(SELECT c.order_id FROM ranked r JOIN dvnt_settlement.checkouts c ON c.order_id=r.order_id
   ORDER BY CASE WHEN r.rank<=quotas[r.bucket] THEN 0 ELSE 1 END,r.bucket,r.rank
   LIMIT n FOR UPDATE OF c SKIP LOCKED) INTO chosen;
  UPDATE dvnt_settlement.checkouts SET last_checked_at=clock_timestamp(),
   next_check_at=CASE WHEN NOT EXISTS(SELECT 1 FROM dvnt_settlement.orders s WHERE s.order_id=checkouts.order_id)
    THEN now()+interval '5 minutes' ELSE next_check_at END WHERE order_id=ANY(chosen);
 ELSE chosen:=ARRAY[p_order_id]; END IF;
 -- Preserve dispatch priority, not just batch membership: the worker consumes
 -- this JSON sequentially and older pending attempts must not jump the queue.
 RETURN (SELECT coalesce(jsonb_agg(row_to_json(t) ORDER BY array_position(chosen,t.order_id)),'[]'::jsonb) FROM (
 SELECT o.id AS order_id,o.status,o.stripe_payment_intent_id,o.stripe_checkout_session_id,
  c.snapshot,c.created_at,c.attempted_at,c.stripe_params,e.payout_release_at,e.host_id,
  e.payout_status,EXISTS(SELECT 1 FROM dvnt_settlement.orders s WHERE s.order_id=o.id) AS enrolled,
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'role',a.role,'recipient_id',a.recipient_id,'recipient_user_id',a.recipient_user_id,
   'amount_cents',a.amount_cents,'state',d.state,'destination',d.destination,'stripe_transfer_id',d.stripe_transfer_id,
   'idempotency_key',d.idempotency_key,'charge_id',s.charge_id,'currency',s.currency,
   'obligation_satisfied',CASE WHEN a.role='promoter' THEN dvnt_settlement.promoter_obligation_satisfied(a.id) ELSE false END,
   'candidate_destination',CASE WHEN a.role='organizer' THEN
     (SELECT oa.stripe_account_id FROM public.organizer_accounts oa WHERE oa.host_id=a.recipient_id LIMIT 1)
    ELSE (SELECT coalesce(ep.stripe_account_id,(SELECT oa.stripe_account_id FROM public.organizer_accounts oa WHERE oa.host_id=a.recipient_user_id LIMIT 1))
      FROM public.event_promoters ep WHERE ep.id::text=a.recipient_id) END))
   FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
   JOIN dvnt_settlement.orders s ON s.order_id=a.order_id WHERE a.order_id=o.id),'[]'::jsonb) AS allocations
 FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id JOIN public.events e ON e.id=o.event_id
 WHERE o.charge_model='separate_charges_and_transfers' AND c.attempted_at IS NOT NULL
 AND o.id=ANY(chosen)
 AND (p_order_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM dvnt_settlement.orders s WHERE s.order_id=o.id)
  OR EXISTS(SELECT 1 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
   WHERE a.order_id=o.id AND d.state IN ('held','reserved','uncertain','recovery_required')))
 ) t);
END $$;

CREATE FUNCTION public.settlement_order(p_order_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT public.settlement_candidates(100,p_order_id)->0;
$$;

CREATE FUNCTION public.settlement_verify_source(p_order_id uuid,p_charge text,p_pi text,p_currency text,p_gross bigint,p_tax bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;c dvnt_settlement.checkouts%ROWTYPE; v_release_at timestamptz; existing_release timestamptz; delay_seconds int;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 -- Serialize the liability representation change with every currency budget read.
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id FOR UPDATE;
 SELECT greatest(c.release_not_before,dvnt_settlement.event_release_at(id)) INTO STRICT v_release_at FROM public.events WHERE id=o.event_id;
 SELECT s.release_at INTO existing_release FROM dvnt_settlement.orders s WHERE order_id=o.id;
 IF v_release_at IS NULL OR p_tax<0 OR p_gross IS DISTINCT FROM (c.snapshot->'order'->>'total_cents')::bigint+p_tax
  OR o.stripe_payment_intent_id IS DISTINCT FROM p_pi OR p_currency IS DISTINCT FROM c.snapshot->'order'->>'currency'
  OR c.last_error LIKE 'hold:%' OR o.status IN ('refunded','partially_refunded','disputed','canceled','cancelled','failed') THEN RAISE EXCEPTION 'source not eligible'; END IF;
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.orders WHERE order_id=o.id) THEN
  UPDATE public.orders SET status='paid',total_cents=p_gross,tax_cents=p_tax,paid_at=coalesce(paid_at,now()) WHERE id=o.id;
  -- Enrollment must invalidate old balances even when status was already paid.
  UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 END IF;
 PERFORM dvnt_settlement.enroll(o.id,p_charge,p_pi,p_currency,p_gross,coalesce(existing_release,v_release_at));
 UPDATE dvnt_settlement.orders SET release_at=greatest(dvnt_settlement.orders.release_at,v_release_at) WHERE order_id=o.id;
 UPDATE dvnt_settlement.checkouts SET source_verified_at=now(),last_error=NULL,outcome_unknown_since=NULL,
  next_check_at=NULL,retired_at=NULL,reconciliation_attempts=0 WHERE order_id=o.id;
 -- Source verification is not an override for refund/dispute/manual holds.
 UPDATE dvnt_settlement.orders SET blocked=false,block_reason='source_verified'
  WHERE order_id=o.id AND block_reason='awaiting_release_review'
    AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.holds WHERE order_id=o.id);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.settlement_balance_checkpoint() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT jsonb_build_object('epoch',funding_epoch) FROM dvnt_settlement.controls WHERE singleton; $$;

CREATE FUNCTION public.settlement_reserve(p_allocation uuid,p_destination text,p_available bigint,p_balance_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a dvnt_settlement.allocations%ROWTYPE; o public.orders%ROWTYPE;
 e public.events%ROWTYPE; expected text; pending bigint; protected_commission bigint; risk_reserve bigint; result jsonb; c dvnt_settlement.checkouts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT a FROM dvnt_settlement.allocations WHERE id=p_allocation;
 SELECT * INTO STRICT o FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO STRICT e FROM public.events WHERE id=o.event_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id;
 -- Global budget mutex serializes reservations against the caller's verified
 -- balance snapshot. Uncertain/reserved amounts remain fully reserved.
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 IF e.status IN ('cancelled','canceled') OR e.payout_status='disabled' OR EXISTS(SELECT 1 FROM dvnt_settlement.event_stops WHERE event_id=e.id AND reason<>'dispute_only')
 OR (e.payout_status='on_hold' AND NOT(c.organizer_user_id=ANY(ARRAY(SELECT unnest(owner_host_ids) FROM dvnt_settlement.controls WHERE singleton)) AND EXISTS(SELECT 1 FROM dvnt_settlement.event_stops WHERE event_id=e.id AND reason='dispute_only'))) THEN RAISE EXCEPTION 'event dispute or operational hold'; END IF;
 IF greatest(c.release_not_before,dvnt_settlement.event_release_at(e.id))>now() THEN RAISE EXCEPTION 'release window pending'; END IF;
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts WHERE order_id=o.id AND source_verified_at>now()-interval '60 seconds') THEN
  RAISE EXCEPTION 'source verification stale'; END IF;
 IF a.role='organizer' THEN SELECT stripe_account_id INTO expected FROM public.organizer_accounts WHERE host_id=a.recipient_id;
 ELSE SELECT coalesce(ep.stripe_account_id,oa.stripe_account_id) INTO expected FROM public.event_promoters ep
  LEFT JOIN public.organizer_accounts oa ON oa.host_id=a.recipient_user_id WHERE ep.id::text=a.recipient_id; END IF;
 IF expected IS NULL OR expected IS DISTINCT FROM p_destination THEN RAISE EXCEPTION 'recipient binding mismatch'; END IF;
 -- Held promoter liabilities remain reserved even without an account or
 -- after an error. In-flight/unknown sends are counted once, never twice.
 SELECT coalesce(sum(x.amount_cents),0) INTO pending FROM dvnt_settlement.allocations x
  JOIN dvnt_settlement.deliveries d ON d.allocation_id=x.id JOIN dvnt_settlement.orders s ON s.order_id=x.order_id
  WHERE d.state IN ('reserved','uncertain') AND s.currency=o.currency;
 SELECT coalesce(sum(x.amount_cents),0) INTO protected_commission FROM dvnt_settlement.allocations x
  JOIN dvnt_settlement.deliveries d ON d.allocation_id=x.id JOIN dvnt_settlement.orders s ON s.order_id=x.order_id
  WHERE x.role='promoter' AND x.id<>a.id AND d.state='held' AND s.currency=o.currency
    AND NOT dvnt_settlement.promoter_obligation_satisfied(x.id);
 -- A successful new-model payment can precede enrollment. Its frozen
 -- commission cannot be spent in that webhook/verification gap. Payment-pending
 -- checkout attempts do not pretend money exists. Legacy orders stay excluded.
 SELECT protected_commission+coalesce(sum((q.snapshot->'order'->>'promoter_commission_amount_cents')::bigint),0)
 INTO protected_commission FROM dvnt_settlement.checkouts q JOIN public.orders src ON src.id=q.order_id
 WHERE src.charge_model='separate_charges_and_transfers' AND src.status IN ('paid','partially_refunded','disputed')
  AND src.currency=o.currency AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.orders enrolled WHERE enrolled.order_id=src.id);
 SELECT reserve_cents INTO risk_reserve FROM dvnt_settlement.currency_reserves WHERE currency=o.currency;
 IF risk_reserve IS NULL THEN RAISE EXCEPTION 'platform risk reserve funding policy missing'; END IF;
 IF p_balance_epoch IS DISTINCT FROM (SELECT funding_epoch FROM dvnt_settlement.controls WHERE singleton)
  OR p_available IS NULL OR p_available<pending+protected_commission+risk_reserve+dvnt_settlement.unsettled_outflows(o.currency)+a.amount_cents THEN
  RAISE EXCEPTION 'insufficient unreserved funds';
 END IF;
 result:=dvnt_settlement.reserve(a.id,p_destination);
 UPDATE dvnt_settlement.deliveries SET last_error=NULL WHERE allocation_id=a.id;
 RETURN result || jsonb_build_object('order_id',o.id,'transfer_group','dvnt_settlement_'||o.id::text);
END $$;
CREATE FUNCTION public.settlement_hold(p_order_id uuid,p_event_id text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.orders WHERE order_id=p_order_id) THEN
  PERFORM dvnt_settlement.hold(p_order_id,p_event_id,p_reason);
 END IF;
 -- A pre-enrollment hold must persist as well, so verification cannot bypass it.
 IF p_reason IN ('refund','dispute','manual') THEN
  UPDATE dvnt_settlement.checkouts SET last_error='hold:'||p_reason WHERE order_id=p_order_id;
 ELSE RAISE EXCEPTION 'invalid hold'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.settlement_uncertain(p_allocation uuid,p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid;
BEGIN
 SELECT order_id INTO STRICT oid FROM dvnt_settlement.allocations WHERE id=p_allocation;
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 UPDATE dvnt_settlement.deliveries SET state='uncertain' WHERE allocation_id=p_allocation AND state='reserved';
 UPDATE dvnt_settlement.checkouts SET last_error=left(p_error,200) WHERE order_id=oid;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.settlement_reconcile_transfer(p_allocation uuid,p_transfer text,p_destination text,p_charge text,p_currency text,p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Lock the same budget mutex before recording completion. A completed
 -- transfer invalidates every previously observed available-balance snapshot.
 PERFORM 1 FROM public.orders WHERE id=(SELECT order_id FROM dvnt_settlement.allocations WHERE id=p_allocation) FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 PERFORM dvnt_settlement.reconcile_transfer(p_allocation,p_transfer,p_destination,p_charge,p_currency,p_amount);
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 UPDATE dvnt_settlement.deliveries SET completed_at=coalesce(completed_at,clock_timestamp()),last_error=NULL WHERE allocation_id=p_allocation;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.lookup_settlement_checkout(p_rail text,p_request_key text,p_user_id text,p_guest_email text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('exists',EXISTS(SELECT 1 FROM dvnt_settlement.checkouts WHERE
 request_scope=p_rail||':'||coalesce(p_user_id,lower(p_guest_email))||':'||p_request_key));
$$;
REVOKE ALL ON FUNCTION public.lookup_settlement_checkout(text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_settlement_checkout(text,text,text,text) TO service_role;

CREATE FUNCTION dvnt_settlement.hold_on_money_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.charge_model='separate_charges_and_transfers' AND NEW.status IS DISTINCT FROM OLD.status
 AND NEW.status IN ('refunded','partially_refunded','disputed','cancelled','canceled') THEN
  PERFORM public.settlement_hold(NEW.id,'order-state:'||NEW.status,
   CASE WHEN NEW.status='disputed' THEN 'dispute' ELSE 'refund' END);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.hold_on_money_state() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER settlement_money_state_hold AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.hold_on_money_state();

-- A newly paid checkout changes the protected-liability set. Serialize its
-- commit with reservations, invalidating pre-commit available-balance reads.
CREATE FUNCTION dvnt_settlement.funding_liability_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.charge_model='separate_charges_and_transfers' AND NEW.status IS DISTINCT FROM OLD.status THEN
  UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dvnt_settlement.funding_liability_changed() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER settlement_funding_liability_change AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.funding_liability_changed();

CREATE FUNCTION public.settlement_legacy_event_eligible(p_event_id int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('eligible',NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c
 JOIN public.orders o ON o.id=c.order_id WHERE o.event_id=p_event_id));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM service_role;

CREATE FUNCTION public.settlement_actor_summary(p_actor text,p_event_id int) RETURNS jsonb
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
 sum(a.amount_cents)::bigint AS amount_cents,count(*)::int AS allocation_count
 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.orders s ON s.order_id=a.order_id
 JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id JOIN public.orders o ON o.id=a.order_id
 WHERE o.event_id=p_event_id AND p_actor IS NOT NULL AND a.recipient_user_id=p_actor
 GROUP BY s.currency,a.role,stage
 ) summary;
$$;

CREATE FUNCTION public.settlement_processing_error(p_order_id uuid,p_code text,p_allocation uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_code NOT IN ('onboarding_required','recipient_restricted','funding_required','source_audit_limit','source_verification_stale','verification_required','hold_required','promoter_pending','platform_payout_policy_unverified') THEN RAISE EXCEPTION 'unknown processing reason'; END IF;
 IF p_allocation IS NULL THEN
  UPDATE dvnt_settlement.checkouts SET last_error=p_code WHERE order_id=p_order_id AND coalesce(last_error,'') NOT LIKE 'hold:%';
 ELSE
  UPDATE dvnt_settlement.deliveries SET last_error=p_code WHERE allocation_id=p_allocation
   AND EXISTS(SELECT 1 FROM dvnt_settlement.allocations a WHERE a.id=p_allocation AND a.order_id=p_order_id);
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- No client JWT may read or invoke these internal financial operations.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND (p.proname LIKE 'settlement_%' OR p.proname IN ('prepare_settlement_checkout','claim_settlement_checkout','finalize_settlement_checkout')) LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
 END LOOP;
END $$;
-- Runtime financial mutations must enter through the checked public wrappers.
-- Foundation-only low-level grants would bypass funding/source/refund gates.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM service_role;
COMMIT;
