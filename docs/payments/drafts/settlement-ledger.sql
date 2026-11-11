-- DRAFT ONLY. Not a deployment migration. No scheduler or Stripe executor.
-- Promote through `supabase migration new` only after the rollout review.
BEGIN;
CREATE SCHEMA IF NOT EXISTS dvnt_settlement;
REVOKE ALL ON SCHEMA dvnt_settlement FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA dvnt_settlement TO service_role;

CREATE TABLE dvnt_settlement.controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  transfers_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO dvnt_settlement.controls DEFAULT VALUES;
CREATE TABLE dvnt_settlement.orders (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  charge_id text NOT NULL UNIQUE CHECK (charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  currency text NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  gross_cents bigint NOT NULL CHECK (gross_cents > 0),
  distributable_cents bigint NOT NULL CHECK (distributable_cents >= 0 AND distributable_cents <= gross_cents),
  blocked boolean NOT NULL DEFAULT true,
  block_reason text NOT NULL DEFAULT 'awaiting_release_review',
  release_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dvnt_settlement.allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES dvnt_settlement.orders(order_id),
  role text NOT NULL CHECK (role IN ('organizer', 'promoter')),
  recipient_id text NOT NULL CHECK (length(recipient_id)>0),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  UNIQUE(order_id, role)
);
CREATE TABLE dvnt_settlement.deliveries (
  allocation_id uuid PRIMARY KEY REFERENCES dvnt_settlement.allocations(id),
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','reserved','uncertain','transferred','recovery_required')),
  destination text,
  idempotency_key text NOT NULL UNIQUE,
  stripe_transfer_id text UNIQUE,
  reserved_at timestamptz,
  bank_payout_state text NOT NULL DEFAULT 'unverified' CHECK (bank_payout_state IN ('unverified','pending','paid','failed')),
  CHECK (state = 'held' OR (destination ~ '^acct_[A-Za-z0-9_]+$' AND reserved_at IS NOT NULL)),
  CHECK (state NOT IN ('transferred','recovery_required') OR stripe_transfer_id IS NOT NULL)
);
CREATE TABLE dvnt_settlement.holds (
  order_id uuid NOT NULL REFERENCES dvnt_settlement.orders(order_id),
  external_event_id text NOT NULL CHECK (length(external_event_id)>0),
  reason text NOT NULL CHECK (reason IN ('refund','dispute','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(order_id,external_event_id)
);

-- All application access is via service-only functions. RLS is defense in depth;
-- no tables or functions are exposed to buyer/promoter JWTs.
ALTER TABLE dvnt_settlement.controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA dvnt_settlement FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION dvnt_settlement.reject_allocation_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'settlement allocations are immutable'; END $$;
CREATE TRIGGER immutable_allocations BEFORE UPDATE OR DELETE ON dvnt_settlement.allocations
FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_allocation_change();

-- Freeze the source economics once enrolled; status/refund bookkeeping remains
-- writable. This trigger and enroll both lock the same public.orders row.
CREATE FUNCTION dvnt_settlement.freeze_source_economics() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM dvnt_settlement.orders WHERE order_id=OLD.id) AND
   ROW(NEW.charge_model,NEW.stripe_payment_intent_id,NEW.currency,NEW.total_cents,
       NEW.subtotal_cents,NEW.organizer_fee_cents,NEW.promoter_commission_amount_cents,
       NEW.event_id,NEW.promoter_code,NEW.type) IS DISTINCT FROM
   ROW(OLD.charge_model,OLD.stripe_payment_intent_id,OLD.currency,OLD.total_cents,
       OLD.subtotal_cents,OLD.organizer_fee_cents,OLD.promoter_commission_amount_cents,
       OLD.event_id,OLD.promoter_code,OLD.type) THEN
   RAISE EXCEPTION 'enrolled order economics are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_settlement_source BEFORE UPDATE ON public.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_source_economics();

-- Trusted enrollment adapter MUST retrieve and verify the succeeded platform
-- charge (not metadata), no destination transfer, matching PI/currency/amount,
-- before calling. There is intentionally no adapter in this draft.
CREATE FUNCTION dvnt_settlement.enroll(
  p_order uuid, p_charge text, p_pi text, p_currency text, p_gross bigint,
  p_release_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.orders%ROWTYPE; host text; promoter text; commission bigint; net bigint;
  existing dvnt_settlement.orders%ROWTYPE; a record;
BEGIN
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order FOR UPDATE;
  IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers'
    OR o.status IS DISTINCT FROM 'paid' OR o.type IS DISTINCT FROM 'event_ticket'
    OR o.stripe_payment_intent_id IS DISTINCT FROM p_pi
    OR o.currency IS DISTINCT FROM p_currency OR o.total_cents IS DISTINCT FROM p_gross
    OR p_pi IS NULL OR p_release_at IS NULL OR o.subtotal_cents IS NULL
    OR o.organizer_fee_cents IS NULL OR o.organizer_fee_cents < 0 THEN
    RAISE EXCEPTION 'order/source not eligible';
  END IF;
  SELECT * INTO existing FROM dvnt_settlement.orders WHERE order_id=p_order;
  IF FOUND THEN
    IF existing.charge_id IS DISTINCT FROM p_charge OR existing.currency IS DISTINCT FROM p_currency
      OR existing.gross_cents IS DISTINCT FROM p_gross OR existing.release_at IS DISTINCT FROM p_release_at THEN
      RAISE EXCEPTION 'enrollment replay mismatch';
    END IF;
    RETURN;
  END IF;
  -- Do not guess old commission policy or treat missing attribution as zero.
  IF o.promoter_code IS NOT NULL AND o.promoter_commission_amount_cents IS NULL THEN
    RAISE EXCEPTION 'missing locked commission';
  END IF;
  commission := coalesce(o.promoter_commission_amount_cents,0);
  net := o.subtotal_cents::bigint - o.organizer_fee_cents;
  IF commission < 0 OR commission > net OR net < 0 OR net > p_gross THEN
    RAISE EXCEPTION 'invalid allocation amounts';
  END IF;
  SELECT host_id::text INTO STRICT host FROM public.events WHERE id=o.event_id;
  IF host IS NULL OR host='' THEN RAISE EXCEPTION 'missing host'; END IF;
  IF commission > 0 THEN
    SELECT promoter_id::text INTO STRICT promoter FROM public.promoter_attributions WHERE order_id=p_order;
  END IF;
  INSERT INTO dvnt_settlement.orders(order_id,charge_id,currency,gross_cents,distributable_cents,release_at)
    VALUES(p_order,p_charge,p_currency,p_gross,net,p_release_at);
  IF net > commission THEN
    INSERT INTO dvnt_settlement.allocations(order_id,role,recipient_id,amount_cents)
      VALUES(p_order,'organizer',host,net-commission);
  END IF;
  IF commission > 0 THEN
    INSERT INTO dvnt_settlement.allocations(order_id,role,recipient_id,amount_cents)
      VALUES(p_order,'promoter',promoter,commission);
  END IF;
  FOR a IN SELECT id FROM dvnt_settlement.allocations WHERE order_id=p_order LOOP
    INSERT INTO dvnt_settlement.deliveries(allocation_id,idempotency_key)
      VALUES(a.id,'dvnt:settlement:v1:' || a.id::text);
  END LOOP;
END $$;

-- Completion means exact provider transfer confirmation, not a bank deposit.
-- The receipt-backed external-settlement extension may replace this predicate
-- with an equally exact, immutable proof. Pending/unknown receipts never count.
CREATE FUNCTION dvnt_settlement.promoter_obligation_satisfied(p_allocation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM dvnt_settlement.allocations a
  JOIN dvnt_settlement.deliveries d ON d.allocation_id=a.id
  WHERE a.id=p_allocation AND a.role='promoter'
   AND d.state='transferred' AND d.stripe_transfer_id IS NOT NULL);
$$;

-- No release/unblock API in this foundation: release and funds verification
-- must be built and audited before any integration can enable transfers.
CREATE FUNCTION dvnt_settlement.reserve(p_allocation uuid, p_destination text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a dvnt_settlement.allocations%ROWTYPE; o dvnt_settlement.orders%ROWTYPE;
  d dvnt_settlement.deliveries%ROWTYPE;
BEGIN
  SELECT * INTO STRICT a FROM dvnt_settlement.allocations WHERE id=p_allocation;
  -- Universal lock order: source order first, then settlement, then delivery.
  PERFORM 1 FROM public.orders WHERE id=a.order_id FOR UPDATE;
  SELECT * INTO STRICT o FROM dvnt_settlement.orders WHERE order_id=a.order_id FOR UPDATE;
  SELECT * INTO STRICT d FROM dvnt_settlement.deliveries WHERE allocation_id=a.id FOR UPDATE;
  IF NOT (SELECT transfers_enabled FROM dvnt_settlement.controls WHERE singleton)
    OR o.blocked OR o.release_at > now() OR EXISTS(SELECT 1 FROM dvnt_settlement.holds WHERE order_id=o.order_id)
    OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=a.order_id AND status='paid'
      AND charge_model='separate_charges_and_transfers') THEN
    RAISE EXCEPTION 'settlement held';
  END IF;
  -- The source-order lock serializes promoter completion, host claims and holds.
  -- Only this order is dependent; unrelated healthy orders are not event-held.
  IF a.role='organizer' AND EXISTS(SELECT 1 FROM dvnt_settlement.allocations p
    WHERE p.order_id=a.order_id AND p.role='promoter'
      AND NOT dvnt_settlement.promoter_obligation_satisfied(p.id)) THEN
    RAISE EXCEPTION 'promoter settlement pending';
  END IF;
  IF d.state <> 'held' THEN RAISE EXCEPTION 'already reserved; reconcile, never redispatch'; END IF;
  IF p_destination IS NULL OR p_destination !~ '^acct_[A-Za-z0-9_]+$' THEN RAISE EXCEPTION 'recipient not onboarded'; END IF;
  -- Account identity/capability verified by future trusted adapter; binding is
  -- immutable after reservation, even if the recipient changes accounts later.
  UPDATE dvnt_settlement.deliveries SET state='reserved',destination=p_destination,reserved_at=now()
    WHERE allocation_id=a.id RETURNING * INTO d;
  RETURN jsonb_build_object('allocation_id',a.id,'amount',a.amount_cents,'currency',o.currency,
    'destination',d.destination,'source_transaction',o.charge_id,'idempotency_key',d.idempotency_key);
END $$;

CREATE FUNCTION dvnt_settlement.hold(p_order uuid,p_event text,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.orders WHERE id=p_order FOR UPDATE;
  PERFORM 1 FROM dvnt_settlement.orders WHERE order_id=p_order FOR UPDATE;
  INSERT INTO dvnt_settlement.holds(order_id,external_event_id,reason) VALUES(p_order,p_event,p_reason)
    ON CONFLICT DO NOTHING;
  UPDATE dvnt_settlement.orders SET blocked=true,block_reason=p_reason WHERE order_id=p_order;
  UPDATE dvnt_settlement.deliveries SET state=CASE WHEN stripe_transfer_id IS NOT NULL
      THEN 'recovery_required' ELSE 'uncertain' END
    WHERE allocation_id IN (SELECT id FROM dvnt_settlement.allocations WHERE order_id=p_order)
      AND state <> 'held';
END $$;

-- Receives verified Stripe transfer evidence, including retrieved transfers
-- after uncertain network/DB outcomes. Never infers bank payout success.
CREATE FUNCTION dvnt_settlement.reconcile_transfer(
 p_allocation uuid,p_transfer text,p_destination text,p_charge text,p_currency text,p_amount bigint
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a dvnt_settlement.allocations%ROWTYPE; o dvnt_settlement.orders%ROWTYPE;
 d dvnt_settlement.deliveries%ROWTYPE;
BEGIN
 SELECT * INTO STRICT a FROM dvnt_settlement.allocations WHERE id=p_allocation;
 PERFORM 1 FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO STRICT o FROM dvnt_settlement.orders WHERE order_id=a.order_id FOR UPDATE;
 SELECT * INTO STRICT d FROM dvnt_settlement.deliveries WHERE allocation_id=a.id FOR UPDATE;
 IF d.state='held' OR d.destination IS DISTINCT FROM p_destination
   OR o.charge_id IS DISTINCT FROM p_charge OR o.currency IS DISTINCT FROM p_currency
   OR a.amount_cents IS DISTINCT FROM p_amount OR p_transfer IS NULL OR p_transfer !~ '^tr_[A-Za-z0-9_]+$'
   OR (d.stripe_transfer_id IS NOT NULL AND d.stripe_transfer_id<>p_transfer) THEN
   RAISE EXCEPTION 'transfer evidence mismatch';
 END IF;
 UPDATE dvnt_settlement.deliveries SET stripe_transfer_id=p_transfer,
   state=CASE WHEN o.blocked OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=o.order_id AND status='paid')
     OR EXISTS(SELECT 1 FROM dvnt_settlement.holds WHERE order_id=o.order_id)
     THEN 'recovery_required' ELSE 'transferred' END WHERE allocation_id=a.id;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION dvnt_settlement.enroll(uuid,text,text,text,bigint,timestamptz),
 dvnt_settlement.reserve(uuid,text),dvnt_settlement.hold(uuid,text,text),
 dvnt_settlement.reconcile_transfer(uuid,text,text,text,text,bigint) TO service_role;
COMMIT;
