BEGIN;
-- Every local new-ledger refund is claimed before provider I/O. Unknown outcomes
-- retain their maximum debit; only exact provider evidence releases the budget.
CREATE TABLE dvnt_settlement.refund_outflows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES public.orders(id),
 request_key text NOT NULL,request_body jsonb NOT NULL,currency text NOT NULL,unit_key text,
 amount_cents bigint NOT NULL CHECK(amount_cents>0),request_amount bigint,
 state text NOT NULL DEFAULT 'attempted' CHECK(state IN('attempted','uncertain','submitted','settled','canceled')),
 refund_id text UNIQUE,proof jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(order_id,request_key),UNIQUE(order_id,unit_key)
);
CREATE TABLE dvnt_settlement.dispute_outflows (
 order_id uuid PRIMARY KEY REFERENCES public.orders(id),currency text NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents>0),state text NOT NULL DEFAULT 'manual_review' CHECK(state='manual_review'),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dvnt_settlement.refund_outflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.dispute_outflows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.refund_outflows,dvnt_settlement.dispute_outflows FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION dvnt_settlement.unsettled_outflows(p_currency text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT sum(amount_cents) FROM dvnt_settlement.refund_outflows WHERE currency=p_currency AND state IN('attempted','uncertain','submitted')),0)
 +coalesce((SELECT sum(amount_cents) FROM dvnt_settlement.dispute_outflows WHERE currency=p_currency),0);
$$;
REVOKE ALL ON FUNCTION dvnt_settlement.unsettled_outflows(text) FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.settlement_hold(uuid,text,text) RENAME TO settlement_hold_without_outflows;
REVOKE ALL ON FUNCTION public.settlement_hold_without_outflows(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_hold(p_order_id uuid,p_event_id text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 PERFORM public.settlement_hold_without_outflows(p_order_id,p_event_id,p_reason);
 IF p_reason='dispute' THEN
  INSERT INTO dvnt_settlement.dispute_outflows(order_id,currency,amount_cents) VALUES(o.id,o.currency,o.total_cents)
   ON CONFLICT(order_id) DO NOTHING;
 END IF;
 -- Also invalidate balances observed before an externally reported refund/hold.
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.settlement_refund_outflow_begin(p_order_id uuid,p_request_key text,p_body jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; intent dvnt_settlement.refund_outflows%ROWTYPE; amount bigint;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR p_body->>'payment_intent' IS DISTINCT FROM o.stripe_payment_intent_id
 OR p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 8 AND 200 OR jsonb_typeof(p_body)<>'object'
 OR o.currency IS NULL OR o.total_cents IS NULL OR o.total_cents<=0 THEN RAISE EXCEPTION 'invalid refund debit intent'; END IF;
 IF p_body ? 'amount' THEN
  IF p_body->>'amount' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid refund amount'; END IF;
  amount:=(p_body->>'amount')::bigint;
  IF amount<=0 OR amount>o.total_cents THEN RAISE EXCEPTION 'invalid refund amount'; END IF;
 END IF;
 SELECT * INTO intent FROM dvnt_settlement.refund_outflows WHERE order_id=o.id AND request_key=p_request_key;
 IF FOUND THEN
  IF intent.request_body IS DISTINCT FROM p_body THEN RAISE EXCEPTION 'refund debit replay mismatch'; END IF;
  RETURN jsonb_build_object('ok',true,'claimed',false,'id',intent.id,'state',intent.state);
 END IF;
 -- Different keys cannot bypass an ambiguous whole-order/partial attempt.
 IF EXISTS(SELECT 1 FROM dvnt_settlement.refund_outflows WHERE order_id=o.id AND state IN('attempted','uncertain','submitted'))
 THEN RAISE EXCEPTION 'refund debit requires reconciliation'; END IF;
 PERFORM public.settlement_hold(o.id,'refund_request:'||p_request_key,'refund');
 INSERT INTO dvnt_settlement.refund_outflows(order_id,request_key,request_body,currency,amount_cents,request_amount,unit_key)
 VALUES(o.id,p_request_key,p_body,o.currency,coalesce(amount,o.total_cents),amount,
 CASE WHEN amount IS NULL THEN 'whole_order'
 WHEN p_body->>'metadata[ticket_id]' IS NOT NULL THEN 'ticket:'||(p_body->>'metadata[ticket_id]')
 WHEN p_body->>'metadata[cart_line_item_id]' IS NOT NULL THEN 'cart_line:'||(p_body->>'metadata[cart_line_item_id]') END) RETURNING * INTO intent;
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 RETURN jsonb_build_object('ok',true,'claimed',true,'id',intent.id,'state',intent.state);
END $$;
CREATE FUNCTION public.settlement_refund_outflow_observe(p_intent uuid,p_refund_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; intent dvnt_settlement.refund_outflows%ROWTYPE;
BEGIN
 SELECT order_id INTO STRICT oid FROM dvnt_settlement.refund_outflows WHERE id=p_intent;
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT intent FROM dvnt_settlement.refund_outflows WHERE id=p_intent FOR UPDATE;
 IF p_refund_id IS NOT NULL AND (p_refund_id !~ '^re_[A-Za-z0-9_]+$' OR intent.refund_id IS NOT NULL AND intent.refund_id<>p_refund_id)
 THEN RAISE EXCEPTION 'refund debit response mismatch'; END IF;
 IF intent.state IN('settled','canceled') THEN RETURN jsonb_build_object('ok',true); END IF;
 UPDATE dvnt_settlement.refund_outflows SET state=CASE WHEN p_refund_id IS NULL THEN 'uncertain' ELSE 'submitted' END,
 refund_id=coalesce(p_refund_id,refund_id) WHERE id=p_intent;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.settlement_refund_outflow_reconcile(p_intent uuid,p_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; intent dvnt_settlement.refund_outflows%ROWTYPE; o public.orders%ROWTYPE; target text; amount bigint;
BEGIN
 SELECT order_id INTO STRICT oid FROM dvnt_settlement.refund_outflows WHERE id=p_intent;
 SELECT * INTO STRICT o FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT intent FROM dvnt_settlement.refund_outflows WHERE id=p_intent FOR UPDATE;
 amount:=(p_proof->>'amount')::bigint;
 IF p_proof->>'intent_id' IS DISTINCT FROM intent.id::text OR p_proof->>'order_id' IS DISTINCT FROM oid::text
 OR p_proof->>'payment_intent' IS DISTINCT FROM o.stripe_payment_intent_id OR p_proof->>'currency' IS DISTINCT FROM intent.currency
 OR p_proof->>'refund_id' IS NULL OR p_proof->>'refund_id' !~ '^re_[A-Za-z0-9_]+$'
 OR (intent.refund_id IS NOT NULL AND intent.refund_id IS DISTINCT FROM p_proof->>'refund_id')
 OR amount IS NULL OR amount<=0 OR amount>intent.amount_cents OR (intent.request_amount IS NOT NULL AND amount<>intent.request_amount)
 THEN RAISE EXCEPTION 'refund debit evidence mismatch'; END IF;
 IF p_proof->>'status'='succeeded' THEN
  IF p_proof->>'transaction_id' IS NULL OR p_proof->>'transaction_id' !~ '^txn_[A-Za-z0-9_]+$'
   OR p_proof->>'transaction_source' IS DISTINCT FROM p_proof->>'refund_id'
   OR p_proof->>'transaction_currency' IS DISTINCT FROM intent.currency
   OR (p_proof->>'transaction_amount')::bigint IS DISTINCT FROM -amount
   OR p_proof->>'transaction_status' IS DISTINCT FROM 'available'
   OR p_proof->>'transaction_type' IS DISTINCT FROM 'refund' THEN RAISE EXCEPTION 'refund debit balance proof missing'; END IF;
  target:='settled';
 ELSIF p_proof->>'status' IN('failed','canceled') THEN
  -- If a failed refund has any debit transaction, funds returning to available
  -- must be proven separately. Keep it reserved for manual review instead.
  IF NOT(p_proof ? 'transaction_id') OR NOT(p_proof ? 'failure_transaction_id')
   OR p_proof->>'transaction_id' IS NOT NULL OR p_proof->>'failure_transaction_id' IS NOT NULL
   THEN RAISE EXCEPTION 'failed refund balance requires review'; END IF;
  target:='canceled';
 ELSE RAISE EXCEPTION 'refund debit remains pending'; END IF;
 IF intent.state IN('settled','canceled') THEN
  IF intent.state<>target OR intent.proof IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'refund debit terminal evidence mismatch'; END IF;
  RETURN jsonb_build_object('ok',true,'duplicate',true);
 END IF;
 UPDATE dvnt_settlement.refund_outflows SET state=target,refund_id=p_proof->>'refund_id',proof=p_proof,completed_at=now() WHERE id=p_intent;
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 RETURN jsonb_build_object('ok',true,'state',target);
END $$;
REVOKE ALL ON FUNCTION public.settlement_hold(uuid,text,text),public.settlement_refund_outflow_begin(uuid,text,jsonb),public.settlement_refund_outflow_observe(uuid,text),public.settlement_refund_outflow_reconcile(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_hold(uuid,text,text),public.settlement_refund_outflow_begin(uuid,text,jsonb),public.settlement_refund_outflow_observe(uuid,text),public.settlement_refund_outflow_reconcile(uuid,jsonb) TO service_role;
COMMIT;
