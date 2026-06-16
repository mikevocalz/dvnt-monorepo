-- ════════════════════════════════════════════════════════════════════════
-- Bring add-ons through the SAME cart_holds reservation as tiers, so add-on /
-- variant inventory cannot oversell under concurrency. Extends the cart schema
-- and replaces public.cart_create_hold (base: 20260516150000) to:
--   (1) price tier lines via ticket_type_current_price_cents() [tier-model v2],
--   (2) atomically hold add-on / variant inventory with FOR UPDATE row locks,
--   (3) enforce add-on tier-gating (requires_tier_id) + on-sale status.
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. cart_line_items: allow add-on lines (tier_id now nullable; addon target) ──
ALTER TABLE public.cart_line_items
  ADD COLUMN IF NOT EXISTS addon_id   uuid REFERENCES public.ticket_addons(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.ticket_addon_variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS bound_line_item_id uuid REFERENCES public.cart_line_items(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.cart_line_items ALTER COLUMN tier_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.cart_line_items DROP CONSTRAINT IF EXISTS cart_line_items_category_check;
  ALTER TABLE public.cart_line_items ADD CONSTRAINT cart_line_items_category_check
    CHECK (category IN ('admission','coat_check','product','service','addon'));
  -- exactly one target: a tier OR an add-on (never both, never neither)
  ALTER TABLE public.cart_line_items DROP CONSTRAINT IF EXISTS cart_line_items_target_check;
  ALTER TABLE public.cart_line_items ADD CONSTRAINT cart_line_items_target_check
    CHECK ((tier_id IS NOT NULL) <> (addon_id IS NOT NULL));
EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cart_line_items_addon ON public.cart_line_items(addon_id) WHERE addon_id IS NOT NULL;

-- ── 2. cart_holds: hold against a tier OR an add-on/variant ──
ALTER TABLE public.cart_holds
  ADD COLUMN IF NOT EXISTS addon_id   uuid REFERENCES public.ticket_addons(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES public.ticket_addon_variants(id) ON DELETE RESTRICT;

DO $$ BEGIN
  ALTER TABLE public.cart_holds ALTER COLUMN tier_id DROP NOT NULL;
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.cart_holds DROP CONSTRAINT IF EXISTS cart_holds_target_check;
  ALTER TABLE public.cart_holds ADD CONSTRAINT cart_holds_target_check
    CHECK ((tier_id IS NOT NULL) <> (addon_id IS NOT NULL));
EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cart_holds_addon_active
  ON public.cart_holds(addon_id, expires_at) WHERE released = false AND addon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cart_holds_variant_active
  ON public.cart_holds(variant_id, expires_at) WHERE released = false AND variant_id IS NOT NULL;

-- ── 3. Replace cart_create_hold: tier loop (v2 pricing) + add-on loop ──
CREATE OR REPLACE FUNCTION public.cart_create_hold(
  p_cart_id uuid,
  p_hold_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart public.carts%rowtype;
  v_line record;
  v_line_count integer := 0;
  v_expires_at timestamptz :=
    now() + make_interval(secs => greatest(60, least(coalesce(p_hold_seconds, 600), 3600)));
  v_active_cart_hold_qty integer;
  v_active_legacy_hold_qty integer;
  v_available integer;
  v_price integer;
  v_eff_total integer;
  v_eff_sold integer;
  v_eff_held integer;
BEGIN
  SELECT * INTO v_cart FROM public.carts WHERE id = p_cart_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_not_found'); END IF;
  IF v_cart.status = 'completed' THEN RETURN jsonb_build_object('ok', false, 'error', 'cart_completed'); END IF;

  -- release this cart's prior active holds (idempotent re-hold)
  UPDATE public.cart_holds SET released = true, released_at = now()
  WHERE cart_id = p_cart_id AND released = false;

  -- ── TIER lines ──────────────────────────────────────────────────────────
  FOR v_line IN
    SELECT cli.id, cli.cart_id, cli.category, cli.tier_id, cli.quantity,
           tt.event_id AS tier_event_id, tt.currency,
           tt.quantity_total, tt.quantity_sold, tt.category AS tier_category, tt.status AS tier_status
    FROM public.cart_line_items cli
    JOIN public.ticket_types tt ON tt.id = cli.tier_id
    WHERE cli.cart_id = p_cart_id AND cli.tier_id IS NOT NULL
    ORDER BY cli.id
    FOR UPDATE OF cli, tt
  LOOP
    v_line_count := v_line_count + 1;

    IF v_line.tier_event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'line_item_event_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id);
    END IF;
    IF lower(v_line.currency) <> lower(v_cart.currency) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id);
    END IF;
    IF v_line.category = 'admission' AND v_line.tier_category <> 'admission' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'category_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id);
    END IF;
    IF v_line.category = 'coat_check' AND v_line.tier_category NOT IN ('coat_check', 'service') THEN
      RETURN jsonb_build_object('ok', false, 'error', 'category_mismatch', 'lineItemId', v_line.id, 'tierId', v_line.tier_id);
    END IF;
    IF v_line.tier_status IS NOT NULL AND v_line.tier_status <> 'on_sale' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'tier_not_on_sale', 'lineItemId', v_line.id, 'tierId', v_line.tier_id);
    END IF;

    -- v2: authoritative current price (price_schedule → sub_allocations → base)
    v_price := public.ticket_type_current_price_cents(v_line.tier_id);
    UPDATE public.cart_line_items SET unit_price_cents = v_price WHERE id = v_line.id;

    IF v_line.quantity_total IS NOT NULL THEN
      SELECT coalesce(sum(ch.qty), 0) INTO v_active_cart_hold_qty
      FROM public.cart_holds ch
      WHERE ch.tier_id = v_line.tier_id AND ch.released = false AND ch.expires_at > now();

      SELECT coalesce(sum(th.quantity), 0) INTO v_active_legacy_hold_qty
      FROM public.ticket_holds th
      WHERE th.ticket_type_id = v_line.tier_id AND th.status = 'active' AND th.expires_at > now();

      v_available := v_line.quantity_total - coalesce(v_line.quantity_sold, 0)
        - coalesce(v_active_cart_hold_qty, 0) - coalesce(v_active_legacy_hold_qty, 0);

      IF v_available < v_line.quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'insufficient_capacity',
          'lineItemId', v_line.id, 'tierId', v_line.tier_id, 'available', greatest(v_available, 0));
      END IF;
    END IF;

    INSERT INTO public.cart_holds (cart_id, line_item_id, tier_id, qty, expires_at)
    VALUES (p_cart_id, v_line.id, v_line.tier_id, v_line.quantity, v_expires_at);
  END LOOP;

  -- ── ADD-ON lines ────────────────────────────────────────────────────────
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
    ORDER BY cli.id
    FOR UPDATE OF cli, a
  LOOP
    v_line_count := v_line_count + 1;

    IF v_line.addon_event_id <> v_cart.event_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_event_mismatch', 'lineItemId', v_line.id, 'addonId', v_line.addon_id);
    END IF;
    IF lower(coalesce(v_line.addon_currency, v_cart.currency)) <> lower(v_cart.currency) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'currency_mismatch', 'lineItemId', v_line.id, 'addonId', v_line.addon_id);
    END IF;
    IF v_line.addon_status <> 'on_sale' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_not_on_sale', 'lineItemId', v_line.id, 'addonId', v_line.addon_id);
    END IF;

    -- tier-gating: an add-on requiring a tier needs that tier present in this cart
    IF v_line.requires_tier_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.cart_line_items g
         WHERE g.cart_id = p_cart_id AND g.tier_id = v_line.requires_tier_id
       ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'addon_requires_tier',
        'lineItemId', v_line.id, 'addonId', v_line.addon_id, 'requiresTierId', v_line.requires_tier_id);
    END IF;

    -- authoritative price: variant override else add-on base
    v_price := coalesce(v_line.variant_price, v_line.addon_price);
    UPDATE public.cart_line_items SET unit_price_cents = v_price WHERE id = v_line.id;

    -- inventory: variant row if present, else add-on row
    IF v_line.variant_id IS NOT NULL THEN
      v_eff_total := v_line.variant_total; v_eff_sold := v_line.variant_sold; v_eff_held := v_line.variant_held;
      SELECT coalesce(sum(ch.qty), 0) INTO v_active_cart_hold_qty
      FROM public.cart_holds ch
      WHERE ch.variant_id = v_line.variant_id AND ch.released = false AND ch.expires_at > now();
    ELSE
      v_eff_total := v_line.addon_total; v_eff_sold := v_line.addon_sold; v_eff_held := v_line.addon_held;
      SELECT coalesce(sum(ch.qty), 0) INTO v_active_cart_hold_qty
      FROM public.cart_holds ch
      WHERE ch.addon_id = v_line.addon_id AND ch.variant_id IS NULL AND ch.released = false AND ch.expires_at > now();
    END IF;

    IF v_eff_total IS NOT NULL THEN
      v_available := v_eff_total - coalesce(v_eff_sold, 0) - coalesce(v_eff_held, 0) - coalesce(v_active_cart_hold_qty, 0);
      IF v_available < v_line.quantity THEN
        RETURN jsonb_build_object('ok', false, 'error', 'addon_insufficient_capacity',
          'lineItemId', v_line.id, 'addonId', v_line.addon_id, 'variantId', v_line.variant_id,
          'available', greatest(v_available, 0));
      END IF;
    END IF;

    INSERT INTO public.cart_holds (cart_id, line_item_id, tier_id, addon_id, variant_id, qty, expires_at)
    VALUES (p_cart_id, v_line.id, NULL, v_line.addon_id, v_line.variant_id, v_line.quantity, v_expires_at);
  END LOOP;

  IF v_line_count = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'empty_cart'); END IF;

  UPDATE public.carts SET status = 'holding' WHERE id = p_cart_id;
  RETURN jsonb_build_object('ok', true, 'holdExpiresAt', v_expires_at);
END;
$$;
