-- ════════════════════════════════════════════════════════════════════════
-- cart_complete_issuance: add-ons bound to the buyer's ticket, one QR per unit.
--
-- 1. order_addons.ticket_id was never set, so nothing could follow a ticket:
--    transfer left add-ons with the sender and consolidation (which moves
--    add-ons by ticket_id) skipped them. Rule: an add-on line is bound to an
--    admission ticket issued on the SAME cart, preferring the tier the add-on
--    requires (ticket_addons.requires_tier_id), then the lowest order_index.
--    An add-on-only cart has no such ticket and the purchase stays unbound
--    (ticket_id NULL), owned by user_id / guest_email as before.
--
-- 2. A redeemable line with quantity > 1 got one row and one QR. redeem_addon
--    (20260806300000) is a single-flag CAS: one scan sets status='redeemed'
--    for the whole row, so three drinks were spent on the first scan. The door
--    flow has no unit counter, so issuance now writes one row (quantity 1) and
--    one QR per unit. The edge function sends one prepared QR per unit
--    (_shared/cart-issuance.ts); if it sends fewer (an older deploy), the line
--    falls back to the previous single row so issuance never fails on it.
--    Refund paths already loop over every row of a line
--    (cart_apply_line_refund, refund_order_addons_for_cart).
--
-- Body is 20260922100000 verbatim except the add-on loop. Signature, return
-- contract and stock accounting unchanged. No data is changed: existing rows
-- keep ticket_id NULL.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cart_complete_issuance(p_cart_id uuid, p_payment_intent_id text, p_ticket_rows jsonb, p_addon_rows jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cart public.carts%rowtype;
  v_line record; v_prepared record; v_addon_line record; v_addon_qr record;
  v_order_id uuid; v_order_user text; v_order_guest text;
  v_issued_count integer := 0; v_addon_issued_count integer := 0; v_existing_count integer := 0;
  v_hold_count integer := 0; v_expected_count integer := 0; v_prepared_count integer := 0;
  v_line_prepared_count integer := 0; v_order_index integer := 0;
  v_addon_ticket_id uuid; v_addon_qr_count integer := 0;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;
  IF v_cart.status = 'completed' THEN
    SELECT count(*) INTO v_existing_count FROM public.tickets WHERE cart_id = p_cart_id;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'issuedCount', v_existing_count);
  END IF;
  IF v_cart.status NOT IN ('holding', 'paying') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cart_not_ready', 'status', v_cart.status); END IF;
  IF v_cart.stripe_pi_id IS NOT NULL AND v_cart.stripe_pi_id <> p_payment_intent_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_intent_mismatch'); END IF;
  IF jsonb_typeof(p_ticket_rows) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows'); END IF;

  SELECT coalesce(sum(quantity), 0) INTO v_expected_count
  FROM public.cart_line_items WHERE cart_id = p_cart_id AND tier_id IS NOT NULL;
  SELECT count(*) INTO v_prepared_count
  FROM jsonb_to_recordset(p_ticket_rows) AS p(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text);
  IF v_prepared_count <> v_expected_count THEN
    RETURN jsonb_build_object('ok', false, 'error', 'prepared_ticket_count_mismatch', 'expected', v_expected_count, 'actual', v_prepared_count); END IF;

  SELECT count(*) INTO v_hold_count
  FROM public.cart_holds ch JOIN public.cart_line_items cli ON cli.id = ch.line_item_id
  WHERE ch.cart_id = p_cart_id AND cli.cart_id = p_cart_id AND ch.released = false AND ch.expires_at > now();
  IF v_hold_count <> (SELECT count(*) FROM public.cart_line_items WHERE cart_id = p_cart_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hold_expired'); END IF;

  SELECT id, user_id, guest_email INTO v_order_id, v_order_user, v_order_guest
  FROM public.orders WHERE cart_id = p_cart_id LIMIT 1;

  FOR v_line IN
    SELECT cli.id AS line_item_id, cli.category, cli.tier_id, cli.quantity, cli.unit_price_cents, tt.event_id
    FROM public.cart_line_items cli JOIN public.ticket_types tt ON tt.id = cli.tier_id
    WHERE cli.cart_id = p_cart_id AND cli.tier_id IS NOT NULL
    ORDER BY cli.id FOR UPDATE OF cli, tt
  LOOP
    IF v_line.event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'line_item_event_mismatch', 'lineItemId', v_line.line_item_id); END IF;
    SELECT count(*) INTO v_line_prepared_count
    FROM jsonb_to_recordset(p_ticket_rows) AS p(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text)
    WHERE p.line_item_id = v_line.line_item_id;
    IF v_line_prepared_count <> v_line.quantity THEN
      RETURN jsonb_build_object('ok', false, 'error', 'prepared_line_item_count_mismatch', 'lineItemId', v_line.line_item_id, 'expected', v_line.quantity, 'actual', v_line_prepared_count); END IF;

    FOR v_prepared IN
      SELECT * FROM jsonb_to_recordset(p_ticket_rows) AS p(ticket_id uuid, line_item_id uuid, qr_token text, qr_payload text, attendee_name text)
      WHERE p.line_item_id = v_line.line_item_id
    LOOP
      IF v_prepared.ticket_id IS NULL OR v_prepared.qr_token IS NULL OR length(v_prepared.qr_token) = 0
         OR v_prepared.qr_payload IS NULL OR length(v_prepared.qr_payload) = 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_prepared_ticket', 'lineItemId', v_line.line_item_id); END IF;
      v_order_index := v_order_index + 1;
      INSERT INTO public.tickets (
        id, event_id, ticket_type_id, user_id, status, qr_token, qr_payload,
        stripe_payment_intent_id, purchase_amount_cents, category, cart_id, cart_line_item_id,
        order_index, order_count, attendee_name, order_id
      ) VALUES (
        v_prepared.ticket_id, v_line.event_id, v_line.tier_id, v_cart.user_id, 'active',
        v_prepared.qr_token, v_prepared.qr_payload, p_payment_intent_id, v_line.unit_price_cents,
        v_line.category, p_cart_id, v_line.line_item_id,
        v_order_index, v_expected_count, NULLIF(v_prepared.attendee_name, ''), v_order_id
      );
      v_issued_count := v_issued_count + 1;
    END LOOP;

    UPDATE public.ticket_types SET quantity_sold = coalesce(quantity_sold, 0) + v_line.quantity WHERE id = v_line.tier_id;
  END LOOP;

  FOR v_addon_line IN
    SELECT cli.id AS line_item_id, cli.addon_id, cli.variant_id, cli.quantity, cli.unit_price_cents,
           a.event_id, a.is_redeemable, a.requires_tier_id
    FROM public.cart_line_items cli JOIN public.ticket_addons a ON a.id = cli.addon_id
    WHERE cli.cart_id = p_cart_id AND cli.addon_id IS NOT NULL
    ORDER BY cli.id FOR UPDATE OF cli, a
  LOOP
    -- Bind the purchase to the buyer's admission ticket from this cart, so a
    -- transfer of that ticket can carry it. Prefer a ticket of the tier the
    -- add-on requires, then the first ticket issued. Add-on-only carts
    -- (post-purchase upsell) have no ticket on the cart and stay unbound.
    SELECT t.id INTO v_addon_ticket_id FROM public.tickets t
    WHERE t.cart_id = p_cart_id AND t.category = 'admission'
    ORDER BY (t.ticket_type_id IS NOT DISTINCT FROM v_addon_line.requires_tier_id) DESC,
             t.order_index, t.id
    LIMIT 1;

    SELECT count(*) INTO v_addon_qr_count
    FROM jsonb_to_recordset(p_addon_rows) AS p(line_item_id uuid, qr_token text, qr_payload text)
    WHERE p.line_item_id = v_addon_line.line_item_id
      AND p.qr_token IS NOT NULL AND length(p.qr_token) > 0;

    IF v_addon_line.is_redeemable AND v_addon_line.quantity > 1
       AND v_addon_qr_count = v_addon_line.quantity THEN
      -- Door redeem (redeem_addon) flips a whole row to 'redeemed' on one
      -- scan, so a redeemable line issues one row and one QR per unit.
      FOR v_addon_qr IN
        SELECT * FROM jsonb_to_recordset(p_addon_rows) AS p(line_item_id uuid, qr_token text, qr_payload text)
        WHERE p.line_item_id = v_addon_line.line_item_id
      LOOP
        INSERT INTO public.order_addons (
          order_id, event_id, addon_id, variant_id, ticket_id, cart_id, cart_line_item_id,
          user_id, guest_email, quantity, unit_price_cents, status, qr_token, qr_payload
        ) VALUES (
          v_order_id, v_addon_line.event_id, v_addon_line.addon_id, v_addon_line.variant_id,
          v_addon_ticket_id, p_cart_id, v_addon_line.line_item_id,
          coalesce(v_order_user, v_cart.user_id), v_order_guest,
          1, v_addon_line.unit_price_cents, 'unfulfilled',
          v_addon_qr.qr_token, v_addon_qr.qr_payload );
      END LOOP;
    ELSE
      -- Non-redeemable lines have nothing to scan and stay one row. A caller
      -- that sent one QR for a multi-unit line (edge functions deployed
      -- before this migration) also gets the old single row.
      SELECT * INTO v_addon_qr FROM jsonb_to_recordset(p_addon_rows) AS p(line_item_id uuid, qr_token text, qr_payload text)
      WHERE p.line_item_id = v_addon_line.line_item_id LIMIT 1;
      INSERT INTO public.order_addons (
        order_id, event_id, addon_id, variant_id, ticket_id, cart_id, cart_line_item_id,
        user_id, guest_email, quantity, unit_price_cents, status, qr_token, qr_payload
      ) VALUES (
        v_order_id, v_addon_line.event_id, v_addon_line.addon_id, v_addon_line.variant_id,
        v_addon_ticket_id, p_cart_id, v_addon_line.line_item_id,
        coalesce(v_order_user, v_cart.user_id), v_order_guest,
        v_addon_line.quantity, v_addon_line.unit_price_cents, 'unfulfilled',
        CASE WHEN v_addon_line.is_redeemable THEN v_addon_qr.qr_token ELSE NULL END,
        CASE WHEN v_addon_line.is_redeemable THEN v_addon_qr.qr_payload ELSE NULL END );
    END IF;
    IF v_addon_line.variant_id IS NOT NULL THEN
      UPDATE public.ticket_addon_variants SET quantity_sold = coalesce(quantity_sold, 0) + v_addon_line.quantity WHERE id = v_addon_line.variant_id;
    ELSE
      UPDATE public.ticket_addons SET quantity_sold = coalesce(quantity_sold, 0) + v_addon_line.quantity WHERE id = v_addon_line.addon_id;
    END IF;
    v_addon_issued_count := v_addon_issued_count + 1;
  END LOOP;

  IF v_issued_count = 0 AND v_addon_issued_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_cart'); END IF;

  UPDATE public.cart_holds SET released = true, released_at = now() WHERE cart_id = p_cart_id AND released = false;
  UPDATE public.carts SET status = 'completed', stripe_pi_id = p_payment_intent_id WHERE id = p_cart_id;
  UPDATE public.orders SET status = 'paid', stripe_payment_intent_id = p_payment_intent_id, paid_at = now(), updated_at = now() WHERE cart_id = p_cart_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'issuedCount', v_issued_count, 'addonCount', v_addon_issued_count);
END;
$function$;
