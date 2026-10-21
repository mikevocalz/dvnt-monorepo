-- Source-only rollout: apply this migration before deploying guest-checkout.
-- No historical rows are changed by applying the migration.
-- Only the trusted edge handler may call this RPC; pricing/access validation
-- remains there. One database transaction owns the hold, order, ticket rows,
-- sold count and timeline. A failed statement rolls ALL of them back.
CREATE OR REPLACE FUNCTION public.guest_free_checkout_atomic(
  p_ticket_type_id uuid, p_ticket_rows jsonb, p_order jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing public.orders%ROWTYPE;
  v_tier public.ticket_types%ROWTYPE;
  v_hold jsonb;
  v_quantity integer;
  v_count integer;
  v_actual_sold integer;
  v_sold integer;
  v_held integer;
  v_available integer;
  v_sale_now timestamptz;
BEGIN
  IF jsonb_typeof(p_order) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_ticket_rows) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_order := jsonb_populate_record(NULL::public.orders, p_order);
  v_quantity := jsonb_array_length(p_ticket_rows);
  IF v_quantity < 1 OR v_quantity > 10
     OR v_order.quantity IS DISTINCT FROM v_quantity
     OR v_order.total_cents IS DISTINCT FROM 0
     OR v_order.subtotal_cents IS DISTINCT FROM 0
     OR v_order.event_id IS NULL
     OR NULLIF(btrim(v_order.guest_email), '') IS NULL
     OR length(v_order.guest_email) > 254
     OR v_order.user_id IS NOT NULL
     OR (v_order.idempotency_key IS NOT NULL AND
         (length(v_order.idempotency_key) > 128 OR
          v_order.idempotency_key !~ '^[A-Za-z0-9:_-]+$')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  v_order.guest_email := lower(btrim(v_order.guest_email));

  -- Same keys serialize across tiers too, before taking a tier lock. The
  -- existing unique index remains the final protection against other rails.
  IF v_order.idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'guest_free_checkout:' || v_order.idempotency_key, 0));
    SELECT * INTO v_existing FROM public.orders
      WHERE idempotency_key = v_order.idempotency_key;
    IF FOUND THEN
      IF v_existing.event_id IS DISTINCT FROM v_order.event_id
         OR v_existing.guest_email IS DISTINCT FROM v_order.guest_email
         OR v_existing.quantity IS DISTINCT FROM v_quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
      END IF;
      IF v_existing.status IS DISTINCT FROM 'paid'
         OR v_existing.total_cents IS DISTINCT FROM 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'checkout_processing');
      END IF;
      SELECT count(*) INTO v_count FROM public.tickets WHERE order_id = v_existing.id;
      IF v_count <> v_quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'checkout_processing');
      END IF;
      IF EXISTS (SELECT 1 FROM public.tickets WHERE order_id = v_existing.id
                 AND ticket_type_id IS DISTINCT FROM p_ticket_type_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
      END IF;
      RETURN jsonb_build_object('ok', true, 'idempotent', true,
        'order_id', v_existing.id, 'count', v_count, 'order', to_jsonb(v_existing));
    END IF;
  END IF;

  SELECT * INTO v_tier FROM public.ticket_types
    WHERE id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND OR v_tier.event_id IS DISTINCT FROM v_order.event_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found');
  END IF;
  -- A $0 quote must not issue a tier whose base price changed while the edge
  -- prepared QR payloads. Fully discounted paid tiers retain their exact
  -- server-computed discount snapshot, rather than becoming free by inference.
  IF v_tier.price_cents IS DISTINCT FROM (p_order->>'expected_unit_price_cents')::integer
     OR coalesce(v_order.discount_cents, 0)::bigint <>
        v_tier.price_cents::bigint * v_quantity THEN
    RETURN jsonb_build_object('ok', false, 'error', 'quote_changed');
  END IF;
  -- Recheck the same online-sale policy as tier-sale-availability.ts under
  -- the tier lock. Sample wall time AFTER any wait: transaction-start now()
  -- could keep an already-ended sale open while this transaction was blocked.
  -- Null legacy flags/windows remain valid; explicit non-on_sale states do not.
  v_sale_now := clock_timestamp();
  IF v_tier.is_active IS FALSE OR v_tier.is_sold_out IS TRUE
     OR (v_tier.status IS NOT NULL AND v_tier.status <> 'on_sale')
     OR v_tier.tier_visibility = 'hidden'
     OR NOT isfinite(v_tier.sale_start) OR NOT isfinite(v_tier.sale_end)
     OR v_tier.sale_start >= v_tier.sale_end
     OR v_tier.sale_start > v_sale_now OR v_tier.sale_end <= v_sale_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tier_unavailable');
  END IF;

  -- Serialize the per-email cap with inventory, not just the advisory edge
  -- count. Keep its existing active-ticket semantics.
  IF v_tier.max_per_user > 0 THEN
    SELECT count(*) INTO v_count FROM public.tickets
      WHERE ticket_type_id = p_ticket_type_id AND event_id = v_order.event_id
        AND lower(guest_email) = v_order.guest_email AND status = 'active';
    IF v_count + v_quantity > v_tier.max_per_user THEN
      RETURN jsonb_build_object('ok', false, 'error', 'limit', 'limit', v_tier.max_per_user);
    END IF;
  END IF;

  -- Legacy paid fulfillment still has absolute counter writers. Do not let
  -- their stale counter admit additional free guests: use actual kept tickets
  -- as a floor. An overcount remains conservative; no historic reconciliation
  -- is performed. Active holds may temporarily double-count tickets that a
  -- legacy paid writer has inserted but not converted, which safely fails closed.
  -- Keep both sides of a hold-to-ticket handoff in one coherent snapshot.
  -- The tier's FOR UPDATE lock also blocks fresh paid inserts through the FK;
  -- this paired read is defense in depth, not a substitute for that lock.
  SELECT
    (SELECT count(*) FROM public.tickets
      WHERE ticket_type_id = p_ticket_type_id
        AND status IS DISTINCT FROM 'refunded' AND status IS DISTINCT FROM 'void'),
    (SELECT coalesce(sum(qty), 0) FROM (
      SELECT quantity AS qty FROM public.ticket_holds
        WHERE ticket_type_id = p_ticket_type_id AND status = 'active' AND expires_at > now()
      UNION ALL
      SELECT qty FROM public.cart_holds
        WHERE tier_id = p_ticket_type_id AND released = false AND expires_at > now()
    ) holds)
  INTO v_actual_sold, v_held;
  v_sold := greatest(coalesce(v_tier.quantity_sold, 0), v_actual_sold);
  IF v_tier.quantity_total IS NOT NULL THEN
    v_available := v_tier.quantity_total - v_sold - v_held;
    IF v_available < v_quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'insufficient_inventory',
        'available', greatest(v_available, 0));
    END IF;
  END IF;

  -- Reject invalid prepared QR rows before any writes. The edge signs these;
  -- the RPC fixes all ownership, purchase and grouping fields itself.
  IF EXISTS (SELECT 1 FROM jsonb_populate_recordset(NULL::public.tickets, p_ticket_rows) t
    WHERE t.id IS NULL OR NULLIF(t.qr_token, '') IS NULL
       OR NULLIF(t.qr_payload, '') IS NULL OR NULLIF(t.guest_lookup_token, '') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows');
  END IF;

  v_hold := public.ticket_hold_create_atomic(
    p_ticket_type_id, v_quantity, NULL, NULL, v_order.guest_email, 600, NULL);
  IF NOT coalesce((v_hold->>'ok')::boolean, false) THEN RETURN v_hold; END IF;

  INSERT INTO public.orders (
    user_id, guest_email, type, status, quantity, currency, subtotal_cents,
    total_cents, event_id, paid_at, idempotency_key, promo_code_id, discount_cents,
    promoter_id, promoter_policy_version, promoter_original_amount_cents,
    promoter_customer_discount_bps, promoter_discount_amount_cents,
    promoter_discounted_amount_cents, promoter_code, promoter_commission_bps,
    promoter_commission_amount_cents
  ) VALUES (
    NULL, v_order.guest_email, 'event_ticket', 'paid', v_quantity, 'usd', 0, 0,
    v_order.event_id, now(), v_order.idempotency_key, v_order.promo_code_id,
    v_order.discount_cents, v_order.promoter_id, v_order.promoter_policy_version,
    v_order.promoter_original_amount_cents, v_order.promoter_customer_discount_bps,
    v_order.promoter_discount_amount_cents, v_order.promoter_discounted_amount_cents,
    v_order.promoter_code, v_order.promoter_commission_bps,
    CASE WHEN v_order.promoter_id IS NOT NULL THEN 0 ELSE NULL END
  ) RETURNING * INTO v_order;

  INSERT INTO public.tickets (
    id, event_id, ticket_type_id, user_id, guest_email, guest_name, attendee_name,
    guest_lookup_token, status, qr_token, qr_payload, purchase_amount_cents,
    order_id, order_index, order_count
  ) SELECT t.id, v_order.event_id, p_ticket_type_id, NULL, v_order.guest_email,
    t.guest_name, t.attendee_name, t.guest_lookup_token, 'active', t.qr_token,
    t.qr_payload, 0, v_order.id, r.ordinality::integer, v_quantity
  FROM jsonb_array_elements(p_ticket_rows) WITH ORDINALITY r(value, ordinality)
  CROSS JOIN LATERAL jsonb_populate_record(NULL::public.tickets, r.value) t;

  UPDATE public.ticket_types SET quantity_sold = v_sold + v_quantity
    WHERE id = p_ticket_type_id;
  UPDATE public.ticket_holds SET status = 'converted'
    WHERE id = (v_hold->>'holdId')::uuid;
  INSERT INTO public.order_timeline (order_id, type, label) VALUES
    (v_order.id, 'created', 'Order created'),
    (v_order.id, 'payment_captured', 'Free guest ticket issued');
  RETURN jsonb_build_object('ok', true, 'idempotent', false,
    'order_id', v_order.id, 'count', v_quantity, 'order', to_jsonb(v_order));
END;
$$;
REVOKE ALL ON FUNCTION public.guest_free_checkout_atomic(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_free_checkout_atomic(uuid, jsonb, jsonb)
  TO service_role;
NOTIFY pgrst, 'reload schema';
