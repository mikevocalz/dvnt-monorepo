-- ══════════════════════════════════════════════════════════════
-- Phase 2: promoter code program v2
--
-- Splits the single `rev_share_bps` field into two independent fields:
--   - customer_discount_bps  (buyer discount)
--   - promoter_commission_bps (promoter earning rate)
--
-- Adds an order-level snapshot of the policy, discount and commission so
-- historical rows never recompute from current settings.
-- Adds orders.charge_model for the separate-charges-and-transfers work.
--
-- Backfill: existing codes keep their configured rev_share_bps as both the
-- customer discount and the promoter commission. This preserves the
-- "one canonical code does two things" model described in the product spec.
-- ══════════════════════════════════════════════════════════════

-- ── 1. event_promoters: split rev_share_bps into two explicit fields ─
ALTER TABLE event_promoters
  ADD COLUMN IF NOT EXISTS customer_discount_bps integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promoter_commission_bps integer NOT NULL DEFAULT 0;

UPDATE event_promoters
SET customer_discount_bps = rev_share_bps,
    promoter_commission_bps = rev_share_bps
WHERE rev_share_bps IS NOT NULL
  AND rev_share_bps > 0;

-- Remove the default so app code must supply explicit values going forward.
ALTER TABLE event_promoters
  ALTER COLUMN customer_discount_bps DROP DEFAULT,
  ALTER COLUMN promoter_commission_bps DROP DEFAULT;

DO $$ BEGIN
  ALTER TABLE event_promoters
    ADD CONSTRAINT event_promoters_customer_discount_bps_check
      CHECK (customer_discount_bps >= 0 AND customer_discount_bps <= 10000),
    ADD CONSTRAINT event_promoters_promoter_commission_bps_check
      CHECK (promoter_commission_bps >= 0 AND promoter_commission_bps <= 10000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. orders: snapshot of promoter policy and amounts, plus charge model ─
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS charge_model text,
  ADD COLUMN IF NOT EXISTS promoter_policy_version text,
  ADD COLUMN IF NOT EXISTS promoter_original_amount_cents integer,
  ADD COLUMN IF NOT EXISTS promoter_customer_discount_bps integer,
  ADD COLUMN IF NOT EXISTS promoter_discount_amount_cents integer,
  ADD COLUMN IF NOT EXISTS promoter_discounted_amount_cents integer,
  ADD COLUMN IF NOT EXISTS promoter_id uuid,
  ADD COLUMN IF NOT EXISTS promoter_code text,
  ADD COLUMN IF NOT EXISTS promoter_commission_bps integer,
  ADD COLUMN IF NOT EXISTS promoter_commission_amount_cents integer;

DO $$ BEGIN
  ALTER TABLE orders
    ADD CONSTRAINT orders_charge_model_check
      CHECK (charge_model IS NULL OR charge_model IN ('destination_charge', 'separate_charges_and_transfers')),
    ADD CONSTRAINT orders_promoter_customer_discount_bps_check
      CHECK (promoter_customer_discount_bps IS NULL OR (promoter_customer_discount_bps >= 0 AND promoter_customer_discount_bps <= 10000)),
    ADD CONSTRAINT orders_promoter_commission_bps_check
      CHECK (promoter_commission_bps IS NULL OR (promoter_commission_bps >= 0 AND promoter_commission_bps <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 3. promoter_attributions: lock both rates at attribution time ─
ALTER TABLE promoter_attributions
  ADD COLUMN IF NOT EXISTS locked_customer_discount_bps integer,
  ADD COLUMN IF NOT EXISTS locked_promoter_commission_bps integer,
  ADD COLUMN IF NOT EXISTS locked_promoter_discount_amount_cents integer,
  ADD COLUMN IF NOT EXISTS locked_promoter_commission_amount_cents integer;

DO $$ BEGIN
  ALTER TABLE promoter_attributions
    ADD CONSTRAINT promoter_attributions_locked_customer_discount_bps_check
      CHECK (locked_customer_discount_bps IS NULL OR (locked_customer_discount_bps >= 0 AND locked_customer_discount_bps <= 10000)),
    ADD CONSTRAINT promoter_attributions_locked_promoter_commission_bps_check
      CHECK (locked_promoter_commission_bps IS NULL OR (locked_promoter_commission_bps >= 0 AND locked_promoter_commission_bps <= 10000));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 4. record_promoter_attribution: lock the split fields per order ─
CREATE OR REPLACE FUNCTION public.record_promoter_attribution(
  p_order_id uuid,
  p_code     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order    public.orders%ROWTYPE;
  v_promoter public.event_promoters%ROWTYPE;
  v_applied  boolean;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;
  IF v_order.event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_has_no_event');
  END IF;

  SELECT * INTO v_promoter
  FROM public.event_promoters
  WHERE event_id = v_order.event_id
    AND UPPER(code) = UPPER(p_code)
    AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'promoter_not_found');
  END IF;

  INSERT INTO public.promoter_attributions (
    order_id,
    promoter_id,
    locked_rev_share_bps,
    locked_customer_discount_bps,
    locked_promoter_commission_bps
  )
  VALUES (
    p_order_id,
    v_promoter.id,
    v_promoter.promoter_commission_bps, -- deprecated but kept for legacy reads
    v_promoter.customer_discount_bps,
    v_promoter.promoter_commission_bps
  )
  ON CONFLICT (order_id) DO NOTHING;

  GET DIAGNOSTICS v_applied = ROW_COUNT;

  -- Write the promoter identity snapshot into the order row if it was not
  -- already set by the checkout path.
  UPDATE public.orders
  SET promoter_id = COALESCE(orders.promoter_id, v_promoter.id),
      promoter_code = COALESCE(orders.promoter_code, v_promoter.code),
      promoter_policy_version = COALESCE(orders.promoter_policy_version, 'v2_eligible_subtotal_after_discount')
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'promoterId', v_promoter.id,
    'lockedCustomerDiscountBps', v_promoter.customer_discount_bps,
    'lockedPromoterCommissionBps', v_promoter.promoter_commission_bps
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_promoter_attribution(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_promoter_attribution(uuid, text) TO service_role;

-- ── 5. Grants ──────────────────────────────────────────────────
GRANT ALL ON event_promoters TO service_role;
GRANT ALL ON promoter_attributions TO service_role;
GRANT ALL ON orders TO service_role;

NOTIFY pgrst, 'reload schema';
