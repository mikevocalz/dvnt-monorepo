-- ════════════════════════════════════════════════════════════════════════
-- Extend cart fulfilment to issue ADD-ONS alongside tickets (base RPC:
-- 20260516150000 public.cart_complete_issuance). Money path — replay-safe.
--
-- Changes vs base:
--   • new OPTIONAL p_addon_rows jsonb DEFAULT '[]' (3-arg callers still work);
--   • prepared-ticket-count is now compared against TICKET lines only
--     (tier_id IS NOT NULL) — add-on lines are not issued from p_ticket_rows;
--   • new add-on loop: inserts one order_addons row per add-on line, sets a
--     QR for redeemable add-ons (from p_addon_rows), increments add-on/variant
--     quantity_sold under FOR UPDATE;
--   • completes carts that contain only add-ons (standalone merch);
--   • idempotency unchanged: cart.status='completed' short-circuits.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cart_complete_issuance(
  p_cart_id uuid,
  p_payment_intent_id text,
  p_ticket_rows jsonb,
  p_addon_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart public.carts%rowtype;
  v_line record;
  v_prepared record;
  v_addon_line record;
  v_addon_qr record;
  v_order_id uuid;
  v_order_user text;
  v_order_guest text;
  v_issued_count integer := 0;
  v_addon_issued_count integer := 0;
  v_existing_count integer := 0;
  v_hold_count integer := 0;
  v_expected_count integer := 0;
  v_prepared_count integer := 0;
  v_line_prepared_count integer := 0;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;

  -- idempotent replay: already fulfilled → return prior ticket count
  IF v_cart.status = 'completed' THEN
    SELECT count(*) INTO v_existing_count FROM public.tickets WHERE cart_id = p_cart_id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'issuedCount', v_existing_count);
  END IF;

  IF v_cart.status NOT IN ('holding', 'paying') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cart_not_ready', 'status', v_cart.status);
  END IF;
  IF v_cart.stripe_pi_id IS NOT NULL AND v_cart.stripe_pi_id <> p_payment_intent_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch');
  END IF;
  IF jsonb_typeof(p_ticket_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows');
  END IF;

  -- expected TICKET count (tier lines only; add-ons fulfilled separately)
  SELECT coalesce(sum(quantity), 0) INTO v_expected_count
  FROM public.cart_line_items WHERE cart_id = p_cart_id AND tier_id IS NOT NULL;

  SELECT count(*) INTO v_prepared_count
  FROM jsonb_to_recordset(p_ticket_rows) AS prepared(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text);

  IF v_prepared_count <> v_expected_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prepared_ticket_count_mismatch',
      'expected', v_expected_count, 'actual', v_prepared_count);
  END IF;

  -- every line (ticket AND add-on) must still hold valid, unexpired inventory
  SELECT count(*) INTO v_hold_count
  FROM public.cart_holds ch
  JOIN public.cart_line_items cli ON cli.id = ch.line_item_id
  WHERE ch.cart_id = p_cart_id AND cli.cart_id = p_cart_id AND ch.released = false AND ch.expires_at > now();

  IF v_hold_count <> (SELECT count(*) FROM public.cart_line_items WHERE cart_id = p_cart_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_expired');
  END IF;

  -- resolve the order for this cart (for order_addons linkage + owner)
  SELECT id, user_id, guest_email INTO v_order_id, v_order_user, v_order_guest
  FROM public.orders WHERE cart_id = p_cart_id LIMIT 1;

  -- ── TICKET lines → tickets ────────────────────────────────────────────────
  FOR v_line IN
    SELECT cli.id AS line_item_id, cli.category, cli.tier_id, cli.quantity,
           cli.unit_price_cents, tt.event_id
    FROM public.cart_line_items cli
    JOIN public.ticket_types tt ON tt.id = cli.tier_id
    WHERE cli.cart_id = p_cart_id AND cli.tier_id IS NOT NULL
    ORDER BY cli.id
    FOR UPDATE OF cli, tt
  LOOP
    IF v_line.event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'line_item_event_mismatch', 'lineItemId', v_line.line_item_id);
    END IF;

    SELECT count(*) INTO v_line_prepared_count
    FROM jsonb_to_recordset(p_ticket_rows) AS prepared(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text)
    WHERE prepared.line_item_id = v_line.line_item_id;

    IF v_line_prepared_count <> v_line.quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'prepared_line_item_count_mismatch',
        'lineItemId', v_line.line_item_id, 'expected', v_line.quantity, 'actual', v_line_prepared_count);
    END IF;

    FOR v_prepared IN
      SELECT * FROM jsonb_to_recordset(p_ticket_rows) AS prepared(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text)
      WHERE prepared.line_item_id = v_line.line_item_id
    LOOP
      IF v_prepared.ticket_id IS NULL OR v_prepared.qr_token IS NULL OR length(v_prepared.qr_token) = 0
         OR v_prepared.qr_payload IS NULL OR length(v_prepared.qr_payload) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_prepared_ticket', 'lineItemId', v_line.line_item_id);
      END IF;

      INSERT INTO public.tickets (
        id, event_id, ticket_type_id, user_id, status, qr_token, qr_payload,
        stripe_payment_intent_id, purchase_amount_cents, category, cart_id, cart_line_item_id
      ) VALUES (
        v_prepared.ticket_id, v_line.event_id, v_line.tier_id, v_cart.user_id, 'active',
        v_prepared.qr_token, v_prepared.qr_payload, p_payment_intent_id, v_line.unit_price_cents,
        v_line.category, p_cart_id, v_line.line_item_id
      );
      v_issued_count := v_issued_count + 1;
    END LOOP;

    UPDATE public.ticket_types
    SET quantity_sold = coalesce(quantity_sold, 0) + v_line.quantity
    WHERE id = v_line.tier_id;
  END LOOP;

  -- ── ADD-ON lines → order_addons (one row per line; QR for redeemable) ─────
  FOR v_addon_line IN
    SELECT cli.id AS line_item_id, cli.addon_id, cli.variant_id, cli.quantity, cli.unit_price_cents,
           a.event_id, a.is_redeemable
    FROM public.cart_line_items cli
    JOIN public.ticket_addons a ON a.id = cli.addon_id
    WHERE cli.cart_id = p_cart_id AND cli.addon_id IS NOT NULL
    ORDER BY cli.id
    FOR UPDATE OF cli, a
  LOOP
    -- prepared QR for this add-on line (only meaningful for redeemable items)
    SELECT * INTO v_addon_qr
    FROM jsonb_to_recordset(p_addon_rows) AS prepared(line_item_id uuid, qr_token text, qr_payload text)
    WHERE prepared.line_item_id = v_addon_line.line_item_id
    LIMIT 1;

    INSERT INTO public.order_addons (
      order_id, event_id, addon_id, variant_id, cart_id, cart_line_item_id,
      user_id, guest_email, quantity, unit_price_cents, status, qr_token, qr_payload
    ) VALUES (
      v_order_id, v_addon_line.event_id, v_addon_line.addon_id, v_addon_line.variant_id,
      p_cart_id, v_addon_line.line_item_id,
      coalesce(v_order_user, v_cart.user_id), v_order_guest,
      v_addon_line.quantity, v_addon_line.unit_price_cents, 'unfulfilled',
      CASE WHEN v_addon_line.is_redeemable THEN v_addon_qr.qr_token ELSE NULL END,
      CASE WHEN v_addon_line.is_redeemable THEN v_addon_qr.qr_payload ELSE NULL END
    );

    -- increment sold on the variant (if any) else the add-on
    IF v_addon_line.variant_id IS NOT NULL THEN
      UPDATE public.ticket_addon_variants
      SET quantity_sold = coalesce(quantity_sold, 0) + v_addon_line.quantity
      WHERE id = v_addon_line.variant_id;
    ELSE
      UPDATE public.ticket_addons
      SET quantity_sold = coalesce(quantity_sold, 0) + v_addon_line.quantity
      WHERE id = v_addon_line.addon_id;
    END IF;

    v_addon_issued_count := v_addon_issued_count + 1;
  END LOOP;

  IF v_issued_count = 0 AND v_addon_issued_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_cart');
  END IF;

  UPDATE public.cart_holds SET released = true, released_at = now()
  WHERE cart_id = p_cart_id AND released = false;

  UPDATE public.carts SET status = 'completed', stripe_pi_id = p_payment_intent_id WHERE id = p_cart_id;

  UPDATE public.orders
  SET status = 'paid', stripe_payment_intent_id = p_payment_intent_id, paid_at = now(), updated_at = now()
  WHERE cart_id = p_cart_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
    'issuedCount', v_issued_count, 'addonCount', v_addon_issued_count);
END;
$$;

-- grants for the new 4-arg signature (3-arg variant remains from base migration)
REVOKE ALL ON FUNCTION public.cart_complete_issuance(uuid, text, jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.cart_complete_issuance(uuid, text, jsonb, jsonb) TO service_role;
