-- DRAFT: assemble LAST. Empty policy; no opening balance is ever credited.
-- This ledger is not physical provider segregation.
BEGIN;
CREATE TABLE dvnt_settlement.funding_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 platform_account text NOT NULL CHECK(platform_account ~ '^acct_[A-Za-z0-9_]+$'),
 livemode boolean NOT NULL, audit_from bigint NOT NULL CHECK(audit_from>=0),
 policy_reference text NOT NULL CHECK(length(btrim(policy_reference))>0)
);
CREATE TABLE dvnt_settlement.funding_sources (
 order_id uuid PRIMARY KEY REFERENCES dvnt_settlement.orders(order_id),
 transaction_id text NOT NULL UNIQUE, proof jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE dvnt_settlement.funding_debits (
 transaction_id text PRIMARY KEY, currency text NOT NULL,
 net_cents bigint NOT NULL CHECK(net_cents<0), proof jsonb NOT NULL
);
CREATE TABLE dvnt_settlement.funding_audits (
 currency text PRIMARY KEY, funding_epoch bigint NOT NULL,
 available_cents bigint NOT NULL CHECK(available_cents>=0),
 provider_available_cents bigint NOT NULL CHECK(provider_available_cents>=0),
 credited_cents bigint NOT NULL CHECK(credited_cents>=0),
 debited_cents bigint NOT NULL CHECK(debited_cents>=0),
 observed_at timestamptz NOT NULL, transaction_count integer NOT NULL
);
ALTER TABLE dvnt_settlement.funding_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.funding_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.funding_debits ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.funding_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.funding_policy,dvnt_settlement.funding_sources,
 dvnt_settlement.funding_debits,dvnt_settlement.funding_audits FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_funding_policy BEFORE UPDATE OR DELETE ON dvnt_settlement.funding_policy
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_allocation_change();
CREATE TRIGGER immutable_funding_source BEFORE UPDATE OR DELETE ON dvnt_settlement.funding_sources
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_allocation_change();
CREATE TRIGGER immutable_funding_debit BEFORE UPDATE OR DELETE ON dvnt_settlement.funding_debits
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_allocation_change();

-- Reviewed risk-policy changes use the same budget mutex before touching any
-- policy row. Both increases and decreases invalidate all old audit snapshots.
-- BEFORE STATEMENT preserves controls→policy row lock order for bulk DML.
-- TRUNCATE takes ACCESS EXCLUSIVE before its trigger, so it cannot join that
-- lock order: reject it immediately without waiting on the controls mutex.
CREATE FUNCTION dvnt_settlement.risk_policy_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'risk policy TRUNCATE is unsupported; use reviewed DELETE'; END IF;
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 RETURN NULL;
END $$;
CREATE TRIGGER settlement_risk_policy_change BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE
 ON dvnt_settlement.currency_reserves FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.risk_policy_changed();

-- The immutable epoch must predate all new-model checkouts. Moving it forward
-- could erase debits, so configuration is a reviewed rollout step, never an RPC.
CREATE FUNCTION dvnt_settlement.require_funding_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.funding_policy WHERE singleton
   AND audit_from<=floor(extract(epoch FROM NEW.created_at))) THEN
  RAISE EXCEPTION 'source-accounted funding policy missing'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prepared_checkout_funding_policy BEFORE INSERT ON dvnt_settlement.checkouts
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.require_funding_policy();
CREATE OR REPLACE FUNCTION public.settlement_balance_checkpoint() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('epoch',c.funding_epoch,'observed_at',clock_timestamp(),
  'funding_policy',CASE WHEN p.singleton IS NULL THEN NULL ELSE to_jsonb(p)-'policy_reference'-'singleton' END)
 FROM dvnt_settlement.controls c LEFT JOIN dvnt_settlement.funding_policy p ON p.singleton WHERE c.singleton;
$$;

-- Only the trusted provider adapter calls this after verifying succeeded PI,
-- separate charge, frozen economics and the actual expanded balance transaction.
CREATE FUNCTION public.settlement_record_funding_source(p_order_id uuid,p_platform_account text,p_proof jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s dvnt_settlement.orders%ROWTYPE; o public.orders%ROWTYPE;
 policy dvnt_settlement.funding_policy%ROWTYPE; prior jsonb;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT policy FROM dvnt_settlement.funding_policy WHERE singleton;
 SELECT * INTO STRICT s FROM dvnt_settlement.orders WHERE order_id=p_order_id;
 IF p_platform_account IS DISTINCT FROM policy.platform_account OR o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers'
 OR p_proof->>'id' IS NULL OR p_proof->>'id' !~ '^txn_[A-Za-z0-9_]+$'
 OR p_proof->>'source' IS DISTINCT FROM s.charge_id OR p_proof->>'currency' IS DISTINCT FROM s.currency
 OR p_proof->>'type' NOT IN ('charge','payment') OR p_proof->>'type' IS NULL
 OR (p_proof->>'amount')::bigint IS DISTINCT FROM s.gross_cents
 OR (p_proof->>'fee')::bigint IS NULL OR (p_proof->>'fee')::bigint<0
 OR (p_proof->>'net')::bigint IS DISTINCT FROM s.gross_cents-(p_proof->>'fee')::bigint
 OR (p_proof->>'net')::bigint<s.distributable_cents+coalesce(o.tax_cents,0)
 OR (p_proof->>'tax')::bigint IS DISTINCT FROM coalesce(o.tax_cents,0)
 OR (p_proof->>'created')::bigint IS NULL OR (p_proof->>'created')::bigint<policy.audit_from
 OR (p_proof->>'created')::bigint>floor(extract(epoch FROM clock_timestamp()))
 OR p_proof->>'status' IS DISTINCT FROM 'available'
 THEN RAISE EXCEPTION 'source-accounted funding proof mismatch'; END IF;
 SELECT proof INTO prior FROM dvnt_settlement.funding_sources WHERE order_id=p_order_id;
 IF FOUND THEN
  IF prior IS DISTINCT FROM p_proof THEN RAISE EXCEPTION 'immutable funding source mismatch'; END IF;
  RETURN jsonb_build_object('ok',true,'duplicate',true);
 END IF;
 INSERT INTO dvnt_settlement.funding_sources(order_id,transaction_id,proof) VALUES(p_order_id,p_proof->>'id',p_proof);
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 RETURN jsonb_build_object('ok',true,'duplicate',false);
END $$;

-- Adapter exhausts the unfiltered platform balance-transaction list and repeats
-- the head page to detect concurrent entries. Positive unknowns contribute zero.
-- All debits persist (pending too); uncertain DB liabilities remain reserved.
CREATE FUNCTION public.settlement_record_funding_audit(p_currency text,p_available bigint,p_balance_epoch bigint,
 p_started_at timestamptz,p_platform_account text,p_livemode boolean,p_audit_from bigint,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE policy dvnt_settlement.funding_policy%ROWTYPE; t jsonb; prior jsonb;
 credits bigint:=0; debits bigint:=0; spendable bigint; inserted int; new_debit boolean:=false; audit_epoch bigint;
BEGIN
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 SELECT * INTO STRICT policy FROM dvnt_settlement.funding_policy WHERE singleton;
 IF p_platform_account IS DISTINCT FROM policy.platform_account OR p_livemode IS DISTINCT FROM policy.livemode
 OR p_audit_from IS DISTINCT FROM policy.audit_from OR p_balance_epoch IS DISTINCT FROM (SELECT funding_epoch FROM dvnt_settlement.controls WHERE singleton)
 OR p_started_at IS NULL OR p_started_at<clock_timestamp()-interval '60 seconds' OR p_started_at>clock_timestamp()
 OR p_currency IS NULL OR p_currency !~ '^[a-z]{3}$' OR p_available IS NULL OR p_available<0
 OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' OR jsonb_array_length(p_transactions)>10000 THEN
  RAISE EXCEPTION 'source-accounted funding audit invalid or stale'; END IF;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.funding_audits WHERE currency=p_currency AND observed_at>p_started_at) THEN
  RAISE EXCEPTION 'source-accounted funding audit stale'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_transactions)) IS DISTINCT FROM
    (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_transactions) x) THEN RAISE EXCEPTION 'duplicate funding transaction'; END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  IF t->>'id' IS NULL OR t->>'id' !~ '^txn_[A-Za-z0-9_]+$' OR t->>'currency' IS NULL OR t->>'currency' !~ '^[a-z]{3}$'
   OR t->>'status' IS NULL OR t->>'status' NOT IN ('pending','available')
   OR t->>'type' IS NULL OR (t->>'created')::bigint IS NULL OR (t->>'created')::bigint<policy.audit_from
   OR (t->>'created')::bigint>floor(extract(epoch FROM clock_timestamp()))
   OR (t->>'amount')::bigint IS NULL OR (t->>'fee')::bigint IS NULL
   OR (t->>'net')::bigint IS DISTINCT FROM (t->>'amount')::bigint-(t->>'fee')::bigint THEN
   RAISE EXCEPTION 'invalid funding transaction'; END IF;
  IF (t->>'net')::bigint<0 THEN
   SELECT proof INTO prior FROM dvnt_settlement.funding_debits WHERE transaction_id=t->>'id';
   IF FOUND AND prior IS DISTINCT FROM t-'status' THEN RAISE EXCEPTION 'immutable funding debit mismatch'; END IF;
   INSERT INTO dvnt_settlement.funding_debits(transaction_id,currency,net_cents,proof)
    VALUES(t->>'id',t->>'currency',(t->>'net')::bigint,t-'status') ON CONFLICT(transaction_id) DO NOTHING;
   GET DIAGNOSTICS inserted=ROW_COUNT; new_debit:=new_debit OR inserted>0;
  ELSIF t->>'status'='available' AND t->>'currency'=p_currency THEN
   SELECT proof INTO prior FROM dvnt_settlement.funding_sources WHERE transaction_id=t->>'id';
   IF FOUND THEN
    IF prior-'tax' IS DISTINCT FROM t THEN RAISE EXCEPTION 'funding source transaction mismatch'; END IF;
    credits:=credits+(t->>'net')::bigint-(prior->>'tax')::bigint;
   END IF;
  END IF;
 END LOOP;
 IF new_debit THEN UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton; END IF;
 SELECT funding_epoch INTO audit_epoch FROM dvnt_settlement.controls WHERE singleton;
 SELECT coalesce(-sum(net_cents),0) INTO debits FROM dvnt_settlement.funding_debits WHERE currency=p_currency;
 spendable:=greatest(0,least(p_available,credits-debits));
 INSERT INTO dvnt_settlement.funding_audits VALUES(p_currency,audit_epoch,spendable,p_available,credits,debits,p_started_at,jsonb_array_length(p_transactions))
 ON CONFLICT(currency) DO UPDATE SET funding_epoch=excluded.funding_epoch,available_cents=excluded.available_cents,
 provider_available_cents=excluded.provider_available_cents,credited_cents=excluded.credited_cents,
 debited_cents=excluded.debited_cents,observed_at=excluded.observed_at,transaction_count=excluded.transaction_count;
 RETURN jsonb_build_object('ok',true,'available',spendable,'epoch',audit_epoch);
END $$;

-- Wrap LAST so external-proof/promoter rules are preserved. No old raw-balance
-- public service entrypoint remains reachable.
ALTER FUNCTION public.settlement_reserve(uuid,text,bigint,bigint) RENAME TO reserve_before_funding;
ALTER FUNCTION public.reserve_before_funding(uuid,text,bigint,bigint) SET SCHEMA dvnt_settlement;
CREATE FUNCTION public.settlement_reserve(p_allocation uuid,p_destination text,p_available bigint,p_balance_epoch bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE currency_code text; audit dvnt_settlement.funding_audits%ROWTYPE; risk_floor bigint; protected_budget bigint;
BEGIN
 SELECT o.currency INTO STRICT currency_code FROM public.orders o JOIN dvnt_settlement.allocations a ON a.order_id=o.id
  WHERE a.id=p_allocation FOR UPDATE OF o;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 SELECT * INTO audit FROM dvnt_settlement.funding_audits f
  WHERE f.currency=currency_code AND f.funding_epoch=p_balance_epoch
   AND f.funding_epoch=(SELECT funding_epoch FROM dvnt_settlement.controls WHERE singleton)
   AND f.observed_at>clock_timestamp()-interval '60 seconds' AND p_available BETWEEN 0 AND f.available_cents;
 IF NOT FOUND OR p_available IS NULL THEN
  RAISE EXCEPTION 'source-accounted funding audit missing or stale'; END IF;
 SELECT reserve_cents INTO risk_floor FROM dvnt_settlement.currency_reserves WHERE currency=currency_code;
 IF risk_floor IS NULL OR risk_floor<0 THEN RAISE EXCEPTION 'platform risk reserve funding policy missing'; END IF;
 IF risk_floor>audit.provider_available_cents THEN RAISE EXCEPTION 'insufficient unreserved funds'; END IF;
 -- Inner reserve checks L + floor <= budget, where L is this payout plus all
 -- pending/unknown sends, protected commissions and refund/dispute liabilities.
 -- Use min(actual, authenticated_source_cap + floor) only inside this call:
 --   L <= authenticated_source_cap AND L + floor <= audited actual available.
 -- Thus extra actual balance covers ONLY the buffer inequality, never a source
 -- deficit. Capital provenance is a separate operational gate.
 -- Do not persist/return this adjusted number as a source credit.
 -- Numeric addition avoids bigint overflow before the bounded cast. The same
 -- controls mutex prevents the policy trigger changing floor between these two
 -- reads; the unchanged private implementation counts every liability once.
 protected_budget:=least(audit.provider_available_cents::numeric,p_available::numeric+risk_floor::numeric)::bigint;
 RETURN dvnt_settlement.reserve_before_funding(p_allocation,p_destination,protected_budget,p_balance_epoch);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.settlement_record_funding_source(uuid,text,jsonb),
 public.settlement_record_funding_audit(text,bigint,bigint,timestamptz,text,boolean,bigint,jsonb),
 public.settlement_reserve(uuid,text,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_record_funding_source(uuid,text,jsonb),
 public.settlement_record_funding_audit(text,bigint,bigint,timestamptz,text,boolean,bigint,jsonb),
 public.settlement_reserve(uuid,text,bigint,bigint) TO service_role;
COMMIT;
