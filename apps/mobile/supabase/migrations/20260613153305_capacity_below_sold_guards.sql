-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613153305 :: capacity_below_sold_guards). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

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
  FOR EACH ROW EXECUTE FUNCTION public.guard_event_capacity_not_below_sold();;
