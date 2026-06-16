-- ════════════════════════════════════════════════════════════════════════
-- Event Boosting (Pillar C) — EXTENDS event_spotlight_campaigns (20260426), not
-- a new table. That table already has organizer_id, placement, priority (the
-- ranking multiplier), status, amount_cents (budget), stripe_payment_intent_id
-- (Stripe, NOT IAP), starts_at/ends_at. This adds: targeting, refunded amount,
-- the richer status/placement states, and the caps (one active boost per event;
-- can't activate a boost for a cancelled/ended event). Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.event_spotlight_campaigns
  ADD COLUMN IF NOT EXISTS targeting jsonb NOT NULL DEFAULT '{}'::jsonb,           -- {geo_radius_km, age_min, age_max, interest_tags[]}
  ADD COLUMN IF NOT EXISTS refunded_amount_cents integer NOT NULL DEFAULT 0;        -- pro-rata refund on mid-boost cancel

-- Richer status machine (adds pending_payment / completed / refunded).
DO $$ BEGIN
  ALTER TABLE public.event_spotlight_campaigns DROP CONSTRAINT IF EXISTS event_spotlight_campaigns_status_check;
  ALTER TABLE public.event_spotlight_campaigns ADD CONSTRAINT event_spotlight_campaigns_status_check
    CHECK (status IN ('pending','pending_payment','active','paused','expired','cancelled','completed','refunded'));
EXCEPTION WHEN others THEN NULL; END $$;

-- Richer placements (adds discovery_grid / search_top / nearby alongside the legacy values).
DO $$ BEGIN
  ALTER TABLE public.event_spotlight_campaigns DROP CONSTRAINT IF EXISTS event_spotlight_campaigns_placement_check;
  ALTER TABLE public.event_spotlight_campaigns ADD CONSTRAINT event_spotlight_campaigns_placement_check
    CHECK (placement IN ('spotlight','feed','spotlight+feed','discovery_grid','search_top','nearby'));
EXCEPTION WHEN others THEN NULL; END $$;

-- Cap: at most ONE active/pending boost per event.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_boost_per_event
  ON public.event_spotlight_campaigns (event_id)
  WHERE status IN ('pending_payment','active');

-- Refund accounting can't exceed what was paid.
DO $$ BEGIN
  ALTER TABLE public.event_spotlight_campaigns DROP CONSTRAINT IF EXISTS event_spotlight_campaigns_refund_check;
  ALTER TABLE public.event_spotlight_campaigns ADD CONSTRAINT event_spotlight_campaigns_refund_check
    CHECK (refunded_amount_cents >= 0 AND refunded_amount_cents <= amount_cents);
EXCEPTION WHEN others THEN NULL; END $$;

-- Guard: a boost can't go ACTIVE for a cancelled or already-ended event.
CREATE OR REPLACE FUNCTION public.guard_boost_event_eligible()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF NEW.status = 'active' THEN
    SELECT status INTO v_status FROM public.events WHERE id = NEW.event_id;
    IF v_status = 'cancelled' THEN
      RAISE EXCEPTION 'boost_event_cancelled: cannot boost a cancelled event (%).', NEW.event_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- the boost window itself must be in the future
    IF NEW.ends_at <= now() THEN
      RAISE EXCEPTION 'boost_window_past: boost end % is not in the future.', NEW.ends_at
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_boost_event_eligible ON public.event_spotlight_campaigns;
CREATE TRIGGER trg_boost_event_eligible
  BEFORE INSERT OR UPDATE OF status ON public.event_spotlight_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_boost_event_eligible();
