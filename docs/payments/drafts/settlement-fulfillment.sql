-- DRAFT follow-up. Assemble after runtime/funding and any checkout-replacement
-- wrappers, with the real paid_ticket_issuance_atomic and complete_paid_cart_atomic
-- source migrations already installed. No backfill, policy enablement or money
-- movement. Historical paid flags and email outcomes are NEVER issuance proof.
BEGIN;
CREATE TABLE dvnt_settlement.fulfillments (
 order_id uuid PRIMARY KEY REFERENCES dvnt_settlement.checkouts(order_id),
 snapshot jsonb NOT NULL, payment_intent_id text NOT NULL UNIQUE,
 checkout_session_id text, gross_cents bigint NOT NULL CHECK(gross_cents>0),
 issuer text NOT NULL CHECK(issuer IN ('paid_ticket_issuance_atomic','complete_paid_cart_atomic')),
 entitlements jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE dvnt_settlement.fulfillments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.fulfillments FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_fulfillment BEFORE UPDATE OR DELETE ON dvnt_settlement.fulfillments
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_allocation_change();

-- Final hosted tax is unknown at checkout preparation. Pin a current captured
-- Session/PI/Charge tuple before the canonical issuer compares its paid amount.
-- This is NOT fulfillment or paid-status evidence and does not enroll funds.
CREATE TABLE dvnt_settlement.hosted_captures (
 order_id uuid PRIMARY KEY REFERENCES dvnt_settlement.checkouts(order_id),
 checkout_session_id text NOT NULL UNIQUE, payment_intent_id text NOT NULL UNIQUE,
 charge_id text NOT NULL UNIQUE, currency text NOT NULL,
 pretax_cents bigint NOT NULL, tax_cents bigint NOT NULL CHECK(tax_cents>=0),
 gross_cents bigint NOT NULL CHECK(gross_cents=pretax_cents+tax_cents AND gross_cents>0),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE dvnt_settlement.hosted_captures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.hosted_captures FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_hosted_capture BEFORE UPDATE OR DELETE ON dvnt_settlement.hosted_captures
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_allocation_change();
CREATE FUNCTION public.prepare_settlement_hosted_issuance(p_order_id uuid,p_session jsonb,p_intent jsonb,p_charge jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE;
 prior dvnt_settlement.hosted_captures%ROWTYPE; pretax bigint; tax bigint; gross bigint;
BEGIN
 -- This transaction ends BEFORE issuance starts. Never acquire tier, cart or
 -- hold locks from here, and never invoke an issuer from this order lock.
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id;
 pretax:=(c.snapshot->'order'->>'total_cents')::bigint;
 tax:=(p_session->'total_details'->>'amount_tax')::bigint;
 gross:=(p_session->>'amount_total')::bigint;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR o.type IS DISTINCT FROM 'event_ticket'
 OR c.snapshot->>'rail' IS NULL OR c.snapshot->>'rail' NOT IN ('ticket-checkout','guest-checkout') OR o.cart_id IS NOT NULL
 OR c.snapshot->'selection'->>'ticket_type_id' IS NULL
 OR c.attempted_at IS NULL OR o.status IS NULL OR o.status NOT IN ('created','payment_pending','payment_failed','paid')
 OR o.refunded_at IS NOT NULL OR c.last_error LIKE 'hold:%'
 OR p_session->>'object' IS DISTINCT FROM 'checkout.session' OR p_session->>'mode' IS DISTINCT FROM 'payment'
 OR p_session->>'id' IS NULL OR p_session->>'id' !~ '^cs_[A-Za-z0-9_]+$'
 OR p_session->>'id' IS DISTINCT FROM o.stripe_checkout_session_id
 OR p_session->>'status' IS DISTINCT FROM 'complete' OR p_session->>'payment_status' IS DISTINCT FROM 'paid'
 OR p_session->>'currency' IS DISTINCT FROM o.currency OR o.currency IS DISTINCT FROM c.snapshot->'order'->>'currency'
 OR (p_session->>'amount_subtotal')::bigint IS DISTINCT FROM pretax OR pretax IS NULL OR pretax<=0
 OR tax IS NULL OR tax<0 OR gross IS NULL OR gross<>pretax+tax
 OR (p_session->'total_details'->>'amount_discount')::bigint IS DISTINCT FROM 0::bigint
 OR (p_session->'total_details'->>'amount_shipping')::bigint IS DISTINCT FROM 0::bigint
 OR p_session->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
 OR p_session->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
 OR p_session->'metadata'->>'type' IS DISTINCT FROM 'event_ticket'
 OR (p_session->'metadata'->>'event_id')::int IS DISTINCT FROM o.event_id
 OR (p_session->'metadata'->>'quantity')::int IS DISTINCT FROM o.quantity
 OR (p_session->'metadata'->>'ticket_type_id')::uuid IS DISTINCT FROM (c.snapshot->'selection'->>'ticket_type_id')::uuid
 OR nullif(p_session->'metadata'->>'user_id','') IS DISTINCT FROM o.user_id
 OR (o.user_id IS NULL AND lower(btrim(p_session->'metadata'->>'guest_email')) IS DISTINCT FROM lower(btrim(o.guest_email)))
 OR p_intent->>'object' IS DISTINCT FROM 'payment_intent' OR p_intent->>'id' IS NULL OR p_intent->>'id' !~ '^pi_[A-Za-z0-9_]+$'
 OR p_intent->>'id' IS DISTINCT FROM p_session->>'payment_intent'
 OR (o.stripe_payment_intent_id IS NOT NULL AND o.stripe_payment_intent_id IS DISTINCT FROM p_intent->>'id')
 OR p_intent->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
 OR p_intent->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
 OR p_intent->>'status' IS DISTINCT FROM 'succeeded' OR p_intent->>'currency' IS DISTINCT FROM o.currency
 OR (p_intent->>'amount')::bigint IS DISTINCT FROM gross OR (p_intent->>'amount_received')::bigint IS DISTINCT FROM gross
 OR coalesce(p_intent->'transfer_data','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_intent->'application_fee_amount','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_intent->'on_behalf_of','null'::jsonb)<>'null'::jsonb
 OR p_charge->>'object' IS DISTINCT FROM 'charge' OR p_charge->>'id' IS NULL OR p_charge->>'id' !~ '^ch_[A-Za-z0-9_]+$'
 OR p_charge->>'id' IS DISTINCT FROM p_intent->>'latest_charge' OR p_charge->>'payment_intent' IS DISTINCT FROM p_intent->>'id'
 OR p_charge->>'currency' IS DISTINCT FROM o.currency OR p_charge->>'status' IS DISTINCT FROM 'succeeded'
 OR p_charge->'paid' IS DISTINCT FROM 'true'::jsonb OR p_charge->'captured' IS DISTINCT FROM 'true'::jsonb
 OR (p_charge->>'amount')::bigint IS DISTINCT FROM gross OR (p_charge->>'amount_captured')::bigint IS DISTINCT FROM gross
 OR p_charge->'refunded' IS DISTINCT FROM 'false'::jsonb OR (p_charge->>'amount_refunded')::bigint IS DISTINCT FROM 0::bigint
 OR p_charge->'disputed' IS DISTINCT FROM 'false'::jsonb
 OR coalesce(p_charge->'transfer','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_charge->'transfer_data','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_charge->'destination','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_charge->'application_fee','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_charge->'application_fee_amount','null'::jsonb)<>'null'::jsonb
 OR coalesce(p_charge->'on_behalf_of','null'::jsonb)<>'null'::jsonb
 OR EXISTS(SELECT 1 FROM public.orders other WHERE other.id<>o.id AND
  (other.stripe_payment_intent_id=p_intent->>'id' OR other.stripe_checkout_session_id=p_session->>'id'))
 THEN RAISE EXCEPTION 'hosted capture identity/economics not eligible'; END IF;
 SELECT * INTO prior FROM dvnt_settlement.hosted_captures WHERE order_id=o.id;
 IF FOUND THEN
  IF ROW(prior.checkout_session_id,prior.payment_intent_id,prior.charge_id,prior.currency,prior.pretax_cents,prior.tax_cents,prior.gross_cents)
   IS DISTINCT FROM ROW(p_session->>'id',p_intent->>'id',p_charge->>'id',o.currency,pretax,tax,gross)
   THEN RAISE EXCEPTION 'immutable hosted capture mismatch'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM dvnt_settlement.fulfillments f WHERE f.order_id=o.id AND
   (f.payment_intent_id IS DISTINCT FROM p_intent->>'id' OR f.checkout_session_id IS DISTINCT FROM p_session->>'id' OR f.gross_cents IS DISTINCT FROM gross))
   THEN RAISE EXCEPTION 'immutable fulfillment capture mismatch'; END IF;
  INSERT INTO dvnt_settlement.hosted_captures(order_id,checkout_session_id,payment_intent_id,charge_id,currency,pretax_cents,tax_cents,gross_cents)
   VALUES(o.id,p_session->>'id',p_intent->>'id',p_charge->>'id',o.currency,pretax,tax,gross);
 END IF;
 -- Do not change status, paid_at, source_verified_at or frozen pre-tax fees.
 UPDATE public.orders SET stripe_payment_intent_id=p_intent->>'id',total_cents=gross,tax_cents=tax,updated_at=now() WHERE id=o.id;
 RETURN jsonb_build_object('ok',true,'order_id',o.id,'amount_cents',gross);
END $$;
REVOKE ALL ON FUNCTION public.prepare_settlement_hosted_issuance(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_settlement_hosted_issuance(uuid,jsonb,jsonb,jsonb) TO service_role;

-- Private constructor, not an RPC accepting caller-supplied "fulfilled" proof.
-- Called ONLY after the actual atomic issuer's nonterminal success, in that
-- same transaction with its inventory/order locks still held. The additional
-- checks bind legacy duplicate-success validation to immutable paid selection.
CREATE FUNCTION dvnt_settlement.record_fulfillment(p_order uuid,p_issuer text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE;
 prior dvnt_settlement.fulfillments%ROWTYPE; expected jsonb; actual jsonb; manifest jsonb;
 tickets jsonb; addons jsonb; total_units bigint;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order;
 SELECT * INTO c FROM dvnt_settlement.checkouts WHERE order_id=p_order;
 IF NOT FOUND THEN
  IF o.charge_model='separate_charges_and_transfers' THEN RAISE EXCEPTION 'fulfillment_required: checkout missing'; END IF;
  RETURN;
 END IF;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers'
 OR o.type IS DISTINCT FROM 'event_ticket' OR o.status IS NULL
 OR o.status NOT IN ('created','payment_pending','payment_failed','paid') OR o.refunded_at IS NOT NULL
 OR o.stripe_payment_intent_id IS NULL
 OR o.event_id IS DISTINCT FROM (c.snapshot->'order'->>'event_id')::int
 OR o.quantity IS DISTINCT FROM (c.snapshot->'order'->>'quantity')::int
 OR o.currency IS DISTINCT FROM c.snapshot->'order'->>'currency'
 OR o.user_id IS DISTINCT FROM c.snapshot->'order'->>'user_id'
 OR lower(o.guest_email) IS DISTINCT FROM lower(c.snapshot->'order'->>'guest_email')
 OR o.total_cents::bigint IS DISTINCT FROM (c.snapshot->'order'->>'total_cents')::bigint+coalesce(o.tax_cents,0)
 THEN RAISE EXCEPTION 'fulfillment_required: order scope mismatch'; END IF;
 -- A durable receipt describes the issuance event, not current ticket ownership.
 -- Transfers/scans/redemption cannot erase it. Refund/dispute/manual holds are
 -- checked independently by source verification and every new reservation.
 SELECT * INTO prior FROM dvnt_settlement.fulfillments WHERE order_id=p_order;
 IF FOUND THEN
  IF prior.snapshot IS DISTINCT FROM c.snapshot OR prior.payment_intent_id IS DISTINCT FROM o.stripe_payment_intent_id
   OR prior.checkout_session_id IS DISTINCT FROM o.stripe_checkout_session_id OR prior.gross_cents IS DISTINCT FROM o.total_cents::bigint
   OR prior.issuer IS DISTINCT FROM p_issuer THEN RAISE EXCEPTION 'fulfillment_required: immutable receipt mismatch'; END IF;
  RETURN;
 END IF;
 IF p_issuer='paid_ticket_issuance_atomic' THEN
  IF c.snapshot->>'rail' NOT IN ('create-payment-intent','ticket-checkout','guest-checkout')
   OR c.snapshot->>'rail' IS NULL OR o.cart_id IS NOT NULL
   OR c.snapshot->'selection'->>'ticket_type_id' IS NULL
   OR ((c.snapshot->>'rail' IN ('ticket-checkout','guest-checkout')) IS DISTINCT FROM (o.stripe_checkout_session_id IS NOT NULL))
   THEN RAISE EXCEPTION 'fulfillment_required: ticket checkout scope mismatch'; END IF;
  SELECT count(*) INTO total_units FROM public.tickets t WHERE t.order_id=o.id
   OR t.stripe_payment_intent_id=o.stripe_payment_intent_id
   OR (o.stripe_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id=o.stripe_checkout_session_id);
  IF total_units IS DISTINCT FROM o.quantity::bigint OR total_units<=0 OR EXISTS (
   SELECT 1 FROM public.tickets t WHERE (t.order_id=o.id OR t.stripe_payment_intent_id=o.stripe_payment_intent_id
    OR (o.stripe_checkout_session_id IS NOT NULL AND t.stripe_checkout_session_id=o.stripe_checkout_session_id)) AND (
    t.order_id IS DISTINCT FROM o.id OR t.stripe_payment_intent_id IS DISTINCT FROM o.stripe_payment_intent_id
    OR t.stripe_checkout_session_id IS DISTINCT FROM o.stripe_checkout_session_id
    OR t.ticket_type_id IS DISTINCT FROM (c.snapshot->'selection'->>'ticket_type_id')::uuid
    OR t.event_id IS DISTINCT FROM o.event_id OR t.user_id IS DISTINCT FROM o.user_id
    OR (o.user_id IS NULL AND lower(btrim(t.guest_email)) IS DISTINCT FROM lower(btrim(o.guest_email)))
    OR t.cart_id IS NOT NULL OR t.cart_line_item_id IS NOT NULL
    OR t.status IS NULL OR t.status NOT IN ('active','scanned','transfer_pending')
    OR nullif(btrim(t.qr_token),'') IS NULL OR nullif(btrim(t.qr_payload),'') IS NULL
    OR t.order_count IS DISTINCT FROM o.quantity OR t.order_index IS NULL OR t.order_index<1 OR t.order_index>o.quantity
    OR t.purchase_amount_cents IS NULL OR t.purchase_amount_cents<0))
   OR (SELECT count(DISTINCT order_index) FROM public.tickets WHERE order_id=o.id)<>o.quantity
   OR (SELECT sum(purchase_amount_cents::bigint) FROM public.tickets WHERE order_id=o.id) IS DISTINCT FROM o.total_cents::bigint
   OR EXISTS(SELECT 1 FROM public.order_addons WHERE order_id=o.id)
   THEN RAISE EXCEPTION 'fulfillment_required: exact ticket entitlement mismatch'; END IF;
 ELSIF p_issuer='complete_paid_cart_atomic' THEN
  IF c.snapshot->>'rail' IS DISTINCT FROM 'cart-checkout' OR o.cart_id IS NULL
   OR o.cart_id IS DISTINCT FROM (c.snapshot->'order'->>'cart_id')::uuid
   OR jsonb_typeof(c.snapshot->'selection'->'lines') IS DISTINCT FROM 'array'
   OR NOT EXISTS(SELECT 1 FROM public.carts WHERE id=o.cart_id AND status='completed'
    AND user_id=o.user_id AND event_id=o.event_id AND stripe_pi_id=o.stripe_payment_intent_id
    AND currency=o.currency AND total_cents=o.total_cents)
   THEN RAISE EXCEPTION 'fulfillment_required: cart checkout scope mismatch'; END IF;
  -- PostgreSQL UUID identities accept uppercase, compact and braced spelling.
  -- Normalize typed IDs while retaining every other frozen selection field.
  -- Malformed UUID text raises and rolls the issuance transaction back.
  SELECT jsonb_agg((value-'id'-'tier_id'-'addon_id'-'variant_id')||jsonb_build_object(
   'id',(value->>'id')::uuid,'tier_id',(value->>'tier_id')::uuid,
   'addon_id',(value->>'addon_id')::uuid,'variant_id',(value->>'variant_id')::uuid)
   ORDER BY (value->>'id')::uuid) INTO expected FROM jsonb_array_elements(c.snapshot->'selection'->'lines');
  SELECT jsonb_agg(jsonb_build_object('id',id,'tier_id',tier_id,'addon_id',addon_id,'variant_id',variant_id,'quantity',quantity,'unit_price_cents',unit_price_cents) ORDER BY id),sum(quantity)
   INTO actual,total_units FROM public.cart_line_items WHERE cart_id=o.cart_id;
  IF actual IS DISTINCT FROM expected OR total_units IS DISTINCT FROM o.quantity::bigint OR total_units<=0
   OR EXISTS(SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=o.cart_id AND (
    l.quantity<=0 OR l.unit_price_cents IS NULL OR l.unit_price_cents<0 OR coalesce(l.refunded_amount_cents,0)>0
    OR ((l.tier_id IS NULL)=(l.addon_id IS NULL))
    OR (l.tier_id IS NOT NULL AND l.quantity<>(SELECT count(*) FROM public.tickets t WHERE t.cart_line_item_id=l.id))
    OR (l.addon_id IS NOT NULL AND l.quantity<>coalesce((SELECT sum(a.quantity) FROM public.order_addons a WHERE a.cart_line_item_id=l.id),0))))
   OR EXISTS(SELECT 1 FROM public.tickets t WHERE (t.cart_id=o.cart_id OR t.order_id=o.id OR t.stripe_payment_intent_id=o.stripe_payment_intent_id) AND (
    t.order_id IS DISTINCT FROM o.id OR t.cart_id IS DISTINCT FROM o.cart_id
    OR t.stripe_payment_intent_id IS DISTINCT FROM o.stripe_payment_intent_id OR t.stripe_checkout_session_id IS NOT NULL
    OR t.event_id IS DISTINCT FROM o.event_id OR t.user_id IS DISTINCT FROM o.user_id
    OR NOT EXISTS(SELECT 1 FROM public.ticket_types tt WHERE tt.id=t.ticket_type_id AND tt.event_id=o.event_id AND t.category=coalesce(tt.category,'admission'))
    OR t.status IS NULL OR t.status NOT IN ('active','scanned','transfer_pending')
    OR nullif(btrim(t.qr_token),'') IS NULL OR nullif(btrim(t.qr_payload),'') IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=o.cart_id AND l.id=t.cart_line_item_id
     AND l.tier_id=t.ticket_type_id AND l.unit_price_cents=t.purchase_amount_cents)))
   OR EXISTS(SELECT 1 FROM public.order_addons a LEFT JOIN public.ticket_addons x ON x.id=a.addon_id
    WHERE (a.cart_id=o.cart_id OR a.order_id=o.id) AND (
     a.order_id IS DISTINCT FROM o.id OR a.cart_id IS DISTINCT FROM o.cart_id OR a.event_id IS DISTINCT FROM o.event_id
     OR a.user_id IS DISTINCT FROM o.user_id OR a.quantity IS NULL OR a.quantity<=0
     OR a.status IS NULL OR a.status NOT IN ('unfulfilled','fulfilled','redeemed') OR coalesce(a.refunded_amount_cents,0)>0
     -- Match the canonical allocator's exact admission binding, including its
     -- required-tier preference and deterministic fallback. A foreign, null,
     -- wrong-tier or otherwise ineligible historical link is not proof.
     OR a.ticket_id IS DISTINCT FROM (SELECT t.id FROM public.tickets t
      WHERE t.cart_id=o.cart_id AND t.order_id=o.id AND t.event_id=o.event_id
       AND t.user_id IS NOT DISTINCT FROM o.user_id AND t.category='admission'
      ORDER BY (t.ticket_type_id IS NOT DISTINCT FROM x.requires_tier_id) DESC,t.order_index,t.id LIMIT 1)
     OR x.id IS NULL OR (x.is_redeemable AND (a.quantity<>1 OR nullif(btrim(a.qr_token),'') IS NULL OR nullif(btrim(a.qr_payload),'') IS NULL))
     OR NOT EXISTS(SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=o.cart_id AND l.id=a.cart_line_item_id
      AND l.addon_id=a.addon_id AND l.variant_id IS NOT DISTINCT FROM a.variant_id AND l.unit_price_cents=a.unit_price_cents)))
   THEN RAISE EXCEPTION 'fulfillment_required: exact cart entitlement mismatch'; END IF;
 ELSE RAISE EXCEPTION 'fulfillment_required: unknown issuer'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'event_id',event_id,'tier_id',ticket_type_id,
  'line_id',cart_line_item_id,'amount_cents',purchase_amount_cents) ORDER BY id),'[]') INTO tickets FROM public.tickets WHERE order_id=o.id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'event_id',event_id,'addon_id',addon_id,'variant_id',variant_id,
  'line_id',cart_line_item_id,'ticket_id',ticket_id,'quantity',quantity,'unit_price_cents',unit_price_cents) ORDER BY id),'[]') INTO addons FROM public.order_addons WHERE order_id=o.id;
 manifest:=jsonb_build_object('tickets',tickets,'addons',addons);
 INSERT INTO dvnt_settlement.fulfillments(order_id,snapshot,payment_intent_id,checkout_session_id,gross_cents,issuer,entitlements)
  VALUES(o.id,c.snapshot,o.stripe_payment_intent_id,o.stripe_checkout_session_id,o.total_cents,p_issuer,manifest);
END $$;

-- Wrappers deliberately do not lock orders before invoking their issuer:
-- paid ticket locks payment→tier→order; paid cart locks cart→order→inventory.
ALTER FUNCTION public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb) RENAME TO paid_ticket_before_settlement_fulfillment;
ALTER FUNCTION public.paid_ticket_before_settlement_fulfillment(uuid,uuid,text,text,bigint,jsonb) SET SCHEMA dvnt_settlement;
ALTER FUNCTION dvnt_settlement.paid_ticket_before_settlement_fulfillment(uuid,uuid,text,text,bigint,jsonb) SET search_path='';
CREATE FUNCTION public.paid_ticket_issuance_atomic(p_order_id uuid,p_ticket_type_id uuid,p_payment_intent_id text,p_checkout_session_id text,p_amount_cents bigint,p_ticket_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 result:=dvnt_settlement.paid_ticket_before_settlement_fulfillment(p_order_id,p_ticket_type_id,p_payment_intent_id,p_checkout_session_id,p_amount_cents,p_ticket_rows);
 IF result->>'ok'='true' AND coalesce(result->>'terminal','false')='false' THEN
  PERFORM dvnt_settlement.record_fulfillment(p_order_id,'paid_ticket_issuance_atomic'); END IF;
 RETURN result;
END $$;
ALTER FUNCTION public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) RENAME TO paid_cart_before_settlement_fulfillment;
ALTER FUNCTION public.paid_cart_before_settlement_fulfillment(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) SET SCHEMA dvnt_settlement;
ALTER FUNCTION dvnt_settlement.paid_cart_before_settlement_fulfillment(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) SET search_path='';
CREATE FUNCTION public.complete_paid_cart_atomic(p_cart_id uuid,p_payment_intent_id text,p_amount_received integer,p_currency text,p_user_id text,p_event_id integer,p_ticket_rows jsonb,p_addon_rows jsonb,p_event_created_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; order_id uuid;
BEGIN
 result:=dvnt_settlement.paid_cart_before_settlement_fulfillment(p_cart_id,p_payment_intent_id,p_amount_received,p_currency,p_user_id,p_event_id,p_ticket_rows,p_addon_rows,p_event_created_at);
 IF result->>'ok'='true' AND coalesce(result->>'terminal','false')='false' THEN
  SELECT id INTO STRICT order_id FROM public.orders WHERE cart_id=p_cart_id;
  PERFORM dvnt_settlement.record_fulfillment(order_id,'complete_paid_cart_atomic'); END IF;
 RETURN result;
END $$;

CREATE FUNCTION dvnt_settlement.require_fulfillment(p_order uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Never enter inventory/cart locks from settlement's order→controls locks.
 -- This receipt can only become visible with the issuer transaction's commit.
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.fulfillments f
  JOIN dvnt_settlement.checkouts c ON c.order_id=f.order_id JOIN public.orders o ON o.id=f.order_id
  WHERE f.order_id=p_order AND f.snapshot=c.snapshot AND f.payment_intent_id=o.stripe_payment_intent_id
   AND f.checkout_session_id IS NOT DISTINCT FROM o.stripe_checkout_session_id AND f.gross_cents=o.total_cents)
 THEN RAISE EXCEPTION 'fulfillment_required: recover exact paid issuance before payout'; END IF;
END $$;
ALTER FUNCTION public.settlement_verify_source(uuid,text,text,text,bigint,bigint) RENAME TO verify_source_before_fulfillment;
ALTER FUNCTION public.verify_source_before_fulfillment(uuid,text,text,text,bigint,bigint) SET SCHEMA dvnt_settlement;
CREATE FUNCTION public.settlement_verify_source(p_order_id uuid,p_charge text,p_pi text,p_currency text,p_gross bigint,p_tax bigint DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.orders WHERE id=p_order_id FOR UPDATE;
 PERFORM dvnt_settlement.require_fulfillment(p_order_id);
 RETURN dvnt_settlement.verify_source_before_fulfillment(p_order_id,p_charge,p_pi,p_currency,p_gross,p_tax);
END $$;
-- Defensive SQL boundaries cover direct/private enrollment and every route to
-- reservation, not just one adapter. Reconciliation of already-sent transfers
-- remains possible without manufacturing a fulfillment receipt.
CREATE FUNCTION dvnt_settlement.fulfillment_before_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM dvnt_settlement.require_fulfillment(NEW.order_id); RETURN NEW; END $$;
CREATE TRIGGER fulfillment_before_enrollment BEFORE INSERT ON dvnt_settlement.orders
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.fulfillment_before_enrollment();
CREATE FUNCTION dvnt_settlement.fulfillment_before_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state='reserved' AND OLD.state IS DISTINCT FROM 'reserved' THEN
  PERFORM dvnt_settlement.require_fulfillment((SELECT order_id FROM dvnt_settlement.allocations WHERE id=NEW.allocation_id));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fulfillment_before_reservation BEFORE UPDATE ON dvnt_settlement.deliveries
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.fulfillment_before_reservation();

-- Explicit actionable reason, preserving the payment status used by recovery.
CREATE OR REPLACE FUNCTION public.settlement_processing_error(p_order_id uuid,p_code text,p_allocation uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_code NOT IN ('fulfillment_required','runtime_budget_required','onboarding_required','recipient_restricted','funding_required','source_audit_limit','source_verification_stale','verification_required','hold_required','promoter_pending','platform_payout_policy_unverified') THEN RAISE EXCEPTION 'unknown processing reason'; END IF;
 IF p_allocation IS NULL THEN
  UPDATE dvnt_settlement.checkouts SET last_error=p_code WHERE order_id=p_order_id AND coalesce(last_error,'') NOT LIKE 'hold:%';
 ELSE UPDATE dvnt_settlement.deliveries SET last_error=p_code WHERE allocation_id=p_allocation
  AND EXISTS(SELECT 1 FROM dvnt_settlement.allocations a WHERE a.id=p_allocation AND a.order_id=p_order_id); END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA dvnt_settlement FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb),
 public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz),
 public.settlement_verify_source(uuid,text,text,text,bigint,bigint),public.settlement_processing_error(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb),
 public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz),
 public.settlement_verify_source(uuid,text,text,text,bigint,bigint),public.settlement_processing_error(uuid,text,uuid) TO service_role;
COMMIT;
