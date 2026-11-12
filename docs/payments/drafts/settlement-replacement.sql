-- DRAFT. Install after guest recovery and the complete funding/external stack.
-- No gate is enabled and no provider call is made by this migration.
BEGIN;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.ticket_purchase_hold_atomic(uuid,integer,text,text,text,integer,text)',
  'public.cart_create_hold(uuid,integer,jsonb)',
  'public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb)',
  'public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz)',
  'dvnt_settlement.validate_guest_recovery_session(uuid,text)'
 ] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'replacement required source function missing: %',signature; END IF;
 END LOOP;
END $$;
ALTER TABLE dvnt_settlement.controls ADD COLUMN IF NOT EXISTS checkout_replacement_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE dvnt_settlement.controls ADD COLUMN max_active_replacements integer NOT NULL DEFAULT 2 CHECK(max_active_replacements BETWEEN 1 AND 10);
ALTER TABLE dvnt_settlement.controls ADD COLUMN max_active_replacement_units integer NOT NULL DEFAULT 40 CHECK(max_active_replacement_units BETWEEN 1 AND 200);
CREATE TABLE dvnt_settlement.replacement_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), original_order_id uuid NOT NULL REFERENCES public.orders(id),
 actor_id text, guest_session_id uuid REFERENCES dvnt_settlement.guest_recovery_sessions(id),
 snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
 accepted_at timestamptz, successor_order_id uuid UNIQUE REFERENCES public.orders(id),
 CHECK((actor_id IS NOT NULL)<>(guest_session_id IS NOT NULL)),
 CHECK((accepted_at IS NULL)=(successor_order_id IS NULL))
);
CREATE TABLE dvnt_settlement.replacement_recovery_resumptions (
 session_id uuid PRIMARY KEY REFERENCES dvnt_settlement.guest_recovery_sessions(id),
 quote_id uuid NOT NULL REFERENCES dvnt_settlement.replacement_quotes(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE dvnt_settlement.replacement_recovery_resumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.replacement_recovery_resumptions FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_replacement_resumption BEFORE UPDATE OR DELETE ON dvnt_settlement.replacement_recovery_resumptions
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_external_change();
CREATE TRIGGER no_truncate_replacement_resumption BEFORE TRUNCATE ON dvnt_settlement.replacement_recovery_resumptions
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.reject_external_change();
CREATE TABLE dvnt_settlement.checkout_replacements (
 original_order_id uuid PRIMARY KEY REFERENCES public.orders(id),
 successor_order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
 quote_id uuid NOT NULL UNIQUE REFERENCES dvnt_settlement.replacement_quotes(id),
 proof jsonb NOT NULL, original_cart_id uuid REFERENCES public.carts(id), successor_cart_id uuid UNIQUE REFERENCES public.carts(id),
 line_map jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(original_order_id<>successor_order_id), CHECK((original_cart_id IS NULL)=(successor_cart_id IS NULL)),
 CHECK(original_cart_id IS DISTINCT FROM successor_cart_id OR original_cart_id IS NULL)
);
-- Release evidence exists only inside successful canceled-replacement or
-- verified-paid fulfillment transactions. A timeout or failed payment attempt
-- never authorizes giving an outstanding payment's inventory to another buyer.
CREATE TABLE dvnt_settlement.replacement_inventory_releases (
 order_id uuid NOT NULL REFERENCES public.orders(id), reason text NOT NULL CHECK(reason IN('canceled','fulfilled')),
 proof jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(order_id,reason)
);
ALTER TABLE dvnt_settlement.replacement_inventory_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.replacement_inventory_releases FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_replacement_inventory_release BEFORE UPDATE OR DELETE ON dvnt_settlement.replacement_inventory_releases
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_external_change();
CREATE TRIGGER no_truncate_replacement_inventory_release BEFORE TRUNCATE ON dvnt_settlement.replacement_inventory_releases
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.reject_external_change();
ALTER TABLE dvnt_settlement.replacement_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dvnt_settlement.checkout_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dvnt_settlement.replacement_quotes,dvnt_settlement.checkout_replacements FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_checkout_replacement BEFORE UPDATE OR DELETE ON dvnt_settlement.checkout_replacements
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.reject_external_change();
CREATE TRIGGER no_truncate_checkout_replacement BEFORE TRUNCATE ON dvnt_settlement.checkout_replacements
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.reject_external_change();
CREATE FUNCTION dvnt_settlement.freeze_replacement_quote() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'replacement quote immutable'; END IF;
 IF (to_jsonb(NEW)-'accepted_at'-'successor_order_id') IS DISTINCT FROM (to_jsonb(OLD)-'accepted_at'-'successor_order_id')
 OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NULL OR NEW.successor_order_id IS NULL
 THEN RAISE EXCEPTION 'replacement quote immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_replacement_quote BEFORE UPDATE OR DELETE ON dvnt_settlement.replacement_quotes
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_replacement_quote();
CREATE TRIGGER no_truncate_replacement_quote BEFORE TRUNCATE ON dvnt_settlement.replacement_quotes
 FOR EACH STATEMENT EXECUTE FUNCTION dvnt_settlement.reject_external_change();

-- Lock order: buyer mutex -> actor/event mutex -> ancestry cart/order locks -> controls -> checkout.
-- This is the same original-order barrier used by source, refund and dispute
-- writers. FK inserts for financial/fulfillment rows also wait on this lock.
CREATE FUNCTION dvnt_settlement.replacement_authorize(p_order_id uuid,p_actor_id text,p_guest_session_hash text,p_replay_quote uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; session_id uuid; ancestor uuid;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
 -- Match ordinary preparation's actor mutex before taking cart/order locks.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement-buyer:'||
  CASE WHEN o.user_id IS NOT NULL THEN 'member:'||o.user_id ELSE 'guest:'||lower(o.guest_email) END,2));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout:'||
  CASE WHEN o.user_id IS NOT NULL THEN 'member:'||o.user_id ELSE 'guest:'||lower(o.guest_email) END||':'||o.event_id::text,1));
 -- Match paid-cart fulfillment's cart->order order, and financial writers'
 -- order->controls order. Lock immutable ancestry root-first.
 FOR ancestor IN WITH RECURSIVE chain(id,depth) AS(SELECT p_order_id,0 UNION ALL
  SELECT r.original_order_id,pathnode.depth+1 FROM dvnt_settlement.checkout_replacements r JOIN chain pathnode ON r.successor_order_id=pathnode.id)
  SELECT id FROM chain ORDER BY depth DESC LOOP
  PERFORM 1 FROM public.carts WHERE id=(SELECT cart_id FROM public.orders WHERE id=ancestor) FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=ancestor FOR UPDATE;
 END LOOP;
 SELECT * INTO o FROM public.orders WHERE id=p_order_id;
 IF o.id IS NULL THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
 IF o.user_id IS NOT NULL THEN
  IF p_actor_id IS NULL OR p_actor_id IS DISTINCT FROM o.user_id OR p_guest_session_hash IS NOT NULL THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
 ELSE
  IF p_actor_id IS NOT NULL OR p_guest_session_hash IS NULL THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
  IF p_replay_quote IS NOT NULL THEN
   SELECT s.id INTO session_id FROM dvnt_settlement.guest_recovery_sessions s
   JOIN dvnt_settlement.replacement_quotes q ON (q.guest_session_id=s.id OR EXISTS(SELECT 1 FROM dvnt_settlement.replacement_recovery_resumptions r WHERE r.session_id=s.id AND r.quote_id=q.id))
   WHERE q.id=p_replay_quote AND q.original_order_id=o.id AND q.accepted_at IS NOT NULL
    AND s.order_id=o.id AND s.session_hash=p_guest_session_hash AND s.expires_at>clock_timestamp()
    AND s.purpose='replace_canceled_checkout' FOR UPDATE OF s;
  END IF;
  IF session_id IS NULL THEN session_id:=dvnt_settlement.validate_guest_recovery_session(o.id,p_guest_session_hash); END IF;
 END IF;

 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.controls WHERE singleton AND checkout_enabled AND checkout_replacement_enabled)
 THEN RAISE EXCEPTION 'checkout replacement disabled'; END IF;
 IF o.user_id IS NULL AND NOT EXISTS(SELECT 1 FROM dvnt_settlement.controls WHERE singleton AND guest_checkout_recovery_enabled) THEN RAISE EXCEPTION 'guest recovery unavailable'; END IF;
 IF o.charge_model IS DISTINCT FROM 'separate_charges_and_transfers' OR o.type IS DISTINCT FROM 'event_ticket'
 OR NOT EXISTS(SELECT 1 FROM dvnt_settlement.checkouts WHERE order_id=o.id AND attempted_at IS NOT NULL)
 THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
 PERFORM 1 FROM dvnt_settlement.checkouts WHERE order_id=o.id FOR UPDATE;
 RETURN session_id;
END $$;

CREATE FUNCTION dvnt_settlement.replacement_assert_clear(p_order_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id FOR UPDATE;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id FOR UPDATE;
 IF o.status IS NULL OR o.status NOT IN('created','payment_pending','payment_failed','canceled','cancelled','failed')
 OR o.paid_at IS NOT NULL OR c.source_verified_at IS NOT NULL OR coalesce(c.last_error,'') LIKE 'hold:%'
 OR EXISTS(SELECT 1 FROM dvnt_settlement.orders WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.allocations WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.holds WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.funding_sources WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.refunds WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.refund_outflows WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.dispute_outflows WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_promoter_rows WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_recovery_reviews WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM public.promoter_ledger_entries WHERE order_id=o.id)
 OR EXISTS(SELECT 1 FROM public.tickets WHERE order_id=o.id OR (o.cart_id IS NOT NULL AND cart_id=o.cart_id)
   OR (o.stripe_payment_intent_id IS NOT NULL AND stripe_payment_intent_id=o.stripe_payment_intent_id)
   OR (o.stripe_checkout_session_id IS NOT NULL AND stripe_checkout_session_id=o.stripe_checkout_session_id))
 OR EXISTS(SELECT 1 FROM public.order_addons WHERE order_id=o.id OR (o.cart_id IS NOT NULL AND cart_id=o.cart_id))
 OR EXISTS(SELECT 1 FROM public.cart_line_refunds WHERE cart_id=o.cart_id)
 OR EXISTS(SELECT 1 FROM public.cart_line_items WHERE cart_id=o.cart_id AND coalesce(refunded_amount_cents,0)>0)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.external_event_exclusions WHERE event_id=o.event_id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.legacy_execution_claims WHERE event_id=o.event_id)
 OR EXISTS(SELECT 1 FROM dvnt_settlement.event_stops WHERE event_id=o.event_id)
 THEN RAISE EXCEPTION 'replacement financial or fulfillment evidence blocks retry'; END IF;
END $$;

CREATE FUNCTION public.settlement_replacement_context(p_order_id uuid,p_actor_id text DEFAULT NULL,p_guest_session_hash text DEFAULT NULL,p_replay_quote uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE; policy dvnt_settlement.funding_policy%ROWTYPE;
BEGIN
 PERFORM dvnt_settlement.replacement_authorize(p_order_id,p_actor_id,p_guest_session_hash,p_replay_quote);
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id;
 SELECT * INTO STRICT policy FROM dvnt_settlement.funding_policy WHERE singleton FOR SHARE;
 PERFORM dvnt_settlement.replacement_assert_clear(o.id);
 RETURN jsonb_build_object('ok',true,'order_id',o.id,'snapshot',c.snapshot,'stripe_params',c.stripe_params,
  'stripe_payment_intent_id',o.stripe_payment_intent_id,'stripe_checkout_session_id',o.stripe_checkout_session_id,
  'platform_account',policy.platform_account,'livemode',policy.livemode,'accepted_quote',(SELECT jsonb_build_object('quote_id',q.id,'original_order_id',q.original_order_id,'total_cents',q.snapshot->'order'->'total_cents','currency',q.snapshot->'order'->>'currency','snapshot',q.snapshot,'accepted',true,'resume_only',true,'tax_mode',q.snapshot->>'tax_mode') FROM dvnt_settlement.replacement_quotes q JOIN dvnt_settlement.checkout_replacements r ON r.quote_id=q.id WHERE r.original_order_id=o.id));
END $$;

-- Current catalog economics, evaluated while the event, tier and promoter rows
-- are locked. No original price is used to authorize a new charge. Restricted
-- and dynamic-price catalogs require their own reviewed quote adapter.
CREATE FUNCTION dvnt_settlement.replacement_snapshot(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE; e public.events%ROWTYPE;
 promoter public.event_promoters%ROWTYPE; item jsonb; lines jsonb:='[]'; selection jsonb; rowdata jsonb;
 subtotal bigint:=0; eligible bigint:=0; qty int:=0; fee_qty int:=0; unit_price int; line_qty int;
 discount bigint:=0; commission bigint:=0; pct bigint; flat bigint; buyer_fee bigint; org_fee bigint; total bigint;
 v jsonb; t record; cutoff timestamptz; cart public.carts%ROWTYPE; cart_selection jsonb;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id;
 SELECT * INTO STRICT e FROM public.events WHERE id=o.event_id FOR UPDATE NOWAIT;
 cutoff:=coalesce(e.end_date,e.start_date+interval '6 hours')-interval '30 minutes';
 IF cutoff IS NULL OR NOT isfinite(cutoff) OR clock_timestamp()>=cutoff
 OR e.host_id IS NULL OR e.host_id IS DISTINCT FROM c.organizer_user_id
 OR e.status IS DISTINCT FROM 'active' OR e.payout_status IN('disabled','on_hold')
 OR e.visibility='private' OR e.is_hidden IS TRUE OR e.publish_at>clock_timestamp()
 THEN RAISE EXCEPTION 'replacement event unavailable or requires access review'; END IF;
 IF e.fee_mode='absorb' THEN RAISE EXCEPTION 'replacement absorb fee policy requires review'; END IF;
 PERFORM dvnt_settlement.event_release_at(o.event_id);
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.funding_policy WHERE singleton)
 OR NOT EXISTS(SELECT 1 FROM dvnt_settlement.currency_reserves WHERE currency=o.currency)
 THEN RAISE EXCEPTION 'replacement funding policy unavailable'; END IF;
 IF o.promo_code_id IS NOT NULL OR coalesce(o.discount_cents,0)>coalesce(o.promoter_discount_amount_cents,0)
 THEN RAISE EXCEPTION 'replacement promo quote requires review'; END IF;
 IF c.snapshot->>'rail'='cart-checkout' THEN
  SELECT * INTO STRICT cart FROM public.carts WHERE id=o.cart_id FOR UPDATE;
  IF cart.user_id IS DISTINCT FROM o.user_id OR o.user_id IS NULL OR cart.event_id IS DISTINCT FROM o.event_id
   OR cart.currency IS DISTINCT FROM o.currency OR cart.status='completed'
   OR cart.stripe_pi_id IS DISTINCT FROM o.stripe_payment_intent_id THEN RAISE EXCEPTION 'replacement cart ownership or payment mismatch'; END IF;
  PERFORM id FROM public.cart_line_items WHERE cart_id=cart.id ORDER BY id FOR UPDATE;
  SELECT jsonb_build_object('lines',jsonb_agg(jsonb_build_object('id',l.id,'tier_id',l.tier_id,
   'addon_id',l.addon_id,'variant_id',l.variant_id,'quantity',l.quantity) ||
   CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(c.snapshot->'selection'->'lines') x
    WHERE x->>'id'=l.id::text AND x ? 'unit_price_cents')
    THEN jsonb_build_object('unit_price_cents',l.unit_price_cents) ELSE '{}'::jsonb END ORDER BY l.id::text))
   INTO cart_selection FROM public.cart_line_items l WHERE l.cart_id=cart.id;
  IF cart_selection IS DISTINCT FROM c.snapshot->'selection' THEN RAISE EXCEPTION 'replacement cart selection changed'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'tier_id',tier_id,'addon_id',addon_id,'variant_id',variant_id,
   'quantity',quantity,'category',category,'bound_line_item_id',bound_line_item_id,'metadata',metadata) ORDER BY id)
   INTO selection FROM public.cart_line_items WHERE cart_id=cart.id;
  IF selection IS NULL OR jsonb_array_length(selection)>20 THEN RAISE EXCEPTION 'replacement cart selection unavailable'; END IF;
 ELSE
  IF c.snapshot->>'rail' NOT IN('ticket-checkout','guest-checkout','create-payment-intent')
   OR c.snapshot->'selection'->>'ticket_type_id' IS NULL OR o.cart_id IS NOT NULL THEN RAISE EXCEPTION 'replacement selection unavailable'; END IF;
  selection:=jsonb_build_array(jsonb_build_object('tier_id',c.snapshot->'selection'->>'ticket_type_id','quantity',o.quantity));
 END IF;
 -- Fail closed rather than wait under the financial locks: legacy single-tier
 -- issuance takes tier before order. NOWAIT avoids that lock-order inversion.
 -- Canonical inventory allocators run only once every required row is held.
 PERFORM id FROM public.ticket_types WHERE id IN(SELECT (x->>'tier_id')::uuid FROM jsonb_array_elements(selection) x)
  ORDER BY id FOR UPDATE NOWAIT;
 PERFORM id FROM public.ticket_addons WHERE id IN(SELECT (x->>'addon_id')::uuid FROM jsonb_array_elements(selection) x)
  ORDER BY id FOR UPDATE NOWAIT;
 PERFORM id FROM public.ticket_addon_variants WHERE id IN(SELECT (x->>'variant_id')::uuid FROM jsonb_array_elements(selection) x)
  ORDER BY id FOR UPDATE NOWAIT;
 FOR item IN SELECT value FROM jsonb_array_elements(selection) LOOP
  line_qty:=(item->>'quantity')::int;
  IF line_qty IS NULL OR line_qty<1 OR line_qty>20 THEN RAISE EXCEPTION 'replacement quantity unavailable'; END IF;
  IF item->>'addon_id' IS NOT NULL THEN
   SELECT to_jsonb(a)||jsonb_build_object('variant_parent',av.addon_id,'variant_price',av.price_cents,'variant_found',av.id)
    INTO STRICT rowdata FROM public.ticket_addons a LEFT JOIN public.ticket_addon_variants av ON av.id=(item->>'variant_id')::uuid
    WHERE a.id=(item->>'addon_id')::uuid;
   IF (rowdata->>'event_id')::int IS DISTINCT FROM o.event_id OR rowdata->>'currency' IS DISTINCT FROM o.currency
    OR rowdata->>'status' IS DISTINCT FROM 'on_sale' OR rowdata->>'addon_type'='donation'
    OR rowdata->>'binding_mode' NOT IN('standalone','per_order')
    OR (rowdata->>'binding_mode'='per_order' AND line_qty<>1) OR item->>'bound_line_item_id' IS NOT NULL
    OR (item->>'variant_id' IS NOT NULL AND (rowdata->>'variant_found' IS NULL OR rowdata->>'variant_parent' IS DISTINCT FROM item->>'addon_id'))
    THEN RAISE EXCEPTION 'replacement addon unavailable or binding quote requires review'; END IF;
   unit_price:=coalesce((rowdata->>'variant_price')::int,(rowdata->>'price_cents')::int);
   IF unit_price IS NULL OR unit_price<0 THEN RAISE EXCEPTION 'replacement addon price unavailable'; END IF;
   subtotal:=subtotal+unit_price::bigint*line_qty;qty:=qty+line_qty;
   IF unit_price>0 THEN fee_qty:=fee_qty+line_qty; END IF;
   lines:=lines||jsonb_build_array(item||jsonb_build_object('category','addon','unit_price_cents',unit_price));
   CONTINUE;
  END IF;
  SELECT * INTO STRICT t FROM public.ticket_types WHERE id=(item->>'tier_id')::uuid;
  IF t.event_id IS DISTINCT FROM o.event_id OR t.currency IS DISTINCT FROM o.currency OR t.price_cents IS NULL OR t.price_cents<0
   OR t.is_active IS FALSE OR t.status IS DISTINCT FROM 'on_sale' OR coalesce(t.tier_visibility,'public')<>'public'
   OR (t.sale_start IS NOT NULL AND (NOT isfinite(t.sale_start) OR t.sale_start>clock_timestamp()))
   OR (t.sale_end IS NOT NULL AND (NOT isfinite(t.sale_end) OR t.sale_end<=clock_timestamp()))
   OR (t.sale_start IS NOT NULL AND t.sale_end IS NOT NULL AND t.sale_start>=t.sale_end)
   OR coalesce(t.price_schedule,'[]')<>'[]'::jsonb OR coalesce(t.sub_allocations,'[]')<>'[]'::jsonb
   THEN RAISE EXCEPTION 'replacement tier unavailable or dynamic quote requires review'; END IF;
  unit_price:=t.price_cents;
  subtotal:=subtotal+unit_price::bigint*line_qty;qty:=qty+line_qty;
  IF unit_price>0 THEN fee_qty:=fee_qty+line_qty; END IF;
  IF t.category='admission' OR c.snapshot->>'rail'<>'cart-checkout' THEN eligible:=eligible+unit_price::bigint*line_qty; END IF;
  lines:=lines||jsonb_build_array(item||jsonb_build_object('category',t.category,'unit_price_cents',unit_price));
 END LOOP;
 IF o.promoter_id IS NOT NULL OR o.promoter_code IS NOT NULL THEN
  SELECT * INTO STRICT promoter FROM public.event_promoters WHERE id=o.promoter_id AND event_id=o.event_id FOR SHARE NOWAIT;
  IF promoter.status IS DISTINCT FROM 'active' OR upper(promoter.code) IS DISTINCT FROM upper(o.promoter_code)
   OR promoter.user_id IS DISTINCT FROM c.promoter_user_id OR promoter.customer_discount_bps IS NULL
   OR promoter.customer_discount_bps NOT BETWEEN 0 AND 10000 OR promoter.promoter_commission_bps IS NULL
   OR promoter.promoter_commission_bps NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'replacement promoter identity or policy unavailable'; END IF;
  discount:=floor(eligible::numeric*promoter.customer_discount_bps/10000);
  commission:=floor((eligible-discount)::numeric*promoter.promoter_commission_bps/10000);
 END IF;
 subtotal:=subtotal-discount;
 IF qty>20 THEN RAISE EXCEPTION 'replacement maximum 20 units'; END IF;
 IF subtotal<=0 OR subtotal>2147483647 OR fee_qty<1 THEN RAISE EXCEPTION 'replacement paid total unavailable'; END IF;
 pct:=floor(subtotal::numeric*0.025+0.5);flat:=fee_qty*100;buyer_fee:=pct+flat;org_fee:=pct+flat;
 IF e.fee_mode='absorb' AND buyer_fee+org_fee<=subtotal THEN buyer_fee:=0; END IF;
 total:=subtotal+buyer_fee;
 IF total>2147483647 OR org_fee>subtotal OR commission>subtotal-org_fee THEN RAISE EXCEPTION 'replacement economics unavailable'; END IF;
 v:=jsonb_build_object('user_id',o.user_id,'guest_email',o.guest_email,'guest_phone',o.guest_phone,'event_id',o.event_id,
  'quantity',qty,'currency',o.currency,'cart_id',o.cart_id,'type','event_ticket','status','payment_pending',
  'subtotal_cents',subtotal,'total_cents',total,'platform_fee_cents',2*(pct+flat),
  'buyer_pct_fee_cents',CASE WHEN buyer_fee=0 THEN 0 ELSE pct END,'buyer_per_ticket_fee_cents',CASE WHEN buyer_fee=0 THEN 0 ELSE flat END,
  'buyer_fee_cents',buyer_fee,'org_pct_fee_cents',pct,'org_per_ticket_fee_cents',flat,'organizer_fee_cents',org_fee,
  'dvnt_total_fee_cents',2*(pct+flat),'fee_policy_version','v1_250_1pt','discount_cents',discount,
  'promoter_id',promoter.id,'promoter_code',promoter.code,'promoter_policy_version','v2_eligible_subtotal_after_discount',
  'promoter_original_amount_cents',eligible,'promoter_customer_discount_bps',promoter.customer_discount_bps,
  'promoter_discount_amount_cents',discount,'promoter_discounted_amount_cents',eligible-discount,
  'promoter_commission_bps',promoter.promoter_commission_bps,'promoter_commission_amount_cents',commission);
 RETURN jsonb_build_object('rail',c.snapshot->>'rail','order',v,'selection',c.snapshot->'selection','replacement_lines',lines,
  'tax_mode',CASE WHEN c.stripe_params->>'automatic_tax[enabled]'='true' THEN 'at_checkout' ELSE 'none' END,'automatic_tax',coalesce(c.stripe_params->>'automatic_tax[enabled]'='true',false));
END $$;

CREATE FUNCTION public.settlement_replacement_quote(p_order_id uuid,p_actor_id text DEFAULT NULL,p_guest_session_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s uuid; q dvnt_settlement.replacement_quotes%ROWTYPE; v_snapshot jsonb;
BEGIN
 s:=dvnt_settlement.replacement_authorize(p_order_id,p_actor_id,p_guest_session_hash);
 PERFORM dvnt_settlement.replacement_assert_clear(p_order_id);
 SELECT q2.* INTO q FROM dvnt_settlement.replacement_quotes q2 JOIN dvnt_settlement.checkout_replacements r ON r.quote_id=q2.id WHERE r.original_order_id=p_order_id;
 IF FOUND THEN
  RETURN jsonb_build_object('ok',true,'quote_id',q.id,'original_order_id',p_order_id,'expires_at',q.expires_at,
   'total_cents',q.snapshot->'order'->'total_cents','currency',q.snapshot->'order'->>'currency','tax_mode',q.snapshot->>'tax_mode',
   'snapshot',q.snapshot,'accepted',true,'resume_only',true);
 END IF;
 v_snapshot:=dvnt_settlement.replacement_snapshot(p_order_id);
 SELECT * INTO q FROM dvnt_settlement.replacement_quotes oldq WHERE oldq.original_order_id=p_order_id
  AND oldq.actor_id IS NOT DISTINCT FROM p_actor_id AND oldq.guest_session_id IS NOT DISTINCT FROM s
  AND oldq.snapshot=v_snapshot AND oldq.accepted_at IS NULL AND oldq.expires_at>clock_timestamp()
  ORDER BY oldq.created_at DESC LIMIT 1;
 IF NOT FOUND THEN
  INSERT INTO dvnt_settlement.replacement_quotes(original_order_id,actor_id,guest_session_id,snapshot)
   VALUES(p_order_id,p_actor_id,s,v_snapshot) RETURNING * INTO q;
 END IF;
 RETURN jsonb_build_object('ok',true,'quote_id',q.id,'original_order_id',p_order_id,'expires_at',q.expires_at,
  'total_cents',v_snapshot->'order'->'total_cents','currency',v_snapshot->'order'->>'currency',
  'tax_mode',v_snapshot->>'tax_mode','automatic_tax',v_snapshot->'automatic_tax','snapshot',v_snapshot);
END $$;

CREATE FUNCTION dvnt_settlement.replacement_proof(p_order_id uuid,p_intent jsonb,p_session jsonb,p_platform_account text,p_livemode boolean,p_charges jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE; c dvnt_settlement.checkouts%ROWTYPE; policy dvnt_settlement.funding_policy%ROWTYPE; gross bigint; tax bigint:=0;
BEGIN
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=o.id;
 SELECT * INTO STRICT policy FROM dvnt_settlement.funding_policy WHERE singleton FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.orders other WHERE other.id<>o.id AND
  ((o.stripe_payment_intent_id IS NOT NULL AND other.stripe_payment_intent_id=o.stripe_payment_intent_id)
   OR (o.stripe_checkout_session_id IS NOT NULL AND other.stripe_checkout_session_id=o.stripe_checkout_session_id)))
 THEN RAISE EXCEPTION 'replacement conflicting provider binding'; END IF;
 IF p_platform_account IS DISTINCT FROM policy.platform_account OR p_livemode IS DISTINCT FROM policy.livemode
 OR p_charges IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'replacement provider account or charge evidence invalid'; END IF;
 gross:=(c.snapshot->'order'->>'total_cents')::bigint;
 IF c.snapshot->>'rail' IN('ticket-checkout','guest-checkout') THEN
  IF o.stripe_checkout_session_id IS NULL OR jsonb_typeof(p_session) IS DISTINCT FROM 'object'
   OR p_session->>'id' IS DISTINCT FROM o.stripe_checkout_session_id
   OR p_session->>'id' !~ '^cs_[A-Za-z0-9_]+$' OR p_session->>'object' IS DISTINCT FROM 'checkout.session'
   OR p_session->>'mode' IS DISTINCT FROM 'payment' OR p_session->>'status' IS DISTINCT FROM 'expired'
   OR p_session->>'payment_status' IS DISTINCT FROM 'unpaid' OR p_session->'livemode' IS DISTINCT FROM to_jsonb(policy.livemode)
   OR p_session->>'currency' IS DISTINCT FROM o.currency OR p_session->'amount_subtotal' IS DISTINCT FROM to_jsonb(gross)
   OR p_session->>'payment_intent' IS DISTINCT FROM o.stripe_payment_intent_id
   OR p_session->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
   OR p_session->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
   OR jsonb_typeof(p_session->'total_details'->'amount_tax') IS DISTINCT FROM 'number'
   OR (p_session->'total_details'->>'amount_tax')::numeric<0
   OR trunc((p_session->'total_details'->>'amount_tax')::numeric)<>(p_session->'total_details'->>'amount_tax')::numeric
   OR p_session->'total_details'->'amount_discount' IS DISTINCT FROM '0'::jsonb
   OR p_session->'total_details'->'amount_shipping' IS DISTINCT FROM '0'::jsonb
   THEN RAISE EXCEPTION 'replacement hosted proof invalid'; END IF;
  tax:=(p_session->'total_details'->>'amount_tax')::bigint;gross:=gross+tax;
  IF p_session->'amount_total' IS DISTINCT FROM to_jsonb(gross) THEN RAISE EXCEPTION 'replacement hosted amount invalid'; END IF;
 ELSIF p_session IS NOT NULL OR o.stripe_checkout_session_id IS NOT NULL THEN RAISE EXCEPTION 'replacement unexpected hosted proof'; END IF;
 IF o.stripe_payment_intent_id IS NULL OR jsonb_typeof(p_intent) IS DISTINCT FROM 'object'
 OR p_intent->>'id' IS DISTINCT FROM o.stripe_payment_intent_id OR p_intent->>'id' !~ '^pi_[A-Za-z0-9_]+$'
 OR p_intent->>'object' IS DISTINCT FROM 'payment_intent' OR p_intent->>'status' IS DISTINCT FROM 'canceled'
 OR p_intent->'amount' IS DISTINCT FROM to_jsonb(gross) OR p_intent->>'currency' IS DISTINCT FROM o.currency
 OR p_intent->'amount_received' IS DISTINCT FROM '0'::jsonb OR p_intent->'amount_capturable' IS DISTINCT FROM '0'::jsonb
 OR p_intent->'latest_charge' IS DISTINCT FROM 'null'::jsonb OR p_intent->'livemode' IS DISTINCT FROM to_jsonb(policy.livemode)
 OR p_intent->'transfer_data' IS DISTINCT FROM 'null'::jsonb OR p_intent->'application_fee_amount' IS DISTINCT FROM 'null'::jsonb
 OR p_intent->'on_behalf_of' IS DISTINCT FROM 'null'::jsonb
 OR p_intent->'metadata'->>'settlement_order_id' IS DISTINCT FROM o.id::text
 OR p_intent->'metadata'->>'charge_model' IS DISTINCT FROM o.charge_model
 OR jsonb_typeof(p_intent->'canceled_at') IS DISTINCT FROM 'number' OR (p_intent->>'canceled_at')::numeric<=0
 OR trunc((p_intent->>'canceled_at')::numeric)<>(p_intent->>'canceled_at')::numeric
 OR (p_intent->>'canceled_at')::numeric>extract(epoch FROM clock_timestamp())
 THEN RAISE EXCEPTION 'replacement canceled zero-money proof invalid'; END IF;
 -- Never persist customer/payment method details, client_secret or raw metadata.
 RETURN jsonb_build_object('version',1,'order_id',o.id,'platform_account',policy.platform_account,'livemode',policy.livemode,
  'payment_intent_id',o.stripe_payment_intent_id,'checkout_session_id',o.stripe_checkout_session_id,'currency',o.currency,
  'base_amount_cents',c.snapshot->'order'->'total_cents','gross_amount_cents',gross,'tax_cents',tax,
  'canceled_at',p_intent->'canceled_at','observed_at',clock_timestamp(),'charge_ids','[]'::jsonb);
END $$;

CREATE FUNCTION public.settlement_replacement_accept(p_quote_id uuid,p_actor_id text,p_guest_session_hash text,
 p_accepted_total_cents bigint,p_accepted_currency text,p_intent jsonb,p_session jsonb,p_platform_account text,p_livemode boolean,p_charges jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q dvnt_settlement.replacement_quotes%ROWTYPE; original public.orders%ROWTYPE; successor public.orders%ROWTYPE;
 checkout dvnt_settlement.checkouts%ROWTYPE; s uuid; fresh jsonb; v jsonb; proof jsonb; ancestors uuid[];
 ancestor uuid; new_cart uuid; new_order uuid:=gen_random_uuid(); item jsonb; new_line uuid; line_map jsonb:='{}';
 hold jsonb; parent_c dvnt_settlement.checkouts%ROWTYPE; replacement dvnt_settlement.checkout_replacements%ROWTYPE;
BEGIN
 SELECT * INTO q FROM dvnt_settlement.replacement_quotes WHERE id=p_quote_id;
 IF q.id IS NULL THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
 s:=dvnt_settlement.replacement_authorize(q.original_order_id,p_actor_id,p_guest_session_hash,p_quote_id);
 SELECT * INTO STRICT q FROM dvnt_settlement.replacement_quotes WHERE id=p_quote_id FOR UPDATE;
 IF q.actor_id IS DISTINCT FROM p_actor_id OR (q.accepted_at IS NULL AND q.guest_session_id IS DISTINCT FROM s)
 OR p_accepted_total_cents IS DISTINCT FROM (q.snapshot->'order'->>'total_cents')::bigint
 OR p_accepted_currency IS DISTINCT FROM q.snapshot->'order'->>'currency' THEN RAISE EXCEPTION 'replacement acceptance mismatch'; END IF;
 IF q.accepted_at IS NOT NULL THEN
  SELECT * INTO STRICT successor FROM public.orders WHERE id=q.successor_order_id;
  SELECT * INTO STRICT checkout FROM dvnt_settlement.checkouts WHERE order_id=successor.id;
  IF s IS NOT NULL THEN
   INSERT INTO dvnt_settlement.replacement_recovery_resumptions(session_id,quote_id) VALUES(s,q.id) ON CONFLICT(session_id) DO NOTHING;
   UPDATE dvnt_settlement.guest_recovery_sessions SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE id=s;
  END IF;
 ELSE
  IF q.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'replacement quote expired'; END IF;
  IF EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE original_order_id=q.original_order_id)
   THEN RAISE EXCEPTION 'replacement already authorized; recover existing successor'; END IF;
  SELECT * INTO STRICT original FROM public.orders WHERE id=q.original_order_id;
  -- All events share the global buyer mutex acquired by authorization.
  IF (SELECT count(*) FROM dvnt_settlement.checkout_replacements r JOIN public.orders o ON o.id=r.successor_order_id
   WHERE o.id<>original.id AND (CASE WHEN original.user_id IS NOT NULL THEN o.user_id=original.user_id
     ELSE o.user_id IS NULL AND lower(o.guest_email)=lower(original.guest_email) END)
   AND (EXISTS(SELECT 1 FROM public.ticket_holds h WHERE h.status='active' AND h.payment_intent_id IN('replacement:'||o.id::text,o.stripe_payment_intent_id,o.stripe_checkout_session_id))
    OR EXISTS(SELECT 1 FROM public.cart_holds h WHERE h.cart_id=o.cart_id AND NOT h.released)))
   >=(SELECT max_active_replacements FROM dvnt_settlement.controls WHERE singleton)
   THEN RAISE EXCEPTION 'replacement active inventory limit reached'; END IF;
  IF (SELECT coalesce(sum(o.quantity),0) FROM dvnt_settlement.checkout_replacements r JOIN public.orders o ON o.id=r.successor_order_id
   WHERE o.id<>original.id AND (CASE WHEN original.user_id IS NOT NULL THEN o.user_id=original.user_id
     ELSE o.user_id IS NULL AND lower(o.guest_email)=lower(original.guest_email) END)
   AND (EXISTS(SELECT 1 FROM public.ticket_holds h WHERE h.status='active' AND h.payment_intent_id IN('replacement:'||o.id::text,o.stripe_payment_intent_id,o.stripe_checkout_session_id))
    OR EXISTS(SELECT 1 FROM public.cart_holds h WHERE h.cart_id=o.cart_id AND NOT h.released)))+(q.snapshot->'order'->>'quantity')::bigint
   >(SELECT max_active_replacement_units FROM dvnt_settlement.controls WHERE singleton)
   THEN RAISE EXCEPTION 'replacement active inventory unit limit reached'; END IF;
  SELECT * INTO STRICT parent_c FROM dvnt_settlement.checkouts WHERE order_id=original.id;
  WITH RECURSIVE chain(id) AS(SELECT original.id UNION SELECT r.original_order_id FROM dvnt_settlement.checkout_replacements r JOIN chain pathnode ON r.successor_order_id=pathnode.id)
   SELECT array_agg(id ORDER BY id) INTO ancestors FROM chain;
  FOREACH ancestor IN ARRAY ancestors LOOP PERFORM dvnt_settlement.replacement_assert_clear(ancestor); END LOOP;
  IF EXISTS(SELECT 1 FROM dvnt_settlement.checkouts c JOIN public.orders o ON o.id=c.order_id
   WHERE NOT(o.id=ANY(ancestors)) AND o.event_id=original.event_id
    AND (o.status IS DISTINCT FROM 'paid' OR c.created_at>=parent_c.created_at)
    AND (CASE WHEN original.user_id IS NOT NULL THEN o.user_id=original.user_id ELSE o.user_id IS NULL AND lower(o.guest_email)=lower(original.guest_email) END)
    AND dvnt_settlement.checkout_selections_overlap(c.snapshot->'selection',parent_c.snapshot->'selection'))
   THEN RAISE EXCEPTION 'replacement conflicts with another purchase'; END IF;
  proof:=dvnt_settlement.replacement_proof(original.id,p_intent,p_session,p_platform_account,p_livemode,p_charges);
  fresh:=dvnt_settlement.replacement_snapshot(original.id);
  IF fresh IS DISTINCT FROM q.snapshot THEN RAISE EXCEPTION 'replacement quote changed; review fresh total'; END IF;
  -- Original reservation history is retained. Only active holds exactly bound
  -- to this canceled payment are expired; no deletion or identity reassignment.
  IF EXISTS(SELECT 1 FROM public.ticket_holds h WHERE h.status='active' AND h.payment_intent_id IN(original.stripe_payment_intent_id,original.stripe_checkout_session_id)
   AND (h.event_id IS DISTINCT FROM original.event_id OR h.user_id IS DISTINCT FROM original.user_id OR lower(h.guest_email) IS DISTINCT FROM lower(original.guest_email)
    OR h.ticket_type_id IS DISTINCT FROM (parent_c.snapshot->'selection'->>'ticket_type_id')::uuid OR h.quantity IS DISTINCT FROM original.quantity))
   THEN RAISE EXCEPTION 'replacement original inventory ownership mismatch'; END IF;
  INSERT INTO dvnt_settlement.replacement_inventory_releases(order_id,reason,proof) VALUES(original.id,'canceled',proof) ON CONFLICT(order_id,reason) DO NOTHING;
  UPDATE public.ticket_holds SET status='expired' WHERE status='active'
   AND payment_intent_id IN(original.stripe_payment_intent_id,original.stripe_checkout_session_id);
  IF original.cart_id IS NOT NULL THEN
   UPDATE public.cart_holds SET released=true,released_at=clock_timestamp() WHERE cart_id=original.cart_id AND NOT released;
   new_cart:=gen_random_uuid();
   INSERT INTO public.carts(id,user_id,event_id,status,currency,idempotency_key)
    VALUES(new_cart,original.user_id,original.event_id,'draft',original.currency,'replacement:'||new_order::text);
   FOR item IN SELECT value FROM jsonb_array_elements(fresh->'replacement_lines') LOOP
    new_line:=gen_random_uuid();line_map:=line_map||jsonb_build_object(item->>'id',new_line);
   END LOOP;
   FOR item IN SELECT value FROM jsonb_array_elements(fresh->'replacement_lines') LOOP
    INSERT INTO public.cart_line_items(id,cart_id,category,tier_id,addon_id,variant_id,bound_line_item_id,quantity,unit_price_cents,metadata)
     VALUES((line_map->>(item->>'id'))::uuid,new_cart,item->>'category',(item->>'tier_id')::uuid,(item->>'addon_id')::uuid,(item->>'variant_id')::uuid,
      (line_map->>(item->>'bound_line_item_id'))::uuid,(item->>'quantity')::int,(item->>'unit_price_cents')::int,coalesce(item->'metadata','{}'));
   END LOOP;
   hold:=public.cart_create_hold(new_cart,3600,'[]');
   IF hold->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'replacement inventory unavailable: %',hold->>'error'; END IF;
   fresh:=jsonb_set(fresh,'{order,cart_id}',to_jsonb(new_cart));
   SELECT jsonb_set(fresh,'{selection}',jsonb_build_object('lines',jsonb_agg(jsonb_build_object('id',id,'tier_id',tier_id,'addon_id',addon_id,'variant_id',variant_id,'quantity',quantity,'unit_price_cents',unit_price_cents) ORDER BY id::text)))
    INTO fresh FROM public.cart_line_items WHERE cart_id=new_cart;
  ELSE
   hold:=public.ticket_purchase_hold_atomic((fresh->'selection'->>'ticket_type_id')::uuid,(fresh->'order'->>'quantity')::int,
    'replacement:'||new_order::text,original.user_id,original.guest_email,3600,'checkout');
   IF hold->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'replacement inventory unavailable: %',hold->>'error'; END IF;
  END IF;
  v:=fresh->'order';
  INSERT INTO public.orders(id,user_id,guest_email,guest_phone,type,status,charge_model,event_id,quantity,currency,
   subtotal_cents,total_cents,platform_fee_cents,buyer_pct_fee_cents,buyer_per_ticket_fee_cents,buyer_fee_cents,
   org_pct_fee_cents,org_per_ticket_fee_cents,organizer_fee_cents,dvnt_total_fee_cents,fee_policy_version,
   cart_id,discount_cents,promoter_id,promoter_code,promoter_policy_version,promoter_original_amount_cents,
   promoter_customer_discount_bps,promoter_discount_amount_cents,promoter_discounted_amount_cents,promoter_commission_bps,promoter_commission_amount_cents)
  VALUES(new_order,original.user_id,original.guest_email,original.guest_phone,'event_ticket','payment_pending','separate_charges_and_transfers',
   original.event_id,(v->>'quantity')::int,original.currency,(v->>'subtotal_cents')::int,(v->>'total_cents')::int,
   (v->>'platform_fee_cents')::int,(v->>'buyer_pct_fee_cents')::int,(v->>'buyer_per_ticket_fee_cents')::int,(v->>'buyer_fee_cents')::int,
   (v->>'org_pct_fee_cents')::int,(v->>'org_per_ticket_fee_cents')::int,(v->>'organizer_fee_cents')::int,(v->>'dvnt_total_fee_cents')::int,v->>'fee_policy_version',
   new_cart,(v->>'discount_cents')::int,(v->>'promoter_id')::uuid,v->>'promoter_code',v->>'promoter_policy_version',(v->>'promoter_original_amount_cents')::int,
   (v->>'promoter_customer_discount_bps')::int,(v->>'promoter_discount_amount_cents')::int,(v->>'promoter_discounted_amount_cents')::int,
   (v->>'promoter_commission_bps')::int,(v->>'promoter_commission_amount_cents')::int) RETURNING * INTO successor;
  IF successor.promoter_id IS NOT NULL THEN
   INSERT INTO public.promoter_attributions(order_id,promoter_id,locked_rev_share_bps,locked_customer_discount_bps,
    locked_promoter_commission_bps,locked_promoter_discount_amount_cents,locked_promoter_commission_amount_cents)
   SELECT successor.id,id,coalesce(rev_share_bps,0),customer_discount_bps,promoter_commission_bps,
    successor.promoter_discount_amount_cents,successor.promoter_commission_amount_cents FROM public.event_promoters WHERE id=successor.promoter_id;
  END IF;
  INSERT INTO dvnt_settlement.checkouts(order_id,request_scope,snapshot,release_not_before,organizer_user_id,promoter_id,promoter_user_id)
   VALUES(successor.id,'replacement:'||original.id::text,fresh,dvnt_settlement.event_release_at(original.event_id),parent_c.organizer_user_id,
    parent_c.promoter_id,parent_c.promoter_user_id) RETURNING * INTO checkout;
  INSERT INTO dvnt_settlement.checkout_replacements(original_order_id,successor_order_id,quote_id,proof,original_cart_id,successor_cart_id,line_map)
   VALUES(original.id,successor.id,q.id,proof,original.cart_id,new_cart,line_map);
  -- Outstanding/unknown provider outcomes retain inventory indefinitely.
  UPDATE public.ticket_holds SET expires_at='infinity' WHERE payment_intent_id='replacement:'||successor.id::text AND status='active';
  UPDATE public.cart_holds SET expires_at='infinity' WHERE cart_id=new_cart AND NOT released;
  UPDATE dvnt_settlement.replacement_quotes SET accepted_at=clock_timestamp(),successor_order_id=successor.id WHERE id=q.id;
  IF s IS NOT NULL THEN UPDATE dvnt_settlement.guest_recovery_sessions SET consumed_at=clock_timestamp() WHERE id=s; END IF;
 END IF;
 RETURN jsonb_build_object('ok',true,'order_id',successor.id,'original_order_id',q.original_order_id,'snapshot',checkout.snapshot,
  'created_at',checkout.created_at,'idempotency_key','dvnt:checkout:v1:'||successor.id::text,'charge_model',successor.charge_model,
  'new_cart_id',successor.cart_id,'stripe_payment_intent_id',successor.stripe_payment_intent_id,'stripe_checkout_session_id',successor.stripe_checkout_session_id);
END $$;

-- Finalize provider identity and attach ONLY the successor reservation in one
-- transaction, including when an early webhook binds the exact new order.
ALTER FUNCTION public.finalize_settlement_checkout(uuid,text,text) RENAME TO finalize_settlement_checkout_without_replacement;
REVOKE ALL ON FUNCTION public.finalize_settlement_checkout_without_replacement(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.finalize_settlement_checkout(p_order_id uuid,p_payment_intent_id text,p_checkout_session_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; r dvnt_settlement.checkout_replacements%ROWTYPE; o public.orders%ROWTYPE; hold_key text;
BEGIN
 result:=public.finalize_settlement_checkout_without_replacement(p_order_id,p_payment_intent_id,p_checkout_session_id);
 SELECT * INTO r FROM dvnt_settlement.checkout_replacements WHERE successor_order_id=p_order_id;
 IF r.successor_order_id IS NOT NULL THEN
  SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
  IF EXISTS(SELECT 1 FROM public.orders other WHERE other.id<>o.id AND
   ((p_payment_intent_id IS NOT NULL AND other.stripe_payment_intent_id=p_payment_intent_id)
    OR (p_checkout_session_id IS NOT NULL AND other.stripe_checkout_session_id=p_checkout_session_id)))
   THEN RAISE EXCEPTION 'replacement conflicting provider binding'; END IF;
  IF r.successor_cart_id IS NOT NULL THEN
   IF p_payment_intent_id IS NULL THEN RAISE EXCEPTION 'replacement cart requires payment intent'; END IF;
   UPDATE public.carts SET stripe_pi_id=p_payment_intent_id,status='paying',total_cents=o.total_cents,
    fee_cents=o.buyer_fee_cents,tax_cents=coalesce(o.tax_cents,0)
    WHERE id=r.successor_cart_id AND user_id=o.user_id AND (stripe_pi_id IS NULL OR stripe_pi_id=p_payment_intent_id);
   IF NOT FOUND THEN RAISE EXCEPTION 'replacement cart binding mismatch'; END IF;
  ELSE
   hold_key:=coalesce(p_checkout_session_id,p_payment_intent_id);
   UPDATE public.ticket_holds SET payment_intent_id=hold_key WHERE payment_intent_id='replacement:'||p_order_id::text;
   IF NOT FOUND AND NOT EXISTS(SELECT 1 FROM public.ticket_holds WHERE payment_intent_id=hold_key)
    THEN RAISE EXCEPTION 'replacement inventory binding missing'; END IF;
  END IF;
 END IF;
 RETURN result;
END $$;

-- A committed accepted selection cannot be edited between reservation and
-- provider dispatch. New lines are inserted before immutable lineage is bound.
CREATE FUNCTION dvnt_settlement.freeze_replacement_cart_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE original_cart_id=OLD.id OR successor_cart_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'replacement cart history is immutable'; END IF;
  IF ROW(NEW.id,NEW.user_id,NEW.event_id,NEW.currency,NEW.idempotency_key) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.event_id,OLD.currency,OLD.idempotency_key)
   OR (OLD.stripe_pi_id IS NOT NULL AND NEW.stripe_pi_id IS DISTINCT FROM OLD.stripe_pi_id)
   OR (NEW.stripe_pi_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.orders WHERE cart_id=OLD.id AND stripe_payment_intent_id=NEW.stripe_pi_id))
   THEN RAISE EXCEPTION 'replacement cart identity is immutable'; END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER immutable_replacement_cart_identity BEFORE UPDATE OR DELETE ON public.carts
 FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_replacement_cart_identity();
CREATE FUNCTION dvnt_settlement.freeze_replacement_cart_lines() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE cart_key uuid;
BEGIN
 cart_key:=CASE WHEN TG_OP='DELETE' THEN OLD.cart_id ELSE NEW.cart_id END;
 IF EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE successor_cart_id=cart_key OR original_cart_id=cart_key)
 OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE successor_cart_id=OLD.cart_id OR original_cart_id=OLD.cart_id))
 THEN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'refunded_amount_cents'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'refunded_amount_cents'-'updated_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'replacement cart selection is immutable';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
-- Source inventory dependencies are mandatory even while the feature is off.
DO $$ BEGIN
 IF to_regclass('public.cart_line_items') IS NULL THEN RAISE EXCEPTION 'replacement requires cart_line_items'; ELSE
  CREATE TRIGGER freeze_replacement_cart_selection BEFORE INSERT OR UPDATE OR DELETE ON public.cart_line_items
   FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.freeze_replacement_cart_lines();
 END IF;
END $$;
CREATE FUNCTION public.settlement_replacement_dispatch_context(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.orders%ROWTYPE;c dvnt_settlement.checkouts%ROWTYPE;r dvnt_settlement.checkout_replacements%ROWTYPE; ancestor uuid;
 e public.events%ROWTYPE; expires timestamptz; hold_key text; held_quantity bigint;
BEGIN
 SELECT * INTO r FROM dvnt_settlement.checkout_replacements WHERE successor_order_id=p_order_id;
 IF r.successor_order_id IS NULL THEN RAISE EXCEPTION 'replacement unavailable'; END IF;
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('replacement-buyer:'||
  CASE WHEN o.user_id IS NOT NULL THEN 'member:'||o.user_id ELSE 'guest:'||lower(o.guest_email) END,2));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('checkout:'||
  CASE WHEN o.user_id IS NOT NULL THEN 'member:'||o.user_id ELSE 'guest:'||lower(o.guest_email) END||':'||o.event_id::text,1));
 FOR ancestor IN WITH RECURSIVE chain(id,depth) AS(SELECT p_order_id,0 UNION ALL
  SELECT x.original_order_id,pathnode.depth+1 FROM dvnt_settlement.checkout_replacements x JOIN chain pathnode ON x.successor_order_id=pathnode.id)
  SELECT id FROM chain ORDER BY depth DESC LOOP
  PERFORM 1 FROM public.carts WHERE id=(SELECT cart_id FROM public.orders WHERE id=ancestor) FOR UPDATE;
  PERFORM 1 FROM public.orders WHERE id=ancestor FOR UPDATE;
 END LOOP;
 PERFORM 1 FROM dvnt_settlement.controls WHERE singleton FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM dvnt_settlement.controls WHERE singleton AND checkout_enabled AND checkout_replacement_enabled)
 THEN RAISE EXCEPTION 'checkout replacement disabled'; END IF;
 SELECT * INTO STRICT o FROM public.orders WHERE id=p_order_id;
 SELECT * INTO STRICT c FROM dvnt_settlement.checkouts WHERE order_id=p_order_id FOR UPDATE;
 IF o.status='paid' THEN RETURN jsonb_build_object('ok',true,'checkout_available',false,'order_id',o.id,'status',o.status); END IF;
 IF o.status IS DISTINCT FROM 'payment_pending' THEN RAISE EXCEPTION 'replacement payment unavailable'; END IF;
 FOR ancestor IN WITH RECURSIVE chain(id) AS(SELECT r.original_order_id UNION
  SELECT x.original_order_id FROM dvnt_settlement.checkout_replacements x JOIN chain pathnode ON x.successor_order_id=pathnode.id)
  SELECT id FROM chain LOOP PERFORM dvnt_settlement.replacement_assert_clear(ancestor); END LOOP;
 PERFORM dvnt_settlement.replacement_assert_clear(o.id);
 SELECT * INTO STRICT e FROM public.events WHERE id=o.event_id FOR SHARE NOWAIT;
 IF e.status IS DISTINCT FROM 'active' OR e.payout_status IN('disabled','on_hold') OR e.host_id IS DISTINCT FROM c.organizer_user_id
 OR e.visibility='private' OR e.is_hidden IS TRUE OR e.publish_at>clock_timestamp()
 OR coalesce(e.end_date,e.start_date+interval '6 hours') IS NULL
 OR coalesce(e.end_date,e.start_date+interval '6 hours')-interval '30 minutes'<=clock_timestamp()
 THEN RAISE EXCEPTION 'replacement event no longer on sale'; END IF;
 IF o.cart_id IS NOT NULL THEN
  PERFORM 1 FROM public.carts WHERE id=o.cart_id AND user_id=o.user_id AND event_id=o.event_id
   AND currency=o.currency AND status IN('holding','paying') AND stripe_pi_id IS NOT DISTINCT FROM o.stripe_payment_intent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'replacement cart binding mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=o.cart_id AND
   (SELECT coalesce(sum(h.qty),0) FROM public.cart_holds h WHERE h.cart_id=o.cart_id AND h.line_item_id=l.id
    AND h.tier_id IS NOT DISTINCT FROM l.tier_id AND h.addon_id IS NOT DISTINCT FROM l.addon_id
    AND h.variant_id IS NOT DISTINCT FROM l.variant_id AND NOT h.released AND h.expires_at>clock_timestamp())<>l.quantity)
   OR NOT EXISTS(SELECT 1 FROM public.cart_line_items WHERE cart_id=o.cart_id)
   THEN RAISE EXCEPTION 'replacement inventory expired or changed'; END IF;
  SELECT min(expires_at) INTO expires FROM public.cart_holds WHERE cart_id=o.cart_id AND NOT released;
 ELSE
  hold_key:=coalesce(o.stripe_checkout_session_id,o.stripe_payment_intent_id,'replacement:'||o.id::text);
  SELECT sum(h.quantity),min(h.expires_at) INTO held_quantity,expires FROM public.ticket_holds h
   WHERE payment_intent_id=hold_key AND status='active' AND expires_at>clock_timestamp()
    AND ticket_type_id=(c.snapshot->'selection'->>'ticket_type_id')::uuid
    AND user_id IS NOT DISTINCT FROM o.user_id AND guest_email IS NOT DISTINCT FROM o.guest_email;
  IF held_quantity IS DISTINCT FROM o.quantity::bigint THEN RAISE EXCEPTION 'replacement inventory expired or changed'; END IF;
 END IF;
 IF expires IS NULL OR expires<=clock_timestamp() THEN RAISE EXCEPTION 'replacement inventory expired'; END IF;
 RETURN jsonb_build_object('ok',true,'checkout_available',true,'order_id',o.id,'snapshot',c.snapshot,'created_at',c.created_at,
  'idempotency_key','dvnt:checkout:v1:'||o.id::text,'charge_model',o.charge_model,'new_cart_id',o.cart_id,'hold_expires_at',CASE WHEN c.snapshot->>'rail' IN('ticket-checkout','guest-checkout') THEN least(expires,c.created_at+interval '1 hour') ELSE expires END,
  'stripe_payment_intent_id',o.stripe_payment_intent_id,'stripe_checkout_session_id',o.stripe_checkout_session_id);
END $$;
ALTER FUNCTION public.claim_settlement_checkout(uuid,jsonb) RENAME TO claim_settlement_checkout_without_replacement;
REVOKE ALL ON FUNCTION public.claim_settlement_checkout_without_replacement(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.claim_settlement_checkout(p_order_id uuid,p_params jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE successor_order_id=p_order_id) THEN
  context:=public.settlement_replacement_dispatch_context(p_order_id);
  IF context->>'checkout_available' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'replacement payment no longer available'; END IF;
  IF context->'snapshot'->>'rail' IN('ticket-checkout','guest-checkout') AND
   (p_params->>'expires_at' IS NULL OR (p_params->>'expires_at')::bigint>extract(epoch FROM (context->>'hold_expires_at')::timestamptz))
   THEN RAISE EXCEPTION 'replacement provider expiry exceeds inventory hold'; END IF;
 END IF;
 RETURN public.claim_settlement_checkout_without_replacement(p_order_id,p_params);
END $$;

CREATE FUNCTION dvnt_settlement.protect_replacement_inventory() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE order_key uuid; o public.orders%ROWTYPE; oldrow jsonb; newrow jsonb; permitted boolean;
BEGIN
 IF TG_OP<>'INSERT' THEN oldrow:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN newrow:=to_jsonb(NEW); END IF;
 IF TG_TABLE_NAME='cart_holds' THEN
  SELECT r.successor_order_id INTO order_key FROM dvnt_settlement.checkout_replacements r
   WHERE r.successor_cart_id=(coalesce(oldrow,newrow)->>'cart_id')::uuid;
 ELSE
  SELECT o2.id INTO order_key FROM public.orders o2 JOIN dvnt_settlement.checkout_replacements r ON r.successor_order_id=o2.id
   WHERE coalesce(oldrow,newrow)->>'payment_intent_id' IN('replacement:'||o2.id::text,o2.stripe_payment_intent_id,o2.stripe_checkout_session_id);
 END IF;
 IF order_key IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'replacement inventory history is immutable'; END IF;
 SELECT * INTO STRICT o FROM public.orders WHERE id=order_key;
 permitted:=EXISTS(SELECT 1 FROM dvnt_settlement.replacement_inventory_releases WHERE order_id=order_key);
 IF TG_TABLE_NAME='cart_holds' THEN
  IF TG_OP='UPDATE' AND (oldrow-'released'-'released_at'-'expires_at') IS DISTINCT FROM (newrow-'released'-'released_at'-'expires_at')
   THEN RAISE EXCEPTION 'replacement inventory identity is immutable'; END IF;
  IF NOT permitted THEN
   NEW.expires_at:='infinity';
   IF TG_OP='UPDATE' THEN NEW.released:=OLD.released;NEW.released_at:=OLD.released_at; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND (oldrow-'status'-'expires_at'-'payment_intent_id'-'hold_kind') IS DISTINCT FROM (newrow-'status'-'expires_at'-'payment_intent_id'-'hold_kind')
   THEN RAISE EXCEPTION 'replacement inventory identity is immutable'; END IF;
  IF NEW.payment_intent_id IS DISTINCT FROM coalesce(o.stripe_checkout_session_id,o.stripe_payment_intent_id,'replacement:'||o.id::text)
   THEN RAISE EXCEPTION 'replacement inventory payment identity mismatch'; END IF;
  IF NEW.status='converted' AND (SELECT count(*) FROM public.tickets WHERE order_id=o.id AND ticket_type_id=NEW.ticket_type_id)>=o.quantity
   THEN RETURN NEW; END IF;
  IF NOT permitted THEN NEW.expires_at:='infinity';IF TG_OP='UPDATE' THEN NEW.status:=OLD.status; END IF; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF to_regclass('public.ticket_holds') IS NULL THEN RAISE EXCEPTION 'replacement requires ticket_holds'; ELSE
  CREATE TRIGGER retain_replacement_ticket_inventory BEFORE INSERT OR UPDATE OR DELETE ON public.ticket_holds
   FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.protect_replacement_inventory();
 END IF;
 IF to_regclass('public.cart_holds') IS NULL THEN RAISE EXCEPTION 'replacement requires cart_holds'; ELSE
  CREATE TRIGGER retain_replacement_cart_inventory BEFORE INSERT OR UPDATE OR DELETE ON public.cart_holds
   FOR EACH ROW EXECUTE FUNCTION dvnt_settlement.protect_replacement_inventory();
 END IF;
END $$;

-- Existing complete_paid_cart_atomic already accepts only trusted, freshly
-- verified successful provider evidence from the webhook/reconciler. Its
-- internal release-and-rearm must be atomic with the replacement exemption.
DO $$ BEGIN
 IF to_regprocedure('public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz)') IS NULL THEN RAISE EXCEPTION 'replacement requires canonical complete_paid_cart_atomic'; ELSE
  ALTER FUNCTION public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) RENAME TO complete_paid_cart_atomic_without_replacement;
  REVOKE ALL ON FUNCTION public.complete_paid_cart_atomic_without_replacement(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
  EXECUTE $wrapper$
  CREATE FUNCTION public.complete_paid_cart_atomic(p_cart_id uuid,p_payment_intent_id text,p_amount_received integer,
   p_currency text,p_user_id text,p_event_id integer,p_ticket_rows jsonb,p_addon_rows jsonb,p_event_created_at timestamptz DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
  DECLARE result jsonb; o public.orders%ROWTYPE;
  BEGIN
   IF EXISTS(SELECT 1 FROM dvnt_settlement.checkout_replacements WHERE successor_cart_id=p_cart_id) THEN
    -- Preserve the deployed cart->order lock order used by paid fulfillment.
    PERFORM 1 FROM public.carts WHERE id=p_cart_id FOR UPDATE;
    SELECT * INTO STRICT o FROM public.orders WHERE cart_id=p_cart_id FOR UPDATE;
    IF o.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id OR o.total_cents IS DISTINCT FROM p_amount_received
     OR o.currency IS DISTINCT FROM p_currency OR o.user_id IS DISTINCT FROM p_user_id OR o.event_id IS DISTINCT FROM p_event_id
     OR EXISTS(SELECT 1 FROM dvnt_settlement.replacement_inventory_releases WHERE order_id=o.id AND reason='canceled')
     THEN RAISE EXCEPTION 'replacement paid inventory proof mismatch'; END IF;
    INSERT INTO dvnt_settlement.replacement_inventory_releases(order_id,reason,proof)
     VALUES(o.id,'fulfilled',jsonb_build_object('payment_intent_id',p_payment_intent_id,'amount_received',p_amount_received,'currency',p_currency))
     ON CONFLICT(order_id,reason) DO NOTHING;
   END IF;
   result:=public.complete_paid_cart_atomic_without_replacement(p_cart_id,p_payment_intent_id,p_amount_received,p_currency,p_user_id,p_event_id,p_ticket_rows,p_addon_rows,p_event_created_at);
   IF o.id IS NOT NULL AND result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'replacement paid inventory incomplete: %',result->>'error'; END IF;
   RETURN result;
  END $body$;
  $wrapper$;
  REVOKE ALL ON FUNCTION public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) TO service_role;
 END IF;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='dvnt_settlement' AND p.proname IN('replacement_authorize','replacement_assert_clear','replacement_snapshot','replacement_proof','freeze_replacement_quote','freeze_replacement_cart_lines','freeze_replacement_cart_identity','protect_replacement_inventory'))
 OR (n.nspname='public' AND p.proname IN('settlement_replacement_context','settlement_replacement_quote','settlement_replacement_accept','settlement_replacement_dispatch_context','claim_settlement_checkout','finalize_settlement_checkout')) LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated,service_role';
  IF f.signature::text LIKE 'settlement_replacement_%' OR f.signature::text LIKE 'finalize_settlement_checkout(%' OR f.signature::text LIKE 'claim_settlement_checkout(%'
   OR f.signature::text LIKE 'public.settlement_replacement_%' OR f.signature::text LIKE 'public.finalize_settlement_checkout(%' OR f.signature::text LIKE 'public.claim_settlement_checkout(%'
  THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role'; END IF;
 END LOOP;
END $$;
COMMIT;
