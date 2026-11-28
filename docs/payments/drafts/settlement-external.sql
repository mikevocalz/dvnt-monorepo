-- DRAFT ONLY. Apply AFTER ledger, runtime, recovery and observability in an isolated
-- test database. Not a production migration; no payment is initiated by this SQL.
BEGIN;

-- Empty by default. Only a separately reviewed database administrator can
-- provision operators and already-verified recipient bindings. Event ownership,
-- co-organizer roles, and possession of a promoter link confer no permission.
CREATE TABLE dvnt_settlement.external_operators (
 actor_id text PRIMARY KEY CHECK(length(actor_id) BETWEEN 1 AND 128),
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE dvnt_settlement.external_recipients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 promoter_id uuid NOT NULL REFERENCES public.event_promoters(id),
 provider text NOT NULL CHECK(provider ~ '^[a-z][a-z0-9_-]{1,31}$' AND provider <> 'stripe'),
 beneficiary_reference text NOT NULL CHECK(length(beneficiary_reference) BETWEEN 1 AND 128),
 recipient_user_id text,
 verified_by text NOT NULL REFERENCES dvnt_settlement.external_operators(actor_id),
 verified_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(promoter_id,provider,beneficiary_reference)
);
CREATE TABLE dvnt_settlement.external_promoter_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_key uuid NOT NULL UNIQUE,
 event_id int NOT NULL REFERENCES public.events(id),
 promoter_id uuid NOT NULL REFERENCES public.event_promoters(id),
 recipient_binding_id uuid NOT NULL REFERENCES dvnt_settlement.external_recipients(id),
 recipient_user_id text,
 actor_id text NOT NULL REFERENCES dvnt_settlement.external_operators(actor_id),
 provider text NOT NULL,
 transaction_reference text NOT NULL CHECK(length(transaction_reference) BETWEEN 1 AND 160),
 receipt_sha256 text NOT NULL UNIQUE CHECK(receipt_sha256 ~ '^[a-f0-9]{64}$'),
 -- Opaque reference to an access-controlled, immutable receipt object/version,
 -- never a public URL, account number, raw receipt body, or fabricated Stripe ID.
 receipt_reference text NOT NULL CHECK(receipt_reference ~ '^[a-z][a-z0-9_-]{0,31}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$'),
 evidence_status text NOT NULL CHECK(evidence_status='completed'),
 attestation jsonb NOT NULL,
 paid_at timestamptz NOT NULL CHECK(isfinite(paid_at)),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 currency text NOT NULL CHECK(currency ~ '^[a-z]{3}$'),
 ledger_entry_ids uuid[] NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,transaction_reference)
);
ALTER TABLE public.promoter_ledger_entries ADD COLUMN external_settlement_id uuid
 REFERENCES dvnt_settlement.external_promoter_payments(id);
CREATE TABLE dvnt_settlement.external_promoter_rows (
 ledger_entry_id uuid PRIMARY KEY REFERENCES public.promoter_ledger_entries(id),
 settlement_id uuid NOT NULL REFERENCES dvnt_settlement.external_promoter_payments(id),
 order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 promoter_id uuid NOT NULL REFERENCES public.event_promoters(id),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 currency text NOT NULL,
 recipient_user_id text
);
-- This barrier survives event hold clearing, release-date changes and all
-- promoter bookkeeping. Never calculate another aggregate organizer payout.
CREATE TABLE dvnt_settlement.external_event_exclusions (
 event_id int PRIMARY KEY REFERENCES public.events(id),
 first_settlement_id uuid NOT NULL REFERENCES dvnt_settlement.external_promoter_payments(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
-- Permanent tombstone: a legacy runner might have crossed its DB claim and be
-- executing against Stripe. No timeout or reset can prove that it did not pay.
CREATE TABLE dvnt_settlement.legacy_execution_claims (
 event_id int PRIMARY KEY REFERENCES public.events(id),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dvnt_settlement.external_recovery_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 settlement_id uuid NOT NULL REFERENCES dvnt_settlement.external_promoter_payments(id),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 reason text NOT NULL CHECK(reason IN ('refund','dispute','manual','cancellation','ledger_reversal')),
 source_reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(order_id,reason,source_reference)
);

CREATE FUNCTION dvnt_settlement.reject_external_change() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'external settlement evidence is immutable'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['external_recipients','external_promoter_payments','external_promoter_rows','external_event_exclusions','legacy_execution_claims','external_recovery_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_external BEFORE UPDATE OR DELETE ON dvnt_settlement.%I FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_external_change()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['external_operators','external_recipients','external_promoter_payments','external_promoter_rows','external_event_exclusions','legacy_execution_claims','external_recovery_reviews'] LOOP
  EXECUTE format('ALTER TABLE dvnt_settlement.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON dvnt_settlement.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;

-- Old ('processing') event claims serialize on the event row with recording.
-- The conservative runner MUST use settlement_claim_legacy_event below; an
-- ordinary dispute/manual on_hold update is not proof of financial execution.
-- Existing claims before installation cannot be inferred: drain all old workers
-- and audit in-flight/uncertain outcomes before enabling this recording RPC.
CREATE FUNCTION dvnt_settlement.guard_legacy_event_claim() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.payout_status='processing' AND NEW.payout_status IS DISTINCT FROM OLD.payout_status THEN
  IF EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=NEW.id) THEN
   RAISE EXCEPTION 'external settlement excludes legacy event execution';
  END IF;
  INSERT INTO dvnt_settlement.legacy_execution_claims(event_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_legacy_event_claim BEFORE UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_legacy_event_claim();

-- Atomic financial claim replaces the conservative worker's naked on_hold CAS.
CREATE FUNCTION public.settlement_claim_legacy_event(p_event_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.events%ROWTYPE;
BEGIN
 SELECT * INTO STRICT e FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF e.payout_status IS DISTINCT FROM 'pending' THEN RETURN jsonb_build_object('claimed',false); END IF;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=e.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_execution_claims WHERE event_id=e.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id WHERE o.event_id=e.id)
 THEN RAISE EXCEPTION 'legacy event execution excluded or previously claimed'; END IF;
 INSERT INTO dvnt_settlement.legacy_execution_claims(event_id) VALUES(e.id);
 UPDATE public.events SET payout_status='on_hold' WHERE id=e.id;
 RETURN jsonb_build_object('claimed',true);
END $$;
REVOKE ALL ON FUNCTION public.settlement_claim_legacy_event(int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_claim_legacy_event(int) TO service_role;

CREATE FUNCTION dvnt_settlement.guard_legacy_payout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.events WHERE id=NEW.event_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=NEW.event_id) THEN
  RAISE EXCEPTION 'external settlement excludes legacy payout';
 END IF;
 INSERT INTO dvnt_settlement.legacy_execution_claims(event_id) VALUES(NEW.event_id) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER external_legacy_payout BEFORE INSERT OR UPDATE ON public.payouts
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_legacy_payout();

-- Exact source lock is shared by external recording and the Stripe reserver.
-- Also protects low-level/private calls, not just the public worker RPC.
CREATE FUNCTION dvnt_settlement.guard_external_delivery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a dvnt_settlement.allocations%ROWTYPE;
BEGIN
 -- Bank proof/failure bookkeeping already locks delivery first. It cannot
 -- initiate another transfer, so do not invert the source→delivery lock order.
 IF TG_OP='UPDATE' AND ROW(NEW.state,NEW.stripe_transfer_id)
 IS NOT DISTINCT FROM ROW(OLD.state,OLD.stripe_transfer_id) THEN RETURN NEW; END IF;
 IF NEW.state='held' AND NEW.stripe_transfer_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO STRICT a FROM dvnt_settlement.allocations WHERE id=NEW.allocation_id;
 PERFORM 1 FROM public.orders WHERE id=a.order_id FOR UPDATE;
 IF a.role='promoter' AND (NEW.state<>'held' OR NEW.stripe_transfer_id IS NOT NULL)
 AND EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=a.order_id) THEN
  RAISE EXCEPTION 'promoter obligation already settled externally';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_delivery_interlock BEFORE INSERT OR UPDATE ON dvnt_settlement.deliveries
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_external_delivery();

-- The settlement stamp can never be erased or converted into a Stripe transfer.
-- Later refund reversal entries remain possible and are separate obligations.
CREATE FUNCTION dvnt_settlement.guard_external_ledger() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x dvnt_settlement.external_promoter_rows%ROWTYPE; paid timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.external_settlement_id IS NOT NULL THEN RAISE EXCEPTION 'external settlement linkage requires protected recording'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO x FROM dvnt_settlement.external_promoter_rows WHERE ledger_entry_id=OLD.id;
 IF NOT FOUND THEN
  IF TG_OP='UPDATE' AND NEW.external_settlement_id IS NOT NULL THEN RAISE EXCEPTION 'external settlement linkage requires protected recording'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'externally settled ledger is immutable'; END IF;
 SELECT paid_at INTO STRICT paid FROM dvnt_settlement.external_promoter_payments WHERE id=x.settlement_id;
 IF ROW(NEW.id,NEW.order_id,NEW.event_id,NEW.promoter_id,NEW.entry_type,NEW.amount_cents,NEW.currency)
 IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.event_id,OLD.promoter_id,OLD.entry_type,OLD.amount_cents,OLD.currency)
 OR NEW.paid_out_at IS DISTINCT FROM paid OR NEW.payout_status IS DISTINCT FROM 'paid'
 OR NEW.external_settlement_id IS DISTINCT FROM x.settlement_id
 OR NEW.stripe_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'externally settled ledger is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_ledger_interlock BEFORE INSERT OR UPDATE OR DELETE ON public.promoter_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.guard_external_ledger();

-- Legacy source identity/economics also remain frozen; moving a paid order to
-- another event must never escape that event's permanent aggregate exclusion.
CREATE FUNCTION dvnt_settlement.freeze_external_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows WHERE order_id=OLD.id)
 AND ROW(NEW.id,NEW.event_id,NEW.charge_model,NEW.stripe_payment_intent_id,NEW.currency,NEW.total_cents,
 NEW.subtotal_cents,NEW.organizer_fee_cents,NEW.promoter_id,NEW.promoter_code,NEW.promoter_commission_amount_cents,NEW.type)
 IS DISTINCT FROM ROW(OLD.id,OLD.event_id,OLD.charge_model,OLD.stripe_payment_intent_id,OLD.currency,OLD.total_cents,
 OLD.subtotal_cents,OLD.organizer_fee_cents,OLD.promoter_id,OLD.promoter_code,OLD.promoter_commission_amount_cents,OLD.type)
 THEN RAISE EXCEPTION 'externally settled source economics are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_source_freeze BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_external_source();

-- Service-only attestation API, not an end-user endpoint. p_actor MUST come from
-- the trusted operator's verified session, never an arbitrary request body.
-- Receipt bytes, provider completion and beneficiary must be independently
-- reviewed BEFORE this call. The DB verifies exact scope, not receipt authenticity.
CREATE FUNCTION public.settlement_record_external_promoter_payment(
 p_actor text, p_request_key uuid, p_event_id int, p_promoter_id uuid,
 p_recipient_binding_id uuid, p_ledger_entry_ids uuid[], p_amount_cents bigint,
 p_currency text, p_provider text, p_transaction_reference text,
 p_receipt_sha256 text, p_receipt_reference text, p_evidence_status text,
 p_paid_at timestamptz, p_receipt_beneficiary_reference text, p_attestation jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing dvnt_settlement.external_promoter_payments%ROWTYPE;
 recipient dvnt_settlement.external_recipients%ROWTYPE; promoter public.event_promoters%ROWTYPE;
 e public.events%ROWTYPE; ids uuid[]; row_count int; total bigint; sid uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_operators WHERE actor_id=p_actor AND enabled) THEN
  RAISE EXCEPTION 'external settlement operator not authorized'; END IF;
 IF p_attestation IS DISTINCT FROM '{"independently_checked_completed_final":true,"receipt_retained":true,"recipient_and_details_match":true}'::jsonb
 OR p_receipt_beneficiary_reference IS NULL
 OR p_request_key IS NULL OR p_evidence_status IS DISTINCT FROM 'completed'
 OR p_paid_at IS NULL OR NOT isfinite(p_paid_at) OR p_paid_at>clock_timestamp()
 OR p_amount_cents IS NULL OR p_amount_cents<=0 OR p_currency IS NULL OR p_currency !~ '^[a-z]{3}$'
 OR p_provider IS NULL OR p_provider !~ '^[a-z][a-z0-9_-]{1,31}$' OR p_provider='stripe'
 OR p_transaction_reference IS NULL OR p_transaction_reference<>btrim(p_transaction_reference)
 OR length(p_transaction_reference) NOT BETWEEN 1 AND 160
 OR p_receipt_sha256 IS NULL OR p_receipt_sha256 !~ '^[a-f0-9]{64}$'
 OR p_receipt_reference IS NULL OR p_receipt_reference<>btrim(p_receipt_reference)
 OR p_receipt_reference !~ '^[a-z][a-z0-9_-]{0,31}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$'
 OR p_ledger_entry_ids IS NULL OR cardinality(p_ledger_entry_ids) NOT BETWEEN 1 AND 1000
 OR array_position(p_ledger_entry_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'completed payment evidence and exact scope required'; END IF;
 SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT DISTINCT unnest(p_ledger_entry_ids) id) q;
 IF cardinality(ids)<>cardinality(p_ledger_entry_ids) THEN RAISE EXCEPTION 'duplicate ledger scope'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('external:'||p_request_key::text,0));
 SELECT * INTO existing FROM dvnt_settlement.external_promoter_payments WHERE request_key=p_request_key;
 IF FOUND THEN
  IF ROW(existing.actor_id,existing.event_id,existing.promoter_id,existing.recipient_binding_id,existing.ledger_entry_ids,
    existing.amount_cents,existing.currency,existing.provider,existing.transaction_reference,existing.receipt_sha256,
    existing.receipt_reference,existing.evidence_status,existing.paid_at,existing.attestation)
  IS DISTINCT FROM ROW(p_actor,p_event_id,p_promoter_id,p_recipient_binding_id,ids,p_amount_cents,p_currency,p_provider,
    p_transaction_reference,p_receipt_sha256,p_receipt_reference,p_evidence_status,p_paid_at,p_attestation)
  THEN RAISE EXCEPTION 'external payment replay mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_recipients WHERE id=existing.recipient_binding_id AND beneficiary_reference=p_receipt_beneficiary_reference) THEN RAISE EXCEPTION 'recipient binding mismatch'; END IF;
  RETURN jsonb_build_object('id',existing.id,'recorded',true,'status','paid_externally','replayed',true);
 END IF;
 SELECT * INTO STRICT e FROM public.events WHERE id=p_event_id FOR UPDATE;
 -- Require a deliberate quarantine. This does not bypass event/order holds.
 IF e.payout_status IS DISTINCT FROM 'on_hold' OR e.payout_release_at IS NOT NULL
 OR e.status IN ('cancelled','canceled')
 OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_execution_claims WHERE event_id=e.id)
 OR EXISTS(SELECT 1 FROM public.payouts WHERE event_id=e.id) THEN RAISE EXCEPTION 'event execution requires reconciliation'; END IF;
 SELECT * INTO STRICT promoter FROM public.event_promoters WHERE id=p_promoter_id FOR SHARE;
 SELECT * INTO STRICT recipient FROM dvnt_settlement.external_recipients WHERE id=p_recipient_binding_id;
 IF promoter.event_id IS DISTINCT FROM p_event_id OR recipient.promoter_id IS DISTINCT FROM p_promoter_id
 OR recipient.recipient_user_id IS DISTINCT FROM promoter.user_id
 OR recipient.provider IS DISTINCT FROM p_provider OR recipient.beneficiary_reference IS DISTINCT FROM p_receipt_beneficiary_reference THEN RAISE EXCEPTION 'recipient binding mismatch'; END IF;
 -- Lock source orders in deterministic order, exactly as the transfer reserver
 -- does; a prior reserved/uncertain/transferred intent wins and requires review.
 PERFORM 1 FROM public.orders WHERE id IN(SELECT order_id FROM public.promoter_ledger_entries WHERE id=ANY(ids)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 PERFORM 1 FROM public.promoter_ledger_entries WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 SELECT count(*),coalesce(sum(l.amount_cents),0) INTO row_count,total
 FROM public.promoter_ledger_entries l JOIN public.orders o ON o.id=l.order_id
 JOIN public.promoter_attributions pa ON pa.order_id=o.id AND pa.promoter_id=l.promoter_id
 WHERE l.id=ANY(ids) AND l.event_id=p_event_id AND o.event_id=p_event_id AND l.promoter_id=p_promoter_id
 AND l.entry_type='earning' AND l.amount_cents>0 AND l.currency=p_currency AND o.currency=p_currency
 AND o.status='paid' AND o.type='event_ticket' AND l.paid_out_at IS NULL AND l.stripe_transfer_id IS NULL AND l.payout_status IN ('pending','held')
 AND NOT EXISTS(SELECT 1 FROM public.promoter_ledger_entries reversal WHERE reversal.order_id=o.id AND reversal.entry_type='reversal')
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.holds h WHERE h.order_id=o.id)
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c WHERE c.order_id=o.id AND
  (coalesce(c.last_error,'') LIKE 'hold:%' OR c.promoter_id IS DISTINCT FROM p_promoter_id
   OR c.promoter_user_id IS DISTINCT FROM recipient.recipient_user_id
   OR (c.snapshot->'order'->>'promoter_commission_amount_cents')::bigint IS DISTINCT FROM l.amount_cents::bigint
   OR c.snapshot->'order'->>'currency' IS DISTINCT FROM p_currency))
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
  WHERE a.order_id=o.id AND a.role='promoter' AND (d.state<>'held' OR d.stripe_transfer_id IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.orders s ON s.order_id=a.order_id
  WHERE a.order_id=o.id AND a.role='promoter' AND (a.recipient_id<>p_promoter_id::text OR a.recipient_user_id IS DISTINCT FROM recipient.recipient_user_id OR a.amount_cents<>l.amount_cents OR s.currency<>p_currency))
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=o.id);
 IF row_count<>cardinality(ids) OR total<>p_amount_cents THEN RAISE EXCEPTION 'ledger scope count, amount, recipient, currency or eligibility mismatch'; END IF;
 INSERT INTO dvnt_settlement.external_promoter_payments(request_key,event_id,promoter_id,recipient_binding_id,recipient_user_id,
 actor_id,provider,transaction_reference,receipt_sha256,receipt_reference,evidence_status,paid_at,amount_cents,currency,ledger_entry_ids,attestation)
 VALUES(p_request_key,p_event_id,p_promoter_id,p_recipient_binding_id,recipient.recipient_user_id,p_actor,p_provider,p_transaction_reference,
 p_receipt_sha256,p_receipt_reference,p_evidence_status,p_paid_at,p_amount_cents,p_currency,ids,p_attestation) RETURNING id INTO sid;
 INSERT INTO dvnt_settlement.external_promoter_rows(ledger_entry_id,settlement_id,order_id,promoter_id,amount_cents,currency,recipient_user_id)
 SELECT l.id,sid,l.order_id,l.promoter_id,l.amount_cents,l.currency,recipient.recipient_user_id FROM public.promoter_ledger_entries l WHERE l.id=ANY(ids);
 INSERT INTO dvnt_settlement.external_event_exclusions(event_id,first_settlement_id) VALUES(p_event_id,sid) ON CONFLICT DO NOTHING;
 UPDATE public.promoter_ledger_entries SET paid_out_at=p_paid_at,payout_status='paid',external_settlement_id=sid,
 payout_note='Paid externally; protected receipt-backed settlement' WHERE id=ANY(ids) AND paid_out_at IS NULL;
 GET DIAGNOSTICS row_count=ROW_COUNT;
 IF row_count<>cardinality(ids) THEN RAISE EXCEPTION 'external settlement stamp count mismatch'; END IF;
 UPDATE dvnt_settlement.controls SET funding_epoch=funding_epoch+1 WHERE singleton;
 RETURN jsonb_build_object('id',sid,'recorded',true,'status','paid_externally','replayed',false);
END $$;

-- Contract shared with promoter-first host reservation. External evidence never
-- masquerades as Stripe transfer or bank-payout membership. Recovery holds win.
CREATE OR REPLACE FUNCTION dvnt_settlement.promoter_obligation_satisfied(p_allocation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM dvnt_settlement.allocations a
 JOIN dvnt_settlement.orders s ON s.order_id=a.order_id JOIN public.orders o ON o.id=a.order_id
 JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
 WHERE a.id=p_allocation AND a.role='promoter' AND o.status='paid'
 AND NOT s.blocked AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_recovery_reviews r WHERE r.order_id=a.order_id)
 AND NOT EXISTS(SELECT 1 FROM public.promoter_ledger_entries r WHERE r.order_id=a.order_id AND r.entry_type='reversal')
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.holds h WHERE h.order_id=a.order_id)
 AND ((d.state='transferred' AND d.stripe_transfer_id IS NOT NULL)
 OR (d.state='held' AND d.stripe_transfer_id IS NULL AND EXISTS(
  SELECT 1 FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=a.order_id
  AND x.promoter_id::text=a.recipient_id AND x.recipient_user_id IS NOT DISTINCT FROM a.recipient_user_id
  AND x.amount_cents=a.amount_cents AND x.currency=s.currency))));
$$;

CREATE OR REPLACE FUNCTION public.settlement_legacy_event_eligible(p_event_id int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('eligible',NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c
 JOIN public.orders o ON o.id=c.order_id WHERE o.event_id=p_event_id)
 AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=p_event_id));
$$;
CREATE OR REPLACE FUNCTION public.settlement_actor_summary(p_actor text,p_event_id int) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('verified',true,'rows',coalesce(jsonb_agg(to_jsonb(summary)),'[]'::jsonb)) FROM (
 SELECT s.currency,a.role AS recipient_role,
 CASE WHEN d.state IN ('uncertain','recovery_required') OR d.last_error IS NOT NULL THEN 'needs_review'
 WHEN d.state='held' THEN 'awaiting_settlement' WHEN d.state='reserved' THEN 'transfer_submitted'
 WHEN d.bank_payout_state='failed' THEN 'bank_failed' WHEN d.bank_payout_state='paid' THEN 'bank_paid'
 WHEN d.bank_payout_state='pending' THEN 'bank_pending' ELSE 'in_connected_balance' END AS stage,
 sum(a.amount_cents)::bigint AS amount_cents,count(*)::int AS allocation_count,
 CASE WHEN count(bp.allocation_id)=count(*) THEN sum((bp.proof->>'netContributionCents')::bigint) END AS bank_net_contribution_cents
 FROM dvnt_settlement.allocations a JOIN dvnt_settlement.orders s ON s.order_id=a.order_id
 JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id LEFT JOIN dvnt_settlement.bank_proofs bp ON bp.allocation_id=a.id
 JOIN public.orders o ON o.id=a.order_id
 WHERE o.event_id=p_event_id AND p_actor IS NOT NULL AND a.recipient_user_id=p_actor
 AND NOT(a.role='promoter' AND EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=a.order_id))
 GROUP BY s.currency,a.role,stage
 UNION ALL
 SELECT x.currency,'promoter',CASE WHEN o.status<>'paid' OR EXISTS(SELECT 1 FROM dvnt_settlement.external_recovery_reviews r WHERE r.order_id=o.id)
 OR EXISTS(SELECT 1 FROM public.promoter_ledger_entries r WHERE r.order_id=o.id AND r.entry_type='reversal')
 OR EXISTS(SELECT 1 FROM dvnt_settlement.holds h WHERE h.order_id=o.id)
 THEN 'external_needs_review' ELSE 'paid_externally' END,
 sum(x.amount_cents)::bigint,count(*)::int,NULL::bigint
 FROM dvnt_settlement.external_promoter_rows x JOIN dvnt_settlement.external_promoter_payments p ON p.id=x.settlement_id
 JOIN public.orders o ON o.id=x.order_id
 WHERE p.event_id=p_event_id AND p_actor IS NOT NULL AND x.recipient_user_id=p_actor
 GROUP BY x.currency,3
 ) summary;
$$;

-- Append-only recovery provenance. External money cannot be reversed through
-- Stripe; a later refund/dispute/reversal requires an explicit manual workflow.
CREATE FUNCTION dvnt_settlement.flag_external_recovery() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE oid uuid; why text; ref text;
BEGIN
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='orders' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('refunded','partially_refunded','disputed','cancelled','canceled') THEN RETURN NEW; END IF;
  oid:=NEW.id; why:=CASE WHEN NEW.status='disputed' THEN 'dispute' WHEN NEW.status IN ('cancelled','canceled') THEN 'cancellation' ELSE 'refund' END;
  ref:='order-state:'||NEW.status;
 ELSIF TG_TABLE_SCHEMA='dvnt_settlement' AND TG_TABLE_NAME='checkouts' THEN
  IF NEW.last_error IS NOT DISTINCT FROM OLD.last_error OR coalesce(NEW.last_error,'') NOT IN ('hold:refund','hold:dispute','hold:manual') THEN RETURN NEW; END IF;
  oid:=NEW.order_id; why:=substring(NEW.last_error FROM 6); ref:='checkout:'||NEW.last_error;
 ELSIF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='promoter_ledger_entries' THEN
  IF NEW.entry_type<>'reversal' THEN RETURN NEW; END IF;
  oid:=NEW.order_id; why:='ledger_reversal'; ref:='ledger:'||NEW.id::text;
 ELSE
  oid:=NEW.order_id; why:=NEW.reason; ref:='hold:'||NEW.external_event_id;
 END IF;
 INSERT INTO dvnt_settlement.external_recovery_reviews(settlement_id,order_id,reason,source_reference)
 SELECT x.settlement_id,oid,why,ref FROM dvnt_settlement.external_promoter_rows x WHERE x.order_id=oid
 ON CONFLICT(order_id,reason,source_reference) DO NOTHING;
 RETURN NEW;
END $$;
CREATE TRIGGER external_order_recovery AFTER UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.flag_external_recovery();
CREATE TRIGGER external_reversal_recovery AFTER INSERT ON public.promoter_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.flag_external_recovery();
CREATE TRIGGER external_checkout_recovery AFTER UPDATE OF last_error ON dvnt_settlement.checkouts
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.flag_external_recovery();
CREATE TRIGGER external_hold_recovery AFTER INSERT ON dvnt_settlement.holds
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.flag_external_recovery();

CREATE FUNCTION public.settlement_external_recovery_candidates(p_limit int DEFAULT 100) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) FROM (
 SELECT r.id,r.settlement_id,r.order_id,r.reason,r.created_at,x.amount_cents,x.currency,
 'manual_external_payment_recovery_review'::text AS action
 FROM dvnt_settlement.external_recovery_reviews r JOIN dvnt_settlement.external_promoter_rows x ON x.order_id=r.order_id
 ORDER BY r.created_at,r.id LIMIT greatest(1,least(p_limit,100))
 ) q;
$$;
CREATE FUNCTION public.settlement_external_recovery_health() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('external_recovery_review_required',count(DISTINCT order_id))
 FROM dvnt_settlement.external_recovery_reviews;
$$;
REVOKE ALL ON FUNCTION public.settlement_external_recovery_candidates(int),public.settlement_external_recovery_health() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_external_recovery_candidates(int),public.settlement_external_recovery_health() TO service_role;

CREATE FUNCTION public.settlement_external_operator_allowed(p_actor text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM dvnt_settlement.external_operators WHERE actor_id=p_actor AND enabled);
$$;
REVOKE ALL ON FUNCTION public.settlement_external_operator_allowed(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_external_operator_allowed(text) TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.settlement_record_external_promoter_payment(text,uuid,int,uuid,uuid,uuid[],bigint,text,text,text,text,text,text,timestamptz,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settlement_record_external_promoter_payment(text,uuid,int,uuid,uuid,uuid[],bigint,text,text,text,text,text,text,timestamptz,text,jsonb) TO service_role;
COMMIT;
