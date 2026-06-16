-- ══════════════════════════════════════════════════════════════
-- Phase 4: Promo Codes — add discount columns to orders
-- ══════════════════════════════════════════════════════════════

ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES promo_codes(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_cents integer DEFAULT 0;

-- Atomic increment for promo code usage
CREATE OR REPLACE FUNCTION increment_promo_uses(p_promo_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE promo_codes
  SET uses_count = COALESCE(uses_count, 0) + 1
  WHERE id = p_promo_id;
$$;

GRANT EXECUTE ON FUNCTION increment_promo_uses(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
