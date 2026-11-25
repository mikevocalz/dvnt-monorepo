-- Future v1 web carts only. No Stripe parameter changes, backfill, or sends.
BEGIN;
ALTER TABLE public.ticket_receipt_outbox DROP CONSTRAINT ticket_receipt_outbox_source_kind_check,
 ADD CONSTRAINT ticket_receipt_outbox_source_kind_check
 CHECK (source_kind IN ('member_comp','guest_comp','phone_claim','transfer','web_member_purchase'));

CREATE TABLE public.web_member_purchase_receipt_intents (
 cart_id uuid PRIMARY KEY,
 order_id uuid NOT NULL UNIQUE,
 payment_intent_id text NOT NULL UNIQUE,
 buyer_id text NOT NULL,
 event_id integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz
);
ALTER TABLE public.web_member_purchase_receipt_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.web_member_purchase_receipt_intents FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX web_member_purchase_receipt_pending
 ON public.web_member_purchase_receipt_intents(created_at,cart_id) WHERE processed_at IS NULL;

CREATE FUNCTION public.mark_v1_web_member_purchase_receipt(
 p_cart_id uuid,p_payment_intent_id text,p_buyer_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c carts%ROWTYPE; o orders%ROWTYPE;
BEGIN
 SELECT * INTO c FROM public.carts WHERE id=p_cart_id FOR UPDATE;
 IF NOT FOUND OR c.user_id IS DISTINCT FROM p_buyer_id
    OR c.stripe_pi_id IS DISTINCT FROM p_payment_intent_id
    OR p_buyer_id IS NULL OR p_payment_intent_id IS NULL OR c.status IS DISTINCT FROM 'paying' THEN RETURN false; END IF;
 SELECT * INTO o FROM public.orders WHERE cart_id=c.id FOR UPDATE;
 IF NOT FOUND OR o.user_id IS DISTINCT FROM c.user_id OR o.event_id IS DISTINCT FROM c.event_id
    OR o.stripe_payment_intent_id IS DISTINCT FROM c.stripe_pi_id
    OR o.type IS DISTINCT FROM 'event_ticket' OR o.status IS DISTINCT FROM 'payment_pending'
    OR o.guest_email IS NOT NULL OR o.refunded_at IS NOT NULL THEN RETURN false; END IF;
 INSERT INTO public.web_member_purchase_receipt_intents(cart_id,order_id,payment_intent_id,buyer_id,event_id)
 VALUES(c.id,o.id,c.stripe_pi_id,c.user_id,c.event_id)
 ON CONFLICT(cart_id) DO NOTHING;
 RETURN EXISTS(SELECT 1 FROM public.web_member_purchase_receipt_intents i
 WHERE i.cart_id=c.id AND i.order_id=o.id AND i.payment_intent_id=c.stripe_pi_id
   AND i.buyer_id=c.user_id AND i.event_id=c.event_id);
END $$;

CREATE FUNCTION public.enqueue_v1_web_member_purchase_receipt(p_cart_id uuid,p_payment_intent_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i web_member_purchase_receipt_intents%ROWTYPE; c carts%ROWTYPE; o orders%ROWTYPE;
 v_tickets uuid[]; v_expected bigint; v_receipt uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.web_member_purchase_receipt_intents
    WHERE cart_id=p_cart_id AND payment_intent_id=p_payment_intent_id) THEN RETURN NULL; END IF;
 -- Carts and order locks match the issuance procedure's order.
 SELECT * INTO c FROM public.carts WHERE id=p_cart_id FOR UPDATE;
 IF NOT FOUND OR c.status IS DISTINCT FROM 'completed' OR c.stripe_pi_id IS DISTINCT FROM p_payment_intent_id THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.orders WHERE cart_id=c.id FOR UPDATE;
 IF NOT FOUND OR o.status IS DISTINCT FROM 'paid' OR o.paid_at IS NULL OR o.refunded_at IS NOT NULL THEN RETURN NULL; END IF;
 SELECT * INTO i FROM public.web_member_purchase_receipt_intents
 WHERE cart_id=c.id AND payment_intent_id=p_payment_intent_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF i.processed_at IS NOT NULL THEN
   SELECT id INTO v_receipt FROM public.ticket_receipt_outbox
    WHERE source_kind='web_member_purchase' AND source_id=i.order_id::text;
   RETURN v_receipt;
 END IF;
 IF i.order_id IS DISTINCT FROM o.id OR c.user_id IS DISTINCT FROM i.buyer_id
    OR o.user_id IS DISTINCT FROM i.buyer_id OR i.event_id IS DISTINCT FROM c.event_id
    OR o.event_id IS DISTINCT FROM i.event_id OR o.stripe_payment_intent_id IS DISTINCT FROM i.payment_intent_id
    OR o.type IS DISTINCT FROM 'event_ticket' OR o.guest_email IS NOT NULL
    OR o.total_cents IS DISTINCT FROM c.total_cents OR coalesce(o.total_cents,0)<=0 THEN RETURN NULL; END IF;
 -- Never substitute caller-supplied tickets, add-ons, another PI, or another owner.
 SELECT coalesce(sum(quantity),0) INTO v_expected FROM public.cart_line_items
 WHERE cart_id=c.id AND tier_id IS NOT NULL;
 IF NOT EXISTS(SELECT 1 FROM public.cart_line_items WHERE cart_id=c.id AND refunded_amount_cents>0)
 AND v_expected BETWEEN 1 AND 100 THEN
   PERFORM t.id FROM public.tickets t WHERE t.cart_id=c.id AND t.order_id=o.id ORDER BY t.id FOR SHARE;
   SELECT array_agg(t.id ORDER BY t.id) INTO v_tickets FROM public.tickets t
   JOIN public.cart_line_items l ON l.id=t.cart_line_item_id AND l.cart_id=c.id AND l.tier_id=t.ticket_type_id
   WHERE t.cart_id=c.id AND t.order_id=o.id AND t.stripe_payment_intent_id=i.payment_intent_id
     AND t.event_id=i.event_id AND t.user_id=i.buyer_id AND t.status IN ('active','scanned');
   IF cardinality(v_tickets)=v_expected AND NOT EXISTS(
     SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=c.id AND l.tier_id IS NOT NULL
      AND l.quantity IS DISTINCT FROM (
        SELECT count(*)::integer FROM public.tickets t WHERE t.cart_line_item_id=l.id AND t.id=ANY(v_tickets)
      )
   ) THEN
     v_receipt := public.enqueue_ticket_receipt('web_member_purchase',o.id::text,i.event_id,i.buyer_id,NULL,v_tickets);
   END IF;
 END IF;
 UPDATE public.web_member_purchase_receipt_intents SET processed_at=clock_timestamp() WHERE cart_id=i.cart_id;
 RETURN v_receipt;
END $$;

-- Replay the write only for explicitly marked recent paid carts. This covers
-- a crash after issuance when Stripe replay is unavailable; no historic mail.
CREATE FUNCTION public.recover_v1_web_member_purchase_receipts(p_limit integer DEFAULT 25)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT i.cart_id,i.payment_intent_id
 FROM public.web_member_purchase_receipt_intents i
 JOIN public.carts c ON c.id=i.cart_id AND c.status='completed'
   AND c.stripe_pi_id=i.payment_intent_id AND c.user_id=i.buyer_id AND c.event_id=i.event_id
 JOIN public.orders o ON o.id=i.order_id AND o.cart_id=i.cart_id
   AND o.stripe_payment_intent_id=i.payment_intent_id AND o.user_id=i.buyer_id AND o.event_id=i.event_id
   AND o.type='event_ticket' AND o.guest_email IS NULL AND o.paid_at IS NOT NULL
   AND o.status='paid' AND o.refunded_at IS NULL AND o.total_cents=c.total_cents AND o.total_cents>0
 WHERE i.processed_at IS NULL AND i.created_at>now()-interval '7 days'
 ORDER BY i.created_at,i.cart_id LIMIT greatest(1,least(coalesce(p_limit,25),25))
 LOOP
   PERFORM public.enqueue_v1_web_member_purchase_receipt(r.cart_id,r.payment_intent_id);
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.mark_v1_web_member_purchase_receipt(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_v1_web_member_purchase_receipt(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.recover_v1_web_member_purchase_receipts(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_v1_web_member_purchase_receipt(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_v1_web_member_purchase_receipt(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_v1_web_member_purchase_receipts(integer) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
