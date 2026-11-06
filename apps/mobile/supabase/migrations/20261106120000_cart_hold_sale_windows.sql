-- Enforce tier sale windows when allocating or refreshing mixed-cart holds.
-- Definition-only migration, based on 20261031142216_repeat_purchase_tier_limits.
-- No data backfill or hold cancellation. Apply after that migration.
-- Existing held/paying carts can still complete via the unchanged checkout and
-- paid fulfillment paths; do not invalidate already reviewed payments here.
-- This closes new/renewed reservations, not historical holds created before
-- deployment. Deploying only UI/edge code does not activate this SQL guard.

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
  v_sale_now timestamptz;
  v_buyer_reserved bigint;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;
  IF v_cart.status = 'completed' THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_completed'); END IF;

  -- Freeze the selection before locking its tier set. The cart FOR UPDATE
  -- above blocks new line inserts through cart_line_items.cart_id's FK;
  -- these row locks also block retargets, quantity edits and deletes.
  PERFORM cli.id FROM public.cart_line_items cli WHERE cli.cart_id = p_cart_id
    ORDER BY cli.id FOR UPDATE;

  -- Preflight the complete requested quantity per tier before any mutations.
  -- Deterministic tier locks coordinate with single-tier reservations. Exclude
  -- this cart's old holds so refreshing a draft is not treated as a new order.
  PERFORM t.id FROM public.ticket_types t WHERE t.id IN (
    SELECT tier_id FROM public.cart_line_items WHERE cart_id = p_cart_id)
    ORDER BY t.id FOR UPDATE;

  -- Use wall time AFTER acquiring every tier lock: an organizer edit or a
  -- checkout waiting across a sale boundary must use the locked current row,
  -- not the transaction's earlier now(). Reject the entire selection before
  -- releasing existing holds, repricing lines or reserving any inventory.
  v_sale_now := clock_timestamp();
  FOR v_line IN
    SELECT t.id AS tier_id, t.sale_start, t.sale_end
    FROM public.ticket_types t
    WHERE t.id IN (SELECT tier_id FROM public.cart_line_items WHERE cart_id = p_cart_id)
    ORDER BY t.id
  LOOP
    IF (v_line.sale_start IS NOT NULL AND NOT isfinite(v_line.sale_start))
       OR (v_line.sale_end IS NOT NULL AND NOT isfinite(v_line.sale_end))
       OR (v_line.sale_start IS NOT NULL AND v_line.sale_end IS NOT NULL
           AND v_line.sale_start >= v_line.sale_end) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_sale_window', 'tierId', v_line.tier_id);
    END IF;
    IF v_line.sale_start > v_sale_now THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sale_not_started', 'tierId', v_line.tier_id);
    END IF;
    IF v_line.sale_end <= v_sale_now THEN
      RETURN jsonb_build_object('ok', false, 'error', 'sale_ended', 'tierId', v_line.tier_id);
    END IF;
  END LOOP;
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

