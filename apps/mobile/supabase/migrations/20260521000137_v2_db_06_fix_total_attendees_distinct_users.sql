-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260521000137 :: v2_db_06_fix_total_attendees_distinct_users). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- ============================================================
-- v2-db-06 — total_attendees counts DISTINCT users, not tickets
-- ============================================================
-- The previous trigger incremented by 1 per ticket row. A buyer
-- purchasing GA + VIP on the same event would bump the counter by
-- 2, producing a "going" badge that didn't match the actual list of
-- unique attendees shown to viewers. Replace with a recompute that
-- counts distinct user_ids across tickets (active) UNION
-- event_rsvps (going). Same logic fires from a parallel trigger on
-- event_rsvps so RSVPs are counted too.

CREATE OR REPLACE FUNCTION public.recompute_event_total_attendees(
  p_event_id integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE events
  SET total_attendees = (
    SELECT count(DISTINCT u)
    FROM (
      SELECT user_id::text AS u FROM tickets
        WHERE event_id = p_event_id AND status = 'active'
      UNION
      SELECT user_id::text AS u FROM event_rsvps
        WHERE event_id = p_event_id AND status = 'going'
    ) merged
  )
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.maintain_event_total_attendees()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id integer;
BEGIN
  v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  IF v_event_id IS NOT NULL THEN
    PERFORM public.recompute_event_total_attendees(v_event_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_event_total_attendees ON public.tickets;
CREATE TRIGGER trg_maintain_event_total_attendees
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.maintain_event_total_attendees();

DROP TRIGGER IF EXISTS trg_maintain_event_total_attendees_rsvps ON public.event_rsvps;
CREATE TRIGGER trg_maintain_event_total_attendees_rsvps
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.maintain_event_total_attendees();

-- Backfill every event so existing rows align with the new rule.
UPDATE events e
SET total_attendees = (
  SELECT count(DISTINCT u)
  FROM (
    SELECT user_id::text AS u FROM tickets
      WHERE event_id = e.id AND status = 'active'
    UNION
    SELECT user_id::text AS u FROM event_rsvps
      WHERE event_id = e.id AND status = 'going'
  ) merged
);;
