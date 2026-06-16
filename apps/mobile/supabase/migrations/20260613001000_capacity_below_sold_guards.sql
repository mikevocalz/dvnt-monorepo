-- ════════════════════════════════════════════════════════════════════════
-- Phase 2 (live data integrity) — capacity can NEVER be edited below what's
-- already sold. Enforced at the DB level via BEFORE UPDATE triggers so NO path
-- (edge fn, RPC, or direct client update) can bypass it. Additive + idempotent.
--   • tier:  reject quantity_total < quantity_sold
--   • event: reject max_attendees < sum(tier quantity_sold)
-- NOT YET APPLIED TO PRODUCTION — awaiting explicit Wave-2 authorization.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.guard_tier_capacity_not_below_sold()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.quantity_total IS NOT NULL
     AND NEW.quantity_total < COALESCE(NEW.quantity_sold, 0) THEN
    RAISE EXCEPTION 'capacity_below_sold: tier % cannot set quantity_total=% below quantity_sold=%',
      NEW.id, NEW.quantity_total, COALESCE(NEW.quantity_sold, 0)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tier_capacity_guard ON public.ticket_types;
CREATE TRIGGER trg_tier_capacity_guard
  BEFORE UPDATE OF quantity_total ON public.ticket_types
  FOR EACH ROW EXECUTE FUNCTION public.guard_tier_capacity_not_below_sold();

CREATE OR REPLACE FUNCTION public.guard_event_capacity_not_below_sold()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_sold numeric;
BEGIN
  IF NEW.max_attendees IS NOT NULL THEN
    SELECT COALESCE(sum(COALESCE(quantity_sold, 0)), 0) INTO v_sold
    FROM public.ticket_types WHERE event_id = NEW.id;
    IF NEW.max_attendees < v_sold THEN
      RAISE EXCEPTION 'capacity_below_sold: event % cannot set max_attendees=% below sold=%',
        NEW.id, NEW.max_attendees, v_sold
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_capacity_guard ON public.events;
CREATE TRIGGER trg_event_capacity_guard
  BEFORE UPDATE OF max_attendees ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_capacity_not_below_sold();
