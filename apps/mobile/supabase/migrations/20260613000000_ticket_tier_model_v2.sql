-- ════════════════════════════════════════════════════════════════════════
-- Ticket Tier Model v2 — full real-world parity (Eventbrite ticket types,
-- Posh tiered drops). Additive + idempotent. Extends existing `ticket_types`
-- (base: 20260301_events_ticketing_v2; +category: 20260516123000).
--
-- Existing columns reused (do NOT re-add): id, event_id, name, price_cents,
-- currency, quantity_total, quantity_sold, max_per_user, sale_start, sale_end,
-- max_per_order, category, tier, description, glow_color, perks, is_active,
-- is_sold_out, original_price_cents.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Rich tier type (GA / VIP / Early Bird / Table / Group / Comp / Donation)
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS tier_type text NOT NULL DEFAULT 'ga';

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_tier_type_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_tier_type_check
    CHECK (tier_type IN ('ga','vip','early_bird','table_service','group_bundle','comp','donation'));
EXCEPTION WHEN others THEN NULL; END $$;

-- Backfill tier_type from the loose legacy `tier` / `category` columns.
UPDATE public.ticket_types SET tier_type = CASE
  WHEN lower(coalesce(tier,'')) LIKE '%vip%'                              THEN 'vip'
  WHEN lower(coalesce(tier,'')) LIKE '%early%'                            THEN 'early_bird'
  WHEN lower(coalesce(tier,'')) LIKE '%table%' OR lower(coalesce(tier,'')) LIKE '%bottle%' THEN 'table_service'
  WHEN lower(coalesce(tier,'')) LIKE '%group%' OR lower(coalesce(tier,'')) LIKE '%bundle%' THEN 'group_bundle'
  WHEN lower(coalesce(tier,'')) LIKE '%comp%'  OR lower(coalesce(tier,'')) LIKE '%guest%'  THEN 'comp'
  WHEN lower(coalesce(tier,'')) LIKE '%donat%'                           THEN 'donation'
  ELSE 'ga'
END
WHERE tier_type = 'ga' AND tier IS NOT NULL;

-- ── 2. Time-gated pricing: array of {effective_at, price_cents} applied in order
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS price_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.ticket_types.price_schedule IS
  'Scheduled price changes: [{effective_at: timestamptz, price_cents: int}] ascending. Posh "price goes up" mechanic. Server resolves current price = last entry whose effective_at <= now().';

-- ── 3. Quantity-gated sub-allocations: first N @ X, next N @ Y (tier-internal)
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS sub_allocations jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.ticket_types.sub_allocations IS
  'Quantity-gated price bands: [{quantity: int, price_cents: int}] consumed in order against quantity_sold.';

-- ── 4. Inventory accounting: available = total − sold − held − reserved_comp
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS quantity_held integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_reserved_comp integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_qty_nonneg_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_qty_nonneg_check
    CHECK (quantity_held >= 0 AND quantity_reserved_comp >= 0 AND coalesce(quantity_sold,0) >= 0);
EXCEPTION WHEN others THEN NULL; END $$;

-- ── 5. Donation floor (pay-what-you-want minimum)
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS min_price_cents integer;
COMMENT ON COLUMN public.ticket_types.min_price_cents IS
  'Floor for donation/pay-what-you-want tiers (cents). NULL for fixed-price tiers.';

-- ── 6. Tier visibility: PUBLIC / HIDDEN (unlock code) / LOCKED (until another sells out)
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS tier_visibility text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS unlock_code text,
  ADD COLUMN IF NOT EXISTS unlocks_after_tier_id uuid REFERENCES public.ticket_types(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_visibility_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_visibility_check
    CHECK (tier_visibility IN ('public','hidden','locked'));
EXCEPTION WHEN others THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ticket_types_unlocks_after
  ON public.ticket_types(unlocks_after_tier_id) WHERE unlocks_after_tier_id IS NOT NULL;

-- ── 7. Tier status machine: DRAFT / SCHEDULED / ON_SALE / PAUSED / SOLD_OUT / ENDED
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'on_sale';

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_status_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_status_check
    CHECK (status IN ('draft','scheduled','on_sale','paused','sold_out','ended'));
EXCEPTION WHEN others THEN NULL; END $$;

-- Backfill status from the legacy is_active / is_sold_out booleans.
UPDATE public.ticket_types SET status =
  CASE
    WHEN coalesce(is_sold_out,false) THEN 'sold_out'
    WHEN is_active = false           THEN 'paused'
    ELSE 'on_sale'
  END
WHERE status = 'on_sale';

-- ── 8. Display order
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- ── 9. Available-inventory helper — single source of truth for "remaining".
--    available = total − sold − held − reserved_comp (NULL total = uncapped).
CREATE OR REPLACE FUNCTION public.ticket_type_available(p_tier_id uuid)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN tt.quantity_total IS NULL THEN 2147483647
    ELSE GREATEST(0, tt.quantity_total
                     - COALESCE(tt.quantity_sold, 0)
                     - COALESCE(tt.quantity_held, 0)
                     - COALESCE(tt.quantity_reserved_comp, 0))
  END
  FROM public.ticket_types tt
  WHERE tt.id = p_tier_id;
$$;

-- ── 10. Effective current price — resolves price_schedule + sub_allocations.
--    Precedence: active price_schedule entry (latest effective_at <= now) wins;
--    else current sub_allocation band by quantity_sold; else base price_cents.
CREATE OR REPLACE FUNCTION public.ticket_type_current_price_cents(p_tier_id uuid)
RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
  tt public.ticket_types;
  sched_price integer;
  band jsonb;
  acc integer := 0;
BEGIN
  SELECT * INTO tt FROM public.ticket_types WHERE id = p_tier_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- (a) time-gated schedule: last entry whose effective_at <= now()
  SELECT (e->>'price_cents')::int INTO sched_price
  FROM jsonb_array_elements(tt.price_schedule) e
  WHERE (e->>'effective_at')::timestamptz <= now()
  ORDER BY (e->>'effective_at')::timestamptz DESC
  LIMIT 1;
  IF sched_price IS NOT NULL THEN RETURN sched_price; END IF;

  -- (b) quantity-gated sub-allocation band containing quantity_sold
  IF jsonb_array_length(tt.sub_allocations) > 0 THEN
    FOR band IN SELECT * FROM jsonb_array_elements(tt.sub_allocations) LOOP
      acc := acc + (band->>'quantity')::int;
      IF COALESCE(tt.quantity_sold,0) < acc THEN
        RETURN (band->>'price_cents')::int;
      END IF;
    END LOOP;
  END IF;

  -- (c) base price
  RETURN tt.price_cents;
END;
$$;
