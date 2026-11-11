-- DRAFT ONLY. Private recovery/bank extension; execution disabled by default.
BEGIN;
ALTER TABLE dvnt_settlement.controls ADD COLUMN recovery_enabled boolean NOT NULL DEFAULT false;
CREATE TABLE dvnt_settlement.refunds (
 refund_id text PRIMARY KEY CHECK(refund_id LIKE 're_%'),order_id uuid NOT NULL REFERENCES public.orders(id),
 charge_id text NOT NULL,currency text NOT NULL,amount_cents bigint NOT NULL CHECK(amount_cents>0),
 full_refund boolean NOT NULL,eligible_cents bigint,basis_cents bigint,unit_key text,
 state text NOT NULL CHECK(state IN('quarantined','allocated')),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(eligible_cents IS NULL OR eligible_cents BETWEEN 0 AND amount_cents),
 CHECK(basis_cents IS NULL OR basis_cents>0),UNIQUE(order_id,unit_key)
);
CREATE TABLE dvnt_settlement.recoveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),refund_id text NOT NULL REFERENCES dvnt_settlement.refunds(refund_id),
 allocation_id uuid NOT NULL REFERENCES dvnt_settlement.allocations(id),amount_cents bigint NOT NULL CHECK(amount_cents>0),
 state text NOT NULL DEFAULT 'open' CHECK(state IN('open','attempted','uncertain','recovered')),
 transfer_id text,last_error text, idempotency_key text NOT NULL UNIQUE,reversal_id text UNIQUE,attempted_at timestamptz,completed_at timestamptz,
 UNIQUE(refund_id,allocation_id)
);
CREATE TABLE dvnt_settlement.bank_events (
 event_id text PRIMARY KEY,account text NOT NULL,payout_id text NOT NULL,event_created bigint NOT NULL,
 state text NOT NULL CHECK(state IN('paid','failed','reconcile')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dvnt_settlement.bank_proofs (
 allocation_id uuid PRIMARY KEY REFERENCES dvnt_settlement.allocations(id),account text NOT NULL,
 transfer_id text NOT NULL,destination_payment text NOT NULL,transaction_id text NOT NULL UNIQUE,
 payout_id text NOT NULL,proof jsonb NOT NULL,state text NOT NULL CHECK(state IN('paid','pending','failed')),
 event_created bigint NOT NULL,verified_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE dvnt_settlement.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.bank_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.bank_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.refunds,dvnt_settlement.recoveries,dvnt_settlement.bank_events,dvnt_settlement.bank_proofs FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.settlement_record_refund(p_order_id uuid,p_refund_id text,p_charge_id text,p_amount bigint,p_currency text,
 p_full boolean,p_eligible bigint DEFAULT NULL,p_basis bigint DEFAULT NULL,p_unit_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;c dvnt_settlement.checkouts%ROWTYPE;old dvnt_settlement.refunds%ROWTYPE;
 a record; eligible bigint; prior bigint; target bigint; delta bigint; valid boolean;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id FOR UPDATE;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR p_amount<=0 OR p_amount>o.total_cents
 OR p_currency IS DISTINCT FROM o.currency OR p_refund_id NOT LIKE 're_%' OR p_charge_id NOT LIKE 'ch_%'
 OR EXISTS(SELECT 1 FROM dvnt_settlement.orders WHERE order_id=o.id AND charge_id IS DISTINCT FROM p_charge_id)
 THEN RAISE EXCEPTION 'refund source mismatch'; END IF;
 PERFORM public.settlement_hold(o.id,p_refund_id,'refund');
 SELECT * INTO old FROM dvnt_settlement.refunds WHERE refund_id=p_refund_id;
 IF FOUND THEN
  IF old.order_id IS DISTINCT FROM o.id OR old.charge_id IS DISTINCT FROM p_charge_id OR old.currency IS DISTINCT FROM p_currency
   OR old.amount_cents IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'refund replay mismatch'; END IF;
  IF old.state='allocated' THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  -- A later verified full refund can close previously unknown partial exposure.
  IF NOT p_full THEN RETURN jsonb_build_object('ok',true,'quarantined',true); END IF;
 END IF;
 valid:=p_full OR (c.snapshot->'selection'->>'ticket_type_id' IS NOT NULL AND
  p_basis=(c.snapshot->'order'->>'subtotal_cents')::bigint AND p_basis>0 AND p_eligible>=0 AND p_eligible<=p_amount AND
  p_eligible<=p_basis AND p_unit_key LIKE 'ticket:%');
 IF NOT p_full AND EXISTS(SELECT 1 FROM dvnt_settlement.refunds WHERE order_id=o.id AND unit_key=p_unit_key AND refund_id<>p_refund_id) THEN valid:=false; END IF;
 INSERT INTO dvnt_settlement.refunds(refund_id,order_id,charge_id,currency,amount_cents,full_refund,eligible_cents,basis_cents,unit_key,state)
 VALUES(p_refund_id,o.id,p_charge_id,p_currency,p_amount,p_full,CASE WHEN valid AND NOT p_full THEN p_eligible END,
  CASE WHEN valid AND NOT p_full THEN p_basis END,CASE WHEN valid AND NOT p_full THEN p_unit_key END,
  CASE WHEN valid THEN 'allocated' ELSE 'quarantined' END)
 ON CONFLICT(refund_id) DO UPDATE SET full_refund=true,state='allocated',eligible_cents=NULL,basis_cents=NULL,unit_key=NULL;
 IF NOT coalesce(valid,false) THEN RETURN jsonb_build_object('ok',true,'quarantined',true); END IF;
 SELECT coalesce(sum(eligible_cents),0) INTO eligible FROM dvnt_settlement.refunds WHERE order_id=o.id AND state='allocated';
 IF NOT p_full AND eligible>p_basis THEN RAISE EXCEPTION 'refunded eligible amount exceeds frozen allocation'; END IF;
 FOR a IN SELECT * FROM dvnt_settlement.allocations WHERE order_id=o.id ORDER BY id LOOP
  SELECT coalesce(sum(amount_cents),0) INTO prior FROM dvnt_settlement.recoveries WHERE allocation_id=a.id;
  target:=CASE WHEN p_full THEN a.amount_cents ELSE floor(a.amount_cents::numeric*eligible/p_basis)::bigint END;
  delta:=greatest(0,target-prior);
  IF prior+delta>a.amount_cents THEN RAISE EXCEPTION 'recovery exceeds allocation'; END IF;
  IF delta>0 THEN INSERT INTO dvnt_settlement.recoveries(refund_id,allocation_id,amount_cents,idempotency_key)
   VALUES(p_refund_id,a.id,delta,'dvnt:recovery:v1:'||a.id::text||':'||p_refund_id); END IF;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'quarantined',false);
END $$;

CREATE FUNCTION public.settlement_recovery(p_recovery_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT to_jsonb(r)||jsonb_build_object('transfer_id',coalesce(r.transfer_id,d.stripe_transfer_id))
 FROM dvnt_settlement.recoveries r JOIN dvnt_settlement.deliveries d ON d.allocation_id=r.allocation_id WHERE r.id=p_recovery_id;
$$;
CREATE FUNCTION public.settlement_claim_recovery(p_recovery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r dvnt_settlement.recoveries%ROWTYPE;d dvnt_settlement.deliveries%ROWTYPE;oid uuid;
BEGIN
 SELECT a.order_id INTO STRICT oid FROM dvnt_settlement.recoveries x JOIN dvnt_settlement.allocations a ON a.id=x.allocation_id WHERE x.id=p_recovery_id;
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 SELECT * INTO STRICT r FROM dvnt_settlement.recoveries WHERE id=p_recovery_id FOR UPDATE;
 IF NOT (SELECT recovery_enabled FROM dvnt_settlement.controls WHERE singleton) THEN RAISE EXCEPTION 'recovery disabled'; END IF;
 IF r.state<>'open' THEN RETURN jsonb_build_object('ok',true,'claimed',false); END IF;
 SELECT * INTO STRICT d FROM dvnt_settlement.deliveries WHERE allocation_id=r.allocation_id FOR UPDATE;
 IF d.stripe_transfer_id IS NULL OR d.state NOT IN('transferred','recovery_required') THEN RAISE EXCEPTION 'outgoing transfer outcome not proven'; END IF;
 UPDATE dvnt_settlement.recoveries SET state='attempted',attempted_at=now(),transfer_id=d.stripe_transfer_id WHERE id=r.id;
 RETURN public.settlement_recovery(r.id)||jsonb_build_object('ok',true,'claimed',true);
END $$;
CREATE FUNCTION public.settlement_uncertain_recovery(p_recovery_id uuid,p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE dvnt_settlement.recoveries SET state='uncertain',last_error=left(p_error,500) WHERE id=p_recovery_id AND state='attempted';
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.settlement_finish_recovery(p_recovery_id uuid,p_reversal_id text,p_amount bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r dvnt_settlement.recoveries%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM dvnt_settlement.recoveries WHERE id=p_recovery_id FOR UPDATE;
 IF p_amount IS DISTINCT FROM r.amount_cents OR p_reversal_id NOT LIKE 'trr_%' OR r.transfer_id IS NULL OR
 r.state NOT IN('attempted','uncertain','recovered') OR (r.reversal_id IS NOT NULL AND r.reversal_id IS DISTINCT FROM p_reversal_id)
 THEN RAISE EXCEPTION 'recovery result mismatch'; END IF;
 UPDATE dvnt_settlement.recoveries SET state='recovered',reversal_id=p_reversal_id,completed_at=coalesce(completed_at,now()) WHERE id=r.id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.settlement_bank_event(p_account text,p_payout text,p_event_id text,p_created bigint,p_state text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old dvnt_settlement.bank_events%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dvnt:bank:'||p_account,0));
 IF p_account NOT LIKE 'acct_%' OR p_payout NOT LIKE 'po_%' OR p_created<0 OR p_state NOT IN('paid','failed','reconcile') OR length(p_event_id)=0
 THEN RAISE EXCEPTION 'invalid bank event'; END IF;
 SELECT * INTO old FROM dvnt_settlement.bank_events WHERE event_id=p_event_id;
 IF FOUND AND ROW(old.account,old.payout_id,old.event_created,old.state) IS DISTINCT FROM ROW(p_account,p_payout,p_created,p_state)
 THEN RAISE EXCEPTION 'bank event replay mismatch'; END IF;
 INSERT INTO dvnt_settlement.bank_events(event_id,account,payout_id,event_created,state)
 VALUES(p_event_id,p_account,p_payout,p_created,p_state) ON CONFLICT DO NOTHING;
 -- A payout.paid event alone never proves that an allocation reached a bank.
 IF p_state='failed' THEN
  UPDATE dvnt_settlement.bank_proofs SET state='failed',event_created=p_created
   WHERE account=p_account AND payout_id=p_payout AND event_created<=p_created;
  UPDATE dvnt_settlement.deliveries d SET bank_payout_state='failed' FROM dvnt_settlement.bank_proofs b
   WHERE b.allocation_id=d.allocation_id AND b.account=p_account AND b.payout_id=p_payout AND b.state='failed';
 END IF;
 UPDATE dvnt_settlement.recovery_scans s SET not_before=now() WHERE s.kind='bank' AND s.work_key LIKE '%:'||p_payout;
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.settlement_bank_proof(p_allocation uuid,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d dvnt_settlement.deliveries%ROWTYPE;b dvnt_settlement.bank_proofs%ROWTYPE;failed_at bigint;stamp bigint;v_state text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dvnt:bank:'||(p_proof->>'account'),0));
 SELECT * INTO STRICT d FROM dvnt_settlement.deliveries WHERE allocation_id=p_allocation FOR UPDATE;
 IF d.stripe_transfer_id IS DISTINCT FROM p_proof->>'transferId' OR d.destination IS DISTINCT FROM p_proof->>'account'
 OR d.state NOT IN('transferred','recovery_required') OR p_proof->>'destinationPayment' NOT LIKE 'py_%'
 OR p_proof->>'transactionId' NOT LIKE 'txn_%' OR p_proof->>'payoutId' NOT LIKE 'po_%'
 OR (p_proof->>'grossCents')::bigint IS DISTINCT FROM (SELECT amount_cents FROM dvnt_settlement.allocations WHERE id=p_allocation)
 OR p_proof->>'netContributionCents' IS NULL OR (p_proof->>'netContributionCents')::bigint<1 OR (p_proof->>'netContributionCents')::bigint>(p_proof->>'grossCents')::bigint
 OR p_proof->>'currency' IS DISTINCT FROM (SELECT o.currency FROM dvnt_settlement.orders o JOIN dvnt_settlement.allocations a ON a.order_id=o.order_id WHERE a.id=p_allocation)
 OR p_proof->>'status' NOT IN('paid','pending','failed') OR (p_proof->>'created')::bigint<0
 THEN RAISE EXCEPTION 'bank proof linkage mismatch'; END IF;
 stamp:=(p_proof->>'created')::bigint;v_state:=p_proof->>'status';
 SELECT max(event_created) INTO failed_at FROM dvnt_settlement.bank_events
  WHERE account=d.destination AND payout_id=p_proof->>'payoutId' AND state='failed';
 IF failed_at IS NOT NULL THEN v_state:='failed';stamp:=greatest(stamp,failed_at); END IF;
 SELECT * INTO b FROM dvnt_settlement.bank_proofs WHERE allocation_id=p_allocation;
 IF FOUND THEN
  IF b.account IS DISTINCT FROM d.destination OR b.transfer_id IS DISTINCT FROM d.stripe_transfer_id OR
   b.destination_payment IS DISTINCT FROM p_proof->>'destinationPayment' OR b.transaction_id IS DISTINCT FROM p_proof->>'transactionId'
   THEN RAISE EXCEPTION 'bank proof source changed'; END IF;
  IF b.event_created>stamp OR (b.payout_id=p_proof->>'payoutId' AND b.state='failed') THEN
   RETURN jsonb_build_object('ok',true,'state',b.state,'stale',true); END IF;
 END IF;
 INSERT INTO dvnt_settlement.bank_proofs(allocation_id,account,transfer_id,destination_payment,transaction_id,payout_id,proof,state,event_created)
 VALUES(p_allocation,d.destination,d.stripe_transfer_id,p_proof->>'destinationPayment',p_proof->>'transactionId',p_proof->>'payoutId',p_proof,v_state,stamp)
 ON CONFLICT(allocation_id) DO UPDATE SET payout_id=excluded.payout_id,proof=excluded.proof,state=excluded.state,event_created=excluded.event_created,verified_at=now();
 UPDATE dvnt_settlement.deliveries SET bank_payout_state=v_state WHERE allocation_id=p_allocation;
 RETURN jsonb_build_object('ok',true,'state',v_state);
END $$;
-- Durable fair queues lease a page before returning it. A bad first page can
-- never permanently hide later work. Expired leases retry after a worker crash.
CREATE TABLE dvnt_settlement.recovery_scans (
 kind text NOT NULL CHECK(kind IN('bank','refund','recovery')),work_key text NOT NULL,
 not_before timestamptz NOT NULL,last_checked timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,work_key)
);
ALTER TABLE dvnt_settlement.recovery_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.recovery_scans FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.settlement_recovery_wake(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE dvnt_settlement.recovery_scans SET not_before=now() WHERE kind='refund' AND work_key=p_order_id::text;
 RETURN jsonb_build_object('ok',true);
END $$;
-- bank_payout_state=paid means proven inclusion in a paid automatic batch,
-- not an assertion that the allocation gross was deposited without fees.
CREATE FUNCTION public.settlement_bank_candidates(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;work record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dvnt:bank_scan',0));
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT a.id,a.order_id,a.amount_cents,d.destination,d.stripe_transfer_id,o.currency,e.payout_id
 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
 JOIN dvnt_settlement.orders o ON o.order_id=a.order_id
 JOIN (SELECT account,payout_id,max(event_created) AS newest FROM dvnt_settlement.bank_events GROUP BY account,payout_id) e ON e.account=d.destination
 LEFT JOIN dvnt_settlement.recovery_scans scan ON scan.kind='bank' AND scan.work_key=a.id::text||':'||e.payout_id
 WHERE d.state IN('transferred','recovery_required') AND d.stripe_transfer_id IS NOT NULL
 AND (scan.not_before IS NULL OR scan.not_before<=now())
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.bank_proofs b WHERE b.allocation_id=a.id AND (b.state='paid' OR (b.payout_id=e.payout_id AND b.state='failed')))
 ORDER BY scan.last_checked NULLS FIRST,a.id,e.payout_id LIMIT greatest(1,least(p_limit,1000))
 ) x;
 FOR work IN SELECT value FROM jsonb_array_elements(result) LOOP
  INSERT INTO dvnt_settlement.recovery_scans(kind,work_key,not_before) VALUES('bank',(work.value->>'id')||':'||(work.value->>'payout_id'),now()+interval '5 minutes')
  ON CONFLICT(kind,work_key) DO UPDATE SET not_before=excluded.not_before,last_checked=now();
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.settlement_refund_candidates(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;work record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dvnt:refund_scan',0));
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT o.id AS order_id FROM public.orders o JOIN dvnt_settlement.checkouts c ON c.order_id=o.id
 LEFT JOIN dvnt_settlement.recovery_scans scan ON scan.kind='refund' AND scan.work_key=o.id::text
 WHERE o.charge_model='separate_charges_and_transfers' AND o.stripe_payment_intent_id IS NOT NULL
 AND (o.status IN('refunded','partially_refunded') OR c.last_error='hold:refund')
 AND (scan.not_before IS NULL OR scan.not_before<=now())
 ORDER BY scan.last_checked NULLS FIRST,c.created_at LIMIT greatest(1,least(p_limit,1000))
 ) x;
 FOR work IN SELECT value FROM jsonb_array_elements(result) LOOP
  INSERT INTO dvnt_settlement.recovery_scans(kind,work_key,not_before) VALUES('refund',work.value->>'order_id',now()+interval '5 minutes')
  ON CONFLICT(kind,work_key) DO UPDATE SET not_before=excluded.not_before,last_checked=now();
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.settlement_recovery_candidates(p_limit int DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;work record;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('dvnt:recovery_scan',0));
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO result FROM (
 SELECT r.id,r.state FROM dvnt_settlement.recoveries r JOIN dvnt_settlement.deliveries d ON d.allocation_id=r.allocation_id
 LEFT JOIN dvnt_settlement.recovery_scans scan ON scan.kind='recovery' AND scan.work_key=r.id::text
 WHERE r.state IN('open','attempted','uncertain') AND d.stripe_transfer_id IS NOT NULL
 AND (scan.not_before IS NULL OR scan.not_before<=now())
 ORDER BY scan.last_checked NULLS FIRST,r.id LIMIT greatest(1,least(p_limit,1000))
 ) x;
 FOR work IN SELECT value FROM jsonb_array_elements(result) LOOP
  INSERT INTO dvnt_settlement.recovery_scans(kind,work_key,not_before) VALUES('recovery',work.value->>'id',now()+interval '5 minutes')
  ON CONFLICT(kind,work_key) DO UPDATE SET not_before=excluded.not_before,last_checked=now();
 END LOOP;
 RETURN result;
END $$;
DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN('settlement_record_refund','settlement_recovery','settlement_claim_recovery','settlement_uncertain_recovery',
 'settlement_recovery_wake','settlement_finish_recovery','settlement_bank_event','settlement_bank_proof','settlement_bank_candidates','settlement_refund_candidates','settlement_recovery_candidates') LOOP
 EXECUTE 'REVOKE ALL ON FUNCTION '||f.sig||' FROM PUBLIC,anon,authenticated';
 EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.sig||' TO service_role';END LOOP;
END $$;
COMMIT;
