-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613144937 :: ticket_tier_model_v2). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Ticket Tier Model v2 — additive + idempotent. Extends ticket_types.

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS tier_type text NOT NULL DEFAULT 'ga';

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_tier_type_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_tier_type_check
    CHECK (tier_type IN ('ga','vip','early_bird','table_service','group_bundle','comp','donation'));
EXCEPTION WHEN others THEN NULL; END $$;

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

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS price_schedule jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS sub_allocations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS quantity_held integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_reserved_comp integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_qty_nonneg_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_qty_nonneg_check
    CHECK (quantity_held >= 0 AND quantity_reserved_comp >= 0 AND coalesce(quantity_sold,0) >= 0);
EXCEPTION WHEN others THEN NULL; END $$;

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS min_price_cents integer;

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

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'on_sale';

DO $$ BEGIN
  ALTER TABLE public.ticket_types DROP CONSTRAINT IF EXISTS ticket_types_status_check;
  ALTER TABLE public.ticket_types ADD CONSTRAINT ticket_types_status_check
    CHECK (status IN ('draft','scheduled','on_sale','paused','sold_out','ended'));
EXCEPTION WHEN others THEN NULL; END $$;

UPDATE public.ticket_types SET status =
  CASE
    WHEN coalesce(is_sold_out,false) THEN 'sold_out'
    WHEN is_active = false           THEN 'paused'
    ELSE 'on_sale'
  END
WHERE status = 'on_sale';

ALTER TABLE public.ticket_types
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.ticket_type_available(p_tier_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN tt.quantity_total IS NULL THEN 2147483647
    ELSE GREATEST(0, tt.quantity_total - COALESCE(tt.quantity_sold,0)
                     - COALESCE(tt.quantity_held,0) - COALESCE(tt.quantity_reserved_comp,0))
  END
  FROM public.ticket_types tt WHERE tt.id = p_tier_id;
$$;

CREATE OR REPLACE FUNCTION public.ticket_type_current_price_cents(p_tier_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE
  tt public.ticket_types;
  sched_price integer;
  band jsonb;
  acc integer := 0;
BEGIN
  SELECT * INTO tt FROM public.ticket_types WHERE id = p_tier_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT (e->>'price_cents')::int INTO sched_price
  FROM jsonb_array_elements(tt.price_schedule) e
  WHERE (e->>'effective_at')::timestamptz <= now()
  ORDER BY (e->>'effective_at')::timestamptz DESC
  LIMIT 1;
  IF sched_price IS NOT NULL THEN RETURN sched_price; END IF;

  IF jsonb_array_length(tt.sub_allocations) > 0 THEN
    FOR band IN SELECT * FROM jsonb_array_elements(tt.sub_allocations) LOOP
      acc := acc + (band->>'quantity')::int;
      IF COALESCE(tt.quantity_sold,0) < acc THEN
        RETURN (band->>'price_cents')::int;
      END IF;
    END LOOP;
  END IF;

  RETURN tt.price_cents;
END;
$$;;
