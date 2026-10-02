-- New RPC only: no historical ticket/order rows are changed on application.
-- The existing shared hold RPC locks the tier and counts online + door holds.
CREATE OR REPLACE FUNCTION public.door_free_sale_atomic(
  p_ticket_type_id uuid, p_ticket_rows jsonb, p_order jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_hold jsonb;
  v_order_id uuid;
  v_tickets jsonb;
  v_quantity integer;
BEGIN
  v_order := jsonb_populate_record(NULL::public.orders, p_order);
  v_quantity := jsonb_array_length(p_ticket_rows);
  IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 20
    OR v_order.quantity IS DISTINCT FROM v_quantity
    OR v_order.total_cents IS DISTINCT FROM 0
    OR v_order.subtotal_cents IS DISTINCT FROM 0
    OR v_order.guest_email IS NULL OR v_order.sold_by_staff_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid free door sale';
  END IF;

  SELECT * INTO v_tier FROM public.ticket_types
    WHERE id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND OR v_tier.event_id IS DISTINCT FROM v_order.event_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found');
  END IF;
  v_hold := public.ticket_hold_create_atomic(
    p_ticket_type_id, v_quantity, NULL, NULL, v_order.guest_email, 600, NULL
  );
  IF NOT (v_hold->>'ok')::boolean THEN RETURN v_hold; END IF;

  INSERT INTO public.orders (
    user_id, guest_email, type, status, quantity, currency,
    subtotal_cents, total_cents, event_id, paid_at, sold_by_staff_user_id,
    promo_code_id, discount_cents, promoter_policy_version,
    promoter_original_amount_cents, promoter_customer_discount_bps,
    promoter_discount_amount_cents, promoter_discounted_amount_cents,
    promoter_code, promoter_commission_bps, promoter_commission_amount_cents
  ) VALUES (
    NULL, v_order.guest_email, 'event_ticket', 'paid', v_quantity,
    coalesce(v_order.currency, 'usd'), 0, 0, v_order.event_id, now(),
    v_order.sold_by_staff_user_id, v_order.promo_code_id, v_order.discount_cents,
    v_order.promoter_policy_version, v_order.promoter_original_amount_cents,
    v_order.promoter_customer_discount_bps, v_order.promoter_discount_amount_cents,
    v_order.promoter_discounted_amount_cents, v_order.promoter_code,
    v_order.promoter_commission_bps, 0
  ) RETURNING id INTO v_order_id;

  WITH inserted AS (
    INSERT INTO public.tickets (
      id, event_id, ticket_type_id, user_id, guest_email, guest_name,
      guest_lookup_token, status, qr_token, qr_payload, purchase_amount_cents
    ) SELECT
      t.id, v_order.event_id, p_ticket_type_id, NULL, v_order.guest_email,
      t.guest_name, t.guest_lookup_token, 'active', t.qr_token, t.qr_payload, 0
    FROM jsonb_populate_recordset(NULL::public.tickets, p_ticket_rows) AS t
    RETURNING id, qr_token, guest_lookup_token
  ) SELECT jsonb_agg(to_jsonb(inserted)) INTO v_tickets FROM inserted;

  UPDATE public.ticket_types SET quantity_sold = coalesce(quantity_sold, 0) + v_quantity
    WHERE id = p_ticket_type_id;
  UPDATE public.ticket_holds SET status = 'converted'
    WHERE id = (v_hold->>'holdId')::uuid;
  INSERT INTO public.order_timeline (order_id, type, label) VALUES
    (v_order_id, 'created', 'Order created'),
    (v_order_id, 'payment_captured', 'Free door order — no charge');
  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'tickets', v_tickets);
END;
$$;
REVOKE ALL ON FUNCTION public.door_free_sale_atomic(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.door_free_sale_atomic(uuid, jsonb, jsonb)
  TO service_role;
NOTIFY pgrst, 'reload schema';
