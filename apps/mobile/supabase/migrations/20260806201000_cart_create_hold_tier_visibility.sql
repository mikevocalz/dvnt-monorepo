-- ════════════════════════════════════════════════════════════════════════
-- cart_create_hold v3 — server-side enforcement of tier visibility.
--
-- Base copied VERBATIM from 20260613145108_cart_addons_holds.sql (the
-- recovered-from-prod ledger version; identical body to 20260613000200,
-- and 20260805130000 does not touch this function). Additions ONLY:
--
--   1. New param `p_unlock_codes jsonb DEFAULT '[]'::jsonb`, accepted as
--      EITHER a map {tier_id: code} OR a flat array of codes.
--   2. Tier loop now also reads tier_visibility / unlock_code /
--      unlocks_after_tier_id and rejects:
--        • tier_visibility = 'hidden'  → 'tier_hidden'  (ALWAYS fails —
--          hidden tiers are comps/holds, never purchasable via cart)
--        • tier_visibility = 'locked'  → 'tier_locked' unless a submitted
--          code matches unlock_code (case-insensitive, trimmed), or the
--          tier has no code but auto-unlocks because its
--          unlocks_after_tier_id gate is sold out.
--
-- Signature compatibility: the old 2-arg signature is DROPPED before
-- creating the 3-arg one — keeping both would make named-arg RPC calls
-- ("function is not unique") ambiguous, since the new param defaults.
-- The sole caller (functions/cart-create-hold/index.ts:294) invokes with
-- named args {p_cart_id, p_hold_seconds} and binds the new signature via
-- the default — existing callers do not break. Locked-tier carts submitted
-- without codes now fail with a clear 'tier_locked' error until the edge
-- fn / client thread codes through (follow-up sweep).
--
-- unlock_code is never included in any error payload.
--
-- NOTE (enforcement coverage): ticket-checkout, guest-checkout,
-- create-payment-intent and ticket-upgrade BYPASS this RPC — they insert
-- public.ticket_holds directly. They need the same hidden/locked guard
-- when the sweep frees those files (not edited here per file-ownership
-- fences). guest-checkout already selects tier_visibility but does not
-- gate on it.
-- ════════════════════════════════════════════════════════════════════════

-- Old signature must go first: CREATE OR REPLACE cannot change a
-- signature, and leaving both overloads breaks named-arg resolution.
DROP FUNCTION IF EXISTS public.cart_create_hold(uuid, integer);

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
  v_eff_total integer;
  v_eff_sold integer;
  v_eff_held integer;
  v_codes jsonb := coalesce(p_unlock_codes, '[]'::jsonb);
  v_unlocked boolean;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;
  IF v_cart.status = 'completed' THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_completed'); END IF;

  UPDATE public.cart_holds SET released = true, released_at = now()
  WHERE cart_id = p_cart_id AND released = false;

  FOR v_line IN
    SELECT cli.id, cli.cart_id, cli.category, cli.tier_id, cli.quantity,
           tt.event_id AS tier_event_id, tt.currency,
           tt.quantity_total, tt.quantity_sold, tt.category AS tier_category, tt.status AS tier_status,
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
    IF v_line.category = 'admission' AND v_line.tier_category <> 'admission' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'category_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id); END IF;
    IF v_line.category = 'coat_check' AND v_line.tier_category NOT IN ('coat_check', 'service') THEN
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
    IF v_line.requires_tier_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.cart_line_items g WHERE g.cart_id = p_cart_id AND g.tier_id = v_line.requires_tier_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_requires_tier',
        'lineItemId', v_line.id, 'addonId', v_line.addon_id, 'requiresTierId', v_line.requires_tier_id); END IF;

    v_price := coalesce(v_line.variant_price, v_line.addon_price);
    UPDATE public.cart_line_items SET unit_price_cents = v_price WHERE id = v_line.id;

    IF v_line.variant_id IS NOT NULL THEN
      v_eff_total := v_line.variant_total; v_eff_sold := v_line.variant_sold; v_eff_held := v_line.variant_held;
      SELECT coalesce(sum(ch.qty), 0) INTO v_active_cart_hold_qty FROM public.cart_holds ch
      WHERE ch.variant_id = v_line.variant_id AND ch.released = false AND ch.expires_at > now();
    ELSE
      v_eff_total := v_line.addon_total; v_eff_sold := v_line.addon_sold; v_eff_held := v_line.addon_held;
      SELECT coalesce(sum(ch.qty), 0) INTO v_active_cart_hold_qty FROM public.cart_holds ch
      WHERE ch.addon_id = v_line.addon_id AND ch.variant_id IS NULL AND ch.released = false AND ch.expires_at > now();
    END IF;

    IF v_eff_total IS NOT NULL THEN
      v_available := v_eff_total - coalesce(v_eff_sold, 0) - coalesce(v_eff_held, 0) - coalesce(v_active_cart_hold_qty, 0);
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

-- Re-pin execution grants for the new signature (mirrors 20260516150000:
-- service_role only; the RPC is reached exclusively through edge fns).
REVOKE ALL ON FUNCTION public.cart_create_hold(uuid, integer, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.cart_create_hold(uuid, integer, jsonb) TO service_role;
