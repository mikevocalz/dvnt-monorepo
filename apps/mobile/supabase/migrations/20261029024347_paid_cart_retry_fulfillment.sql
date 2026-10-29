-- A verified successful PaymentIntent may arrive after an earlier failed attempt
-- released its hold. Reacquire inventory at the ORIGINAL paid prices and issue
-- all cart lines in one transaction. Service role only: the edge caller must
-- retrieve Stripe's current succeeded, captured, unrefunded, undisputed payment.
-- This migration defines functions only; it recovers no existing order itself.
BEGIN;
CREATE OR REPLACE FUNCTION public.complete_paid_cart_atomic(
  p_cart_id uuid, p_payment_intent_id text, p_amount_received integer,
  p_currency text, p_user_id text, p_event_id integer,
  p_ticket_rows jsonb, p_addon_rows jsonb, p_event_created_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cart public.carts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_line record;
  v_result jsonb;
  v_available bigint;
  v_quantity bigint;
  v_error text;
  v_event_status text;
BEGIN
  IF p_payment_intent_id IS NULL OR btrim(p_payment_intent_id) = ''
     OR p_user_id IS NULL OR btrim(p_user_id) = '' OR p_event_id IS NULL
     OR p_amount_received IS NULL OR p_amount_received <= 0
     OR p_currency IS NULL OR p_currency !~ '^[a-z]{3}$'
     OR jsonb_typeof(p_ticket_rows) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_addon_rows) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_paid_cart_request');
  END IF;
  -- Same order as hold creation and release: cart, then its order, inventory.
  SELECT * INTO v_cart FROM public.carts WHERE id=p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','cart_not_found'); END IF;
  IF v_cart.stripe_pi_id IS DISTINCT FROM p_payment_intent_id THEN
    RETURN jsonb_build_object('ok',false,'error','payment_intent_mismatch'); END IF;
  IF v_cart.user_id IS DISTINCT FROM p_user_id OR v_cart.event_id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object('ok',false,'error','payment_identity_mismatch'); END IF;
  IF v_cart.total_cents IS DISTINCT FROM p_amount_received OR v_cart.currency IS DISTINCT FROM p_currency THEN
    RETURN jsonb_build_object('ok',false,'error','payment_amount_mismatch'); END IF;
  SELECT * INTO v_order FROM public.orders WHERE cart_id=p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','order_not_found'); END IF;
  IF v_order.user_id IS DISTINCT FROM p_user_id OR v_order.event_id IS DISTINCT FROM p_event_id
     OR v_order.stripe_payment_intent_id IS DISTINCT FROM p_payment_intent_id
     OR v_order.total_cents IS DISTINCT FROM p_amount_received OR v_order.currency IS DISTINCT FROM p_currency THEN
    RETURN jsonb_build_object('ok',false,'error','order_payment_mismatch'); END IF;
  PERFORM id FROM public.cart_line_items WHERE cart_id=p_cart_id ORDER BY id FOR UPDATE;
  IF (SELECT coalesce(sum(quantity),0) FROM public.cart_line_items WHERE cart_id=p_cart_id)
     IS DISTINCT FROM v_order.quantity::bigint THEN
    RETURN jsonb_build_object('ok',false,'error','paid_cart_quantity_mismatch'); END IF;
  IF v_order.type IS DISTINCT FROM 'event_ticket' OR v_order.status IS NULL
     OR v_order.refunded_at IS NOT NULL OR v_order.status NOT IN ('payment_pending','payment_failed','paid') THEN
    RETURN jsonb_build_object('ok',false,'error','order_not_recoverable'); END IF;
  IF EXISTS (SELECT 1 FROM public.cart_line_items WHERE cart_id=p_cart_id AND refunded_amount_cents > 0) THEN
    RETURN jsonb_build_object('ok',false,'error','order_not_recoverable'); END IF;
  IF v_cart.status='completed' AND v_order.status='paid' THEN
    -- A completed flag alone does not prove all lines were fulfilled. Count
    -- original line units across all lifecycle states (transfers are valid).
    IF NOT EXISTS (SELECT 1 FROM public.cart_line_items WHERE cart_id=p_cart_id)
       OR EXISTS (SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=p_cart_id AND (
         ((l.tier_id IS NULL) = (l.addon_id IS NULL))
         OR (l.tier_id IS NOT NULL AND l.quantity<>(SELECT count(*) FROM public.tickets t
           WHERE t.cart_id=p_cart_id AND t.cart_line_item_id=l.id))
         OR (l.addon_id IS NOT NULL AND l.quantity<>coalesce((SELECT sum(a.quantity) FROM public.order_addons a
           WHERE a.cart_id=p_cart_id AND a.cart_line_item_id=l.id),0))))
       OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.cart_id=p_cart_id AND NOT EXISTS (
         SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=p_cart_id AND l.id=t.cart_line_item_id
           AND l.tier_id=t.ticket_type_id))
       OR EXISTS (SELECT 1 FROM public.order_addons a WHERE a.cart_id=p_cart_id AND NOT EXISTS (
         SELECT 1 FROM public.cart_line_items l WHERE l.cart_id=p_cart_id AND l.id=a.cart_line_item_id
           AND l.addon_id=a.addon_id AND l.variant_id IS NOT DISTINCT FROM a.variant_id)) THEN
      RETURN jsonb_build_object('ok',false,'error','partial_cart_allocation');
    END IF;
    RETURN jsonb_build_object('ok',true,'duplicate',true,
      'issuedCount',(SELECT count(*) FROM public.tickets WHERE cart_id=p_cart_id),
      'addonCount',(SELECT count(DISTINCT cart_line_item_id) FROM public.order_addons WHERE cart_id=p_cart_id));
  END IF;
  IF v_cart.status NOT IN ('holding','paying','abandoned') OR v_order.status NOT IN ('payment_pending','payment_failed') THEN
    RETURN jsonb_build_object('ok',false,'error','order_not_recoverable'); END IF;
  -- Never fill in an unknown partial historical allocation or resurrect rows.
  IF EXISTS (SELECT 1 FROM public.tickets WHERE cart_id=p_cart_id OR order_id=v_order.id OR stripe_payment_intent_id=p_payment_intent_id)
     OR EXISTS (SELECT 1 FROM public.order_addons WHERE cart_id=p_cart_id OR order_id=v_order.id) THEN
    RETURN jsonb_build_object('ok',false,'error','partial_cart_allocation'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id=p_event_id AND status NOT IN ('cancelled','deleted')) THEN
    RETURN jsonb_build_object('ok',false,'error','event_unavailable'); END IF;

  -- Lock every inventory row in deterministic order before checking any stock.
  -- Original pricing and prior tier unlocks remain intact: this is fulfillment
  -- of a paid cart, not a new checkout and not cart_create_hold's repricing.
  PERFORM t.id FROM public.ticket_types t WHERE t.id IN
    (SELECT tier_id FROM public.cart_line_items WHERE cart_id=p_cart_id) ORDER BY t.id FOR UPDATE;
  PERFORM a.id FROM public.ticket_addons a WHERE a.id IN
    (SELECT addon_id FROM public.cart_line_items WHERE cart_id=p_cart_id) ORDER BY a.id FOR UPDATE;
  PERFORM v.id FROM public.ticket_addon_variants v WHERE v.id IN
    (SELECT variant_id FROM public.cart_line_items WHERE cart_id=p_cart_id) ORDER BY v.id FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.cart_line_items WHERE cart_id=p_cart_id) THEN
    RETURN jsonb_build_object('ok',false,'error','empty_cart'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_ticket_rows)
    AS r(ticket_id uuid,line_item_id uuid,qr_token text,qr_payload text)
    WHERE r.ticket_id IS NULL OR coalesce(r.qr_token,'')='' OR coalesce(r.qr_payload,'')=''
      OR NOT EXISTS (SELECT 1 FROM public.cart_line_items l
        WHERE l.cart_id=p_cart_id AND l.id=r.line_item_id AND l.tier_id IS NOT NULL)) THEN
    RETURN jsonb_build_object('ok',false,'error','invalid_prepared_ticket'); END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_addon_rows) AS r(line_item_id uuid,qr_token text,qr_payload text)
    WHERE NOT EXISTS (SELECT 1 FROM public.cart_line_items l JOIN public.ticket_addons a ON a.id=l.addon_id
      WHERE l.cart_id=p_cart_id AND l.id=r.line_item_id AND a.is_redeemable)) THEN
    RETURN jsonb_build_object('ok',false,'error','prepared_addon_count_mismatch'); END IF;
  FOR v_line IN SELECT l.*,t.event_id AS tier_event,t.currency AS tier_currency,
      a.event_id AS addon_event,a.currency AS addon_currency,a.requires_tier_id,a.is_redeemable,
      v.addon_id AS variant_parent
    FROM public.cart_line_items l LEFT JOIN public.ticket_types t ON t.id=l.tier_id
    LEFT JOIN public.ticket_addons a ON a.id=l.addon_id
    LEFT JOIN public.ticket_addon_variants v ON v.id=l.variant_id WHERE l.cart_id=p_cart_id
  LOOP
    IF v_line.quantity IS NULL OR v_line.quantity <= 0 OR v_line.unit_price_cents < 0
       OR (v_line.tier_id IS NULL) = (v_line.addon_id IS NULL)
       OR (v_line.tier_id IS NOT NULL AND (v_line.tier_event IS DISTINCT FROM p_event_id OR v_line.tier_currency IS DISTINCT FROM p_currency))
       OR (v_line.addon_id IS NOT NULL AND (v_line.addon_event IS DISTINCT FROM p_event_id OR coalesce(v_line.addon_currency,p_currency) IS DISTINCT FROM p_currency))
       OR (v_line.variant_id IS NOT NULL AND v_line.variant_parent IS DISTINCT FROM v_line.addon_id) THEN
      RETURN jsonb_build_object('ok',false,'error','invalid_paid_cart_line'); END IF;
    IF v_line.requires_tier_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cart_line_items WHERE cart_id=p_cart_id AND tier_id=v_line.requires_tier_id)
       AND NOT EXISTS (SELECT 1 FROM public.tickets WHERE user_id=p_user_id AND event_id=p_event_id
         AND ticket_type_id=v_line.requires_tier_id AND status IN ('active','scanned')) THEN
      RETURN jsonb_build_object('ok',false,'error','addon_requires_tier'); END IF;
    -- Do not fall back to the legacy multi-unit/single-QR representation.
    IF v_line.addon_id IS NOT NULL AND v_line.is_redeemable THEN
      SELECT count(*) INTO v_quantity FROM jsonb_to_recordset(p_addon_rows)
        AS r(line_item_id uuid,qr_token text,qr_payload text)
        WHERE r.line_item_id=v_line.id AND coalesce(r.qr_token,'')<>'' AND coalesce(r.qr_payload,'')<>'';
      IF v_quantity <> v_line.quantity
         OR (SELECT count(*) FROM jsonb_to_recordset(p_addon_rows) AS r(line_item_id uuid)
           WHERE r.line_item_id=v_line.id) <> v_line.quantity
         OR (SELECT count(DISTINCT r.qr_token) FROM jsonb_to_recordset(p_addon_rows) AS r(line_item_id uuid,qr_token text)
           WHERE r.line_item_id=v_line.id) <> v_line.quantity THEN
        RETURN jsonb_build_object('ok',false,'error','prepared_addon_count_mismatch'); END IF;
    END IF;
  END LOOP;
  FOR v_line IN SELECT t.*,sum(l.quantity) AS requested FROM public.cart_line_items l
    JOIN public.ticket_types t ON t.id=l.tier_id WHERE l.cart_id=p_cart_id GROUP BY t.id
  LOOP
    IF v_line.quantity_total IS NOT NULL THEN
      SELECT v_line.quantity_total-greatest(coalesce(v_line.quantity_sold,0),
        (SELECT count(*) FROM public.tickets WHERE ticket_type_id=v_line.id AND status IS DISTINCT FROM 'refunded' AND status IS DISTINCT FROM 'void'))
        -coalesce((SELECT sum(qty) FROM public.cart_holds WHERE tier_id=v_line.id AND cart_id<>p_cart_id
          AND NOT released AND expires_at>clock_timestamp()),0)
        -coalesce((SELECT sum(quantity) FROM public.ticket_holds WHERE ticket_type_id=v_line.id
          AND status='active' AND expires_at>clock_timestamp()),0) INTO v_available;
      IF v_available < v_line.requested THEN
        RETURN jsonb_build_object('ok',false,'error','insufficient_capacity','available',greatest(v_available,0)); END IF;
    END IF;
  END LOOP;
  FOR v_line IN SELECT a.*,sum(l.quantity) AS requested FROM public.cart_line_items l
    JOIN public.ticket_addons a ON a.id=l.addon_id WHERE l.cart_id=p_cart_id GROUP BY a.id
  LOOP
    IF v_line.quantity_total IS NOT NULL THEN
      SELECT v_line.quantity_total-coalesce(v_line.quantity_sold,0)-coalesce(v_line.quantity_held,0)
        -coalesce((SELECT sum(coalesce(quantity_sold,0)+coalesce(quantity_held,0)) FROM public.ticket_addon_variants WHERE addon_id=v_line.id),0)
        -coalesce((SELECT sum(qty) FROM public.cart_holds WHERE addon_id=v_line.id AND cart_id<>p_cart_id
          AND NOT released AND expires_at>clock_timestamp()),0) INTO v_available;
      IF v_available < v_line.requested THEN
        RETURN jsonb_build_object('ok',false,'error','addon_insufficient_capacity','available',greatest(v_available,0)); END IF;
    END IF;
  END LOOP;
  FOR v_line IN SELECT v.*,sum(l.quantity) AS requested FROM public.cart_line_items l
    JOIN public.ticket_addon_variants v ON v.id=l.variant_id WHERE l.cart_id=p_cart_id GROUP BY v.id
  LOOP
    IF v_line.quantity_total IS NOT NULL THEN
      SELECT v_line.quantity_total-coalesce(v_line.quantity_sold,0)-coalesce(v_line.quantity_held,0)
        -coalesce((SELECT sum(qty) FROM public.cart_holds WHERE variant_id=v_line.id AND cart_id<>p_cart_id
          AND NOT released AND expires_at>clock_timestamp()),0) INTO v_available;
      IF v_available < v_line.requested THEN
        RETURN jsonb_build_object('ok',false,'error','addon_insufficient_capacity','available',greatest(v_available,0)); END IF;
    END IF;
  END LOOP;

  -- Subtransaction is intentional: the legacy allocator may RETURN ok=false
  -- after writing an earlier line. Roll back its writes AND rearmed holds.
  BEGIN
    -- Cancellation may have won while inventory locks were waiting. Acquire
    -- the event last, without waiting: event/financial triggers can otherwise
    -- invert event->inventory ordering and deadlock competing transactions.
    SELECT status INTO v_event_status FROM public.events WHERE id=p_event_id FOR UPDATE NOWAIT;
    IF NOT FOUND OR v_event_status IS NULL OR v_event_status IN ('cancelled','deleted') THEN
      RETURN jsonb_build_object('ok',false,'error','event_unavailable'); END IF;
    UPDATE public.cart_holds SET released=true,released_at=clock_timestamp() WHERE cart_id=p_cart_id AND NOT released;
    INSERT INTO public.cart_holds(cart_id,line_item_id,tier_id,addon_id,variant_id,qty,expires_at)
      SELECT p_cart_id,id,tier_id,addon_id,variant_id,quantity,clock_timestamp()+interval '5 minutes'
      FROM public.cart_line_items WHERE cart_id=p_cart_id;
    UPDATE public.carts SET status='paying' WHERE id=p_cart_id;
    v_result := public.cart_complete_issuance(p_cart_id,p_payment_intent_id,p_ticket_rows,p_addon_rows);
    IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='paid_cart_allocation_rejected';
    END IF;
    UPDATE public.orders SET checkout_failure_reason=NULL,checkout_failure_code=NULL,
      last_event_at=CASE WHEN p_event_created_at IS NULL THEN last_event_at
      ELSE greatest(last_event_at,p_event_created_at) END WHERE id=v_order.id;
  EXCEPTION WHEN lock_not_available THEN
    RETURN jsonb_build_object('ok',false,'error','event_busy');
  WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
    IF v_error='paid_cart_allocation_rejected' THEN RETURN v_result; END IF;
    RAISE;
  END;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_paid_cart_atomic(uuid,text,integer,text,text,integer,jsonb,jsonb,timestamptz) TO service_role;

-- Explicit release races with fulfillment using the same cart-first lock.
-- A release arriving after completion must not undo the completed allocation.
CREATE OR REPLACE FUNCTION public.cart_release_hold(p_cart_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_status text; v_released_count integer;
BEGIN
  SELECT status INTO v_status FROM public.carts WHERE id=p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','cart_not_found'); END IF;
  IF v_status='completed' THEN RETURN jsonb_build_object('ok',true,'releasedCount',0); END IF;
  UPDATE public.cart_holds SET released=true,released_at=now() WHERE cart_id=p_cart_id AND NOT released;
  GET DIAGNOSTICS v_released_count=ROW_COUNT;
  UPDATE public.carts SET status='abandoned' WHERE id=p_cart_id AND status IN ('draft','holding','paying');
  RETURN jsonb_build_object('ok',true,'releasedCount',v_released_count);
END;
$$;
REVOKE ALL ON FUNCTION public.cart_release_hold(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cart_release_hold(uuid) TO service_role;
-- Only known paid-but-unissued failures enter the historical recovery queue.
-- The edge worker must still verify current Stripe state before any mutation.
CREATE OR REPLACE FUNCTION public.list_paid_cart_recovery_candidates(
  p_created_before timestamptz, p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(candidate)),'[]'::jsonb) FROM (
    SELECT o.id,o.stripe_payment_intent_id,o.stripe_checkout_session_id,o.created_at
    FROM public.orders o WHERE o.status='payment_failed' AND o.cart_id IS NOT NULL
      AND o.stripe_payment_intent_id IS NOT NULL AND o.refunded_at IS NULL
      AND o.created_at<p_created_before
      AND EXISTS (SELECT 1 FROM public.order_timeline t WHERE t.order_id=o.id AND t.type='reconcile_blocked')
    ORDER BY o.updated_at,o.id LIMIT greatest(1,least(coalesce(p_limit,50),50))
  ) candidate;
$$;
REVOKE ALL ON FUNCTION public.list_paid_cart_recovery_candidates(timestamptz,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_paid_cart_recovery_candidates(timestamptz,integer) TO service_role;

COMMIT;
NOTIFY pgrst,'reload schema';
