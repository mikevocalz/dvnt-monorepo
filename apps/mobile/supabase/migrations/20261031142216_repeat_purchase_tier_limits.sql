-- Source-only release. No historical ticket, order or inventory rows are changed.
-- Apply before deploying the matching free-checkout adapters. Online service
-- purchases remain separate credentials; a prior ticket never closes checkout.
BEGIN;

-- Caller already holds the ticket_types row lock. Count the same buyer's live
-- credentials AND pending allocations across both checkout rails. A cap is per
-- tier, not per event: buying coat check must not consume an admission allowance.
CREATE OR REPLACE FUNCTION public.ticket_buyer_reserved_quantity(
  p_ticket_type_id uuid, p_user_id text, p_guest_email text, p_exclude_cart_id uuid DEFAULT NULL
) RETURNS bigint LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  WITH owner_ids AS (
    SELECT p_user_id AS id
    UNION SELECT u.id::text FROM public.users u WHERE u.auth_id = p_user_id
  )
  SELECT
    (SELECT count(*) FROM public.tickets t
      WHERE t.ticket_type_id = p_ticket_type_id
        AND t.status IN ('active', 'scanned', 'transfer_pending')
        AND CASE WHEN nullif(btrim(p_user_id), '') IS NOT NULL THEN t.user_id IN (SELECT id FROM owner_ids)
          ELSE t.user_id IS NULL AND lower(btrim(t.guest_email)) = lower(btrim(p_guest_email)) END)
    + (SELECT coalesce(sum(h.quantity), 0) FROM public.ticket_holds h
      WHERE h.ticket_type_id = p_ticket_type_id AND h.status = 'active'
        AND h.expires_at > clock_timestamp()
        AND CASE WHEN nullif(btrim(p_user_id), '') IS NOT NULL THEN h.user_id IN (SELECT id FROM owner_ids)
          ELSE h.user_id IS NULL AND lower(btrim(h.guest_email)) = lower(btrim(p_guest_email)) END)
    + (SELECT coalesce(sum(h.qty), 0) FROM public.cart_holds h
      JOIN public.carts c ON c.id = h.cart_id
      WHERE h.tier_id = p_ticket_type_id AND h.released = false
        AND h.expires_at > clock_timestamp() AND c.user_id IN (SELECT id FROM owner_ids)
        AND h.cart_id IS DISTINCT FROM p_exclude_cart_id);
$$;
REVOKE ALL ON FUNCTION public.ticket_buyer_reserved_quantity(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_buyer_reserved_quantity(uuid, text, text, uuid) TO service_role;

-- New credentials inherit the catalog's authoritative category on every rail,
-- including old edge versions and cart client metadata. Never reclassify an
-- existing ticket; admission/access code must not infer admission from a service.
CREATE OR REPLACE FUNCTION public.stamp_new_ticket_category()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
DECLARE v_category text;
BEGIN
  IF NEW.ticket_type_id IS NOT NULL THEN
    SELECT category INTO v_category FROM public.ticket_types WHERE id = NEW.ticket_type_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ticket_type_not_found' USING ERRCODE = '23503'; END IF;
    NEW.category := coalesce(v_category, 'admission');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_new_ticket_category() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stamp_new_ticket_category() TO service_role;
DROP TRIGGER IF EXISTS stamp_new_ticket_category ON public.tickets;
CREATE TRIGGER stamp_new_ticket_category BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.stamp_new_ticket_category();

-- Online purchase reservation wraps the shared inventory allocator rather than
-- changing door-sale ownership: legacy paid door holds belong to the seller,
-- not the guest. Only the online handlers call this buyer-cap-aware entrypoint.
CREATE OR REPLACE FUNCTION public.ticket_purchase_hold_atomic(
  p_ticket_type_id uuid, p_quantity integer, p_payment_intent_id text DEFAULT NULL,
  p_user_id text DEFAULT NULL, p_guest_email text DEFAULT NULL,
  p_hold_seconds integer DEFAULT 600, p_hold_kind text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tier public.ticket_types%ROWTYPE;
  v_buyer_reserved bigint;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;
  IF nullif(btrim(p_user_id), '') IS NULL AND nullif(btrim(p_guest_email), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'buyer_required');
  END IF;
  SELECT * INTO v_tier FROM public.ticket_types WHERE id = p_ticket_type_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'tier_not_found'); END IF;
  IF v_tier.max_per_order > 0 AND p_quantity > v_tier.max_per_order THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_limit', 'limit', v_tier.max_per_order);
  END IF;
  IF v_tier.max_per_user > 0 THEN
    v_buyer_reserved := public.ticket_buyer_reserved_quantity(p_ticket_type_id, p_user_id, p_guest_email);
    IF v_buyer_reserved + p_quantity > v_tier.max_per_user THEN
      RETURN jsonb_build_object('ok', false, 'error', 'buyer_limit',
        'limit', v_tier.max_per_user, 'remaining', greatest(0, v_tier.max_per_user - v_buyer_reserved));
    END IF;
  END IF;
  -- Inventory, hold TTL and payment identity remain the existing proven RPC.
  RETURN public.ticket_hold_create_atomic(p_ticket_type_id, p_quantity,
    p_payment_intent_id, p_user_id, p_guest_email, p_hold_seconds, p_hold_kind);
END;
$$;
REVOKE ALL ON FUNCTION public.ticket_purchase_hold_atomic(uuid, integer, text, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_purchase_hold_atomic(uuid, integer, text, text, text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cart_create_hold(
  p_cart_id uuid,
  p_hold_seconds integer DEFAULT 600,
  p_unlock_codes jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cart public.carts%rowtype;
  v_line record;
  v_line_count integer := 0;
  v_expires_at timestamptz := now() + make_interval(secs => greatest(60, least(coalesce(p_hold_seconds, 600), 3600)));
  v_active_cart_hold_qty integer;
  v_active_legacy_hold_qty integer;
  v_available integer;
  v_price integer;
  v_codes jsonb := coalesce(p_unlock_codes, '[]'::jsonb);
  v_unlocked boolean;
  v_buyer_reserved bigint;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;
  IF v_cart.status = 'completed' THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_completed'); END IF;

  -- Preflight the complete requested quantity per tier before any mutations.
  -- Deterministic tier locks coordinate with single-tier reservations. Exclude
  -- this cart's old holds so refreshing a draft is not treated as a new order.
  PERFORM t.id FROM public.ticket_types t WHERE t.id IN (
    SELECT tier_id FROM public.cart_line_items WHERE cart_id = p_cart_id)
    ORDER BY t.id FOR UPDATE;
  FOR v_line IN
    SELECT t.id AS tier_id, t.max_per_user, t.max_per_order, sum(l.quantity) AS quantity
    FROM public.cart_line_items l JOIN public.ticket_types t ON t.id = l.tier_id
    WHERE l.cart_id = p_cart_id GROUP BY t.id, t.max_per_user, t.max_per_order
  LOOP
    IF v_line.max_per_order > 0 AND v_line.quantity > v_line.max_per_order THEN
      RETURN jsonb_build_object('ok', false, 'error', 'order_limit', 'tierId', v_line.tier_id, 'limit', v_line.max_per_order);
    END IF;
    IF v_line.max_per_user > 0 THEN
      v_buyer_reserved := public.ticket_buyer_reserved_quantity(v_line.tier_id, v_cart.user_id, NULL, p_cart_id);
      IF v_buyer_reserved + v_line.quantity > v_line.max_per_user THEN
        RETURN jsonb_build_object('ok', false, 'error', 'buyer_limit',
          'tierId', v_line.tier_id, 'limit', v_line.max_per_user,
          'remaining', greatest(0, v_line.max_per_user - v_buyer_reserved));
      END IF;
    END IF;
  END LOOP;

  UPDATE public.cart_holds SET released = true, released_at = now()
  WHERE cart_id = p_cart_id AND released = false;

  FOR v_line IN
    SELECT cli.id, cli.cart_id, cli.category, cli.tier_id, cli.quantity,
           tt.event_id AS tier_event_id, tt.currency,
           tt.quantity_total, tt.quantity_sold, tt.max_per_user, tt.category AS tier_category, tt.status AS tier_status,
           tt.tier_visibility, tt.unlock_code, tt.unlocks_after_tier_id
    FROM public.cart_line_items cli
    JOIN public.ticket_types tt ON tt.id = cli.tier_id
    WHERE cli.cart_id = p_cart_id AND cli.tier_id IS NOT NULL
    ORDER BY cli.id FOR UPDATE OF cli, tt
  LOOP
    v_line_count := v_line_count + 1;
    IF v_line.tier_event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'line_item_event_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id); END IF;
    IF lower(v_line.currency) <> lower(v_cart.currency) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id); END IF;
    IF v_line.category IS DISTINCT FROM coalesce(v_line.tier_category, 'admission')
       AND NOT (v_line.category IN ('coat_check', 'service') AND v_line.tier_category IN ('coat_check', 'service')) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'category_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id); END IF;
    IF v_line.tier_status IS NOT NULL AND v_line.tier_status <> 'on_sale' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tier_not_on_sale', 'lineItemId', v_line.id, 'tierId', v_line.tier_id); END IF;

    -- ── v3: tier visibility enforcement (never echo unlock_code) ──────
    IF v_line.tier_visibility = 'hidden' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tier_hidden',
        'lineItemId', v_line.id, 'tierId', v_line.tier_id);
    ELSIF v_line.tier_visibility = 'locked' THEN
      v_unlocked := false;

      -- (a) submitted code matches this tier's unlock_code
      IF v_line.unlock_code IS NOT NULL AND btrim(v_line.unlock_code) <> '' THEN
        IF jsonb_typeof(v_codes) = 'object' THEN
          v_unlocked := lower(btrim(coalesce(v_codes ->> v_line.tier_id::text, '')))
                        = lower(btrim(v_line.unlock_code));
        ELSIF jsonb_typeof(v_codes) = 'array' THEN
          SELECT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_codes) c
            WHERE lower(btrim(c)) = lower(btrim(v_line.unlock_code))
          ) INTO v_unlocked;
        END IF;
      END IF;

      -- (b) auto-unlock: gating tier (unlocks_after_tier_id) is sold out
      IF NOT v_unlocked AND v_line.unlocks_after_tier_id IS NOT NULL THEN
        SELECT (gate.status = 'sold_out'
                OR coalesce(gate.is_sold_out, false)
                OR public.ticket_type_available(gate.id) = 0)
          INTO v_unlocked
        FROM public.ticket_types gate
        WHERE gate.id = v_line.unlocks_after_tier_id;
        v_unlocked := coalesce(v_unlocked, false);
      END IF;

      IF NOT v_unlocked THEN
        RETURN jsonb_build_object('ok', false, 'error', 'tier_locked',
          'lineItemId', v_line.id, 'tierId', v_line.tier_id);
      END IF;
    END IF;

    v_price := public.ticket_type_current_price_cents(v_line.tier_id);
    UPDATE public.cart_line_items SET unit_price_cents = v_price WHERE id = v_line.id;

    IF v_line.quantity_total IS NOT NULL THEN
      SELECT coalesce(sum(ch.qty), 0) INTO v_active_cart_hold_qty FROM public.cart_holds ch
      WHERE ch.tier_id = v_line.tier_id AND ch.released = false AND ch.expires_at > now();
      SELECT coalesce(sum(th.quantity), 0) INTO v_active_legacy_hold_qty FROM public.ticket_holds th
      WHERE th.ticket_type_id = v_line.tier_id AND th.status = 'active' AND th.expires_at > now();
      v_available := v_line.quantity_total - coalesce(v_line.quantity_sold, 0)
        - coalesce(v_active_cart_hold_qty, 0) - coalesce(v_active_legacy_hold_qty, 0);
      IF v_available < v_line.quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity',
          'lineItemId', v_line.id, 'tierId', v_line.tier_id, 'available', greatest(v_available, 0)); END IF;
    END IF;

    INSERT INTO public.cart_holds (cart_id, line_item_id, tier_id, qty, expires_at)
    VALUES (p_cart_id, v_line.id, v_line.tier_id, v_line.quantity, v_expires_at);
  END LOOP;

  FOR v_line IN
    SELECT cli.id, cli.cart_id, cli.quantity, cli.addon_id, cli.variant_id,
           a.event_id AS addon_event_id, a.status AS addon_status, a.requires_tier_id,
           a.price_cents AS addon_price, a.currency AS addon_currency,
           a.quantity_total AS addon_total, a.quantity_sold AS addon_sold, a.quantity_held AS addon_held,
           v.price_cents AS variant_price, v.quantity_total AS variant_total,
           v.quantity_sold AS variant_sold, v.quantity_held AS variant_held
    FROM public.cart_line_items cli
    JOIN public.ticket_addons a ON a.id = cli.addon_id
    LEFT JOIN public.ticket_addon_variants v ON v.id = cli.variant_id
    WHERE cli.cart_id = p_cart_id AND cli.addon_id IS NOT NULL
    ORDER BY cli.id FOR UPDATE OF cli, a
  LOOP
    v_line_count := v_line_count + 1;
    IF v_line.addon_event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_event_mismatch', 'lineItemId', v_line.id, 'addonId', v_line.addon_id); END IF;
    IF lower(coalesce(v_line.addon_currency, v_cart.currency)) <> lower(v_cart.currency) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch', 'lineItemId', v_line.id, 'addonId', v_line.addon_id); END IF;
    IF v_line.addon_status <> 'on_sale' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_not_on_sale', 'lineItemId', v_line.id, 'addonId', v_line.addon_id); END IF;

    -- ── v4: requires_tier satisfied by an in-cart tier line OR a live
    --    owned ticket of that tier (post-purchase add-on-only carts). ──
    IF v_line.requires_tier_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.cart_line_items g
         WHERE g.cart_id = p_cart_id AND g.tier_id = v_line.requires_tier_id)
       AND NOT (
         v_cart.user_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM public.tickets t
           WHERE t.user_id = v_cart.user_id
             AND t.event_id = v_cart.event_id
             AND t.ticket_type_id = v_line.requires_tier_id
             AND t.status IN ('active', 'scanned'))) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_requires_tier',
        'lineItemId', v_line.id, 'addonId', v_line.addon_id, 'requiresTierId', v_line.requires_tier_id); END IF;

    v_price := coalesce(v_line.variant_price, v_line.addon_price);
    UPDATE public.cart_line_items SET unit_price_cents = v_price WHERE id = v_line.id;

    -- v5: one availability rule for every add-on line. A variant line is
    -- bounded by its own cap AND the parent add-on's cap; a plain line counts
    -- the variants' sales and holds against the parent. This cart's own holds
    -- were released at the top, so they are not counted against it, while
    -- holds inserted by earlier lines of this same cart are.
    v_available := CASE WHEN v_line.variant_id IS NOT NULL
      THEN public.addon_variant_available(v_line.variant_id)
      ELSE public.addon_available(v_line.addon_id) END;

    IF v_available IS NOT NULL THEN
      IF v_available < v_line.quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'addon_insufficient_capacity',
          'lineItemId', v_line.id, 'addonId', v_line.addon_id, 'variantId', v_line.variant_id, 'available', greatest(v_available, 0)); END IF;
    END IF;

    INSERT INTO public.cart_holds (cart_id, line_item_id, tier_id, addon_id, variant_id, qty, expires_at)
    VALUES (p_cart_id, v_line.id, NULL, v_line.addon_id, v_line.variant_id, v_line.quantity, v_expires_at);
  END LOOP;

  IF v_line_count = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'empty_cart'); END IF;
  UPDATE public.carts SET status = 'holding' WHERE id = p_cart_id;
  RETURN jsonb_build_object('ok', true, 'holdExpiresAt', v_expires_at);
END;
$$;

-- Re-pin execution grants (mirrors 20260516150000: service_role only; the
-- RPC is reached exclusively through edge fns).
REVOKE ALL ON FUNCTION public.cart_create_hold(uuid, integer, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cart_create_hold(uuid, integer, jsonb) TO service_role;

-- Preserve the existing paid recovery allocator and its failure contract;
-- only add a cap check before allocation when an expired cart is recovered.
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
    -- A paid cart may return after its reservation expired and the buyer
    -- placed another order. Do not exceed the same per-tier cap on recovery.
    -- Return the existing capacity failure contract: no refund, cancellation,
    -- partial allocation, or mutation of already-issued credentials occurs.
    IF v_line.max_per_user > 0 THEN
      v_available := greatest(0, v_line.max_per_user - public.ticket_buyer_reserved_quantity(
        v_line.id, p_user_id, NULL, p_cart_id));
      IF v_available < v_line.requested THEN
        RETURN jsonb_build_object('ok',false,'error','insufficient_capacity',
          'capacity_reason','buyer_limit','available',v_available,'limit',v_line.max_per_user);
      END IF;
    END IF;
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

CREATE OR REPLACE FUNCTION public.free_ticket_checkout_atomic(
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
  IF v_quantity < 1
     OR v_order.quantity IS DISTINCT FROM v_quantity
     OR v_order.total_cents IS DISTINCT FROM 0
     OR v_order.subtotal_cents IS DISTINCT FROM 0
     OR v_order.event_id IS NULL
     OR (NULLIF(btrim(v_order.user_id), '') IS NULL AND NULLIF(btrim(v_order.guest_email), '') IS NULL)
     OR (v_order.user_id IS NOT NULL AND v_order.guest_email IS NOT NULL)
     OR length(v_order.guest_email) > 254
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
         OR v_existing.user_id IS DISTINCT FROM v_order.user_id
         OR v_existing.guest_email IS DISTINCT FROM v_order.guest_email
         OR v_existing.quantity IS DISTINCT FROM v_quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict');
      END IF;
      IF v_existing.status IS DISTINCT FROM 'paid'
         OR v_existing.type IS DISTINCT FROM 'event_ticket'
         OR v_existing.stripe_payment_intent_id IS NOT NULL
         OR v_existing.stripe_checkout_session_id IS NOT NULL
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
        'order_id', v_existing.id, 'count', v_count, 'order', to_jsonb(v_existing),
        'tickets', (SELECT jsonb_agg(jsonb_build_object('id', id, 'qr_token', qr_token) ORDER BY order_index)
          FROM public.tickets WHERE order_id = v_existing.id));
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

  -- Pending allocations on every rail consume the same per-person cap.
  IF v_tier.max_per_user > 0 AND public.ticket_buyer_reserved_quantity(
       p_ticket_type_id, v_order.user_id, v_order.guest_email) + v_quantity > v_tier.max_per_user THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit', 'limit', v_tier.max_per_user);
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
       OR NULLIF(t.qr_payload, '') IS NULL
       OR (v_order.user_id IS NULL AND NULLIF(t.guest_lookup_token, '') IS NULL)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_ticket_rows');
  END IF;

  v_hold := public.ticket_purchase_hold_atomic(
    p_ticket_type_id, v_quantity, NULL, v_order.user_id, v_order.guest_email, 600, NULL);
  IF NOT coalesce((v_hold->>'ok')::boolean, false) THEN RETURN v_hold; END IF;

  INSERT INTO public.orders (
    user_id, guest_email, type, status, quantity, currency, subtotal_cents,
    total_cents, event_id, paid_at, idempotency_key, promo_code_id, discount_cents,
    promoter_id, promoter_policy_version, promoter_original_amount_cents,
    promoter_customer_discount_bps, promoter_discount_amount_cents,
    promoter_discounted_amount_cents, promoter_code, promoter_commission_bps,
    promoter_commission_amount_cents
  ) VALUES (
    v_order.user_id, v_order.guest_email, 'event_ticket', 'paid', v_quantity, 'usd', 0, 0,
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
  ) SELECT t.id, v_order.event_id, p_ticket_type_id, v_order.user_id, v_order.guest_email,
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
    (v_order.id, 'payment_captured', 'Free ticket issued');
  RETURN jsonb_build_object('ok', true, 'idempotent', false,
    'order_id', v_order.id, 'count', v_quantity, 'order', to_jsonb(v_order),
    'tickets', (SELECT jsonb_agg(jsonb_build_object('id', id, 'qr_token', qr_token) ORDER BY order_index)
      FROM public.tickets WHERE order_id = v_order.id));
END;
$$;
REVOKE ALL ON FUNCTION public.free_ticket_checkout_atomic(uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.free_ticket_checkout_atomic(uuid, jsonb, jsonb)
  TO service_role;

-- Retain the deployed guest-only entrypoint and reject attempts to smuggle a
-- member identity through it. Both entrypoints share one atomic allocator.
CREATE OR REPLACE FUNCTION public.guest_free_checkout_atomic(
  p_ticket_type_id uuid, p_ticket_rows jsonb, p_order jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_order->>'user_id' IS NOT NULL OR jsonb_array_length(p_ticket_rows) > 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request');
  END IF;
  RETURN public.free_ticket_checkout_atomic(p_ticket_type_id, p_ticket_rows, p_order);
END;
$$;
REVOKE ALL ON FUNCTION public.guest_free_checkout_atomic(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_free_checkout_atomic(uuid, jsonb, jsonb) TO service_role;
-- Services/products do not add people to public Going counts. Existing
-- cached counts are not backfilled; ordinary future writes recompute them.
CREATE OR REPLACE FUNCTION public.event_people_going_count(p_event_id integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH ticket_count AS (
    SELECT count(*)::integer AS n
    FROM public.tickets t
    WHERE t.event_id = p_event_id
      AND t.status IN ('active', 'scanned', 'transfer_pending')
      AND t.category = 'admission'
  ),
  rsvp_only AS (
    SELECT count(DISTINCT r.user_id)::integer AS n
    FROM public.event_rsvps r
    WHERE r.event_id = p_event_id
      AND r.status = 'going'
      AND r.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tickets t
        WHERE t.event_id = p_event_id
          AND t.user_id = r.user_id
          AND t.status IN ('active', 'scanned', 'transfer_pending')
      AND t.category = 'admission'
      )
  )
  SELECT COALESCE((SELECT n FROM ticket_count), 0)
       + COALESCE((SELECT n FROM rsvp_only), 0);
$$;

REVOKE ALL ON FUNCTION public.event_people_going_count(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_people_going_count(integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
