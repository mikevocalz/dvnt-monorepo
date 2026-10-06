-- Public event "going" counts must represent people/seats, not distinct account holders.
--
-- Why:
--   * guest checkout tickets have user_id = NULL, so COUNT(DISTINCT user_id)
--     drops them entirely;
--   * one purchaser can buy multiple tickets for multiple attendees, so
--     collapsing by purchaser also undercounts attendance;
--   * RSVP-only members should still count, but must not double-count once they
--     hold a valid ticket.
--
-- Product invariant:
--   going = valid ticket rows + RSVP-only users without a valid ticket.
-- Valid ticket statuses are active/scanned/transfer_pending. Refunded/void do
-- not count. This preserves the seat even after check-in.
BEGIN;

CREATE OR REPLACE FUNCTION public.event_people_going_count(p_event_id integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH ticket_count AS (
    SELECT count(*)::integer AS n
    FROM public.tickets t
    WHERE t.event_id = p_event_id
      AND t.status IN ('active', 'scanned', 'transfer_pending')
  ),
  rsvp_only AS (
    SELECT count(DISTINCT r.user_id)::integer AS n
    FROM public.event_rsvps r
    WHERE r.event_id = p_event_id
      AND r.status = 'going'
      AND r.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.tickets t
        WHERE t.event_id = p_event_id
          AND t.user_id = r.user_id
          AND t.status IN ('active', 'scanned', 'transfer_pending')
      )
  )
  SELECT COALESCE((SELECT n FROM ticket_count), 0)
       + COALESCE((SELECT n FROM rsvp_only), 0);
$$;

CREATE OR REPLACE FUNCTION public.recompute_event_total_attendees(
  p_event_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.events
  SET total_attendees = public.event_people_going_count(p_event_id)
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.maintain_event_total_attendees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_new_event_id integer;
  v_old_event_id integer;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_new_event_id := NEW.event_id;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old_event_id := OLD.event_id;
  END IF;

  IF v_old_event_id IS NOT NULL THEN
    PERFORM public.recompute_event_total_attendees(v_old_event_id);
  END IF;

  IF v_new_event_id IS NOT NULL
     AND v_new_event_id IS DISTINCT FROM v_old_event_id THEN
    PERFORM public.recompute_event_total_attendees(v_new_event_id);
  ELSIF TG_OP = 'INSERT' AND v_new_event_id IS NOT NULL THEN
    PERFORM public.recompute_event_total_attendees(v_new_event_id);
  END IF;

  -- AFTER trigger return value is ignored; NULL avoids touching NEW on DELETE.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintain_event_total_attendees ON public.tickets;
CREATE TRIGGER trg_maintain_event_total_attendees
  AFTER INSERT OR DELETE OR UPDATE OF status, event_id, user_id
  ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.maintain_event_total_attendees();

DROP TRIGGER IF EXISTS trg_maintain_event_total_attendees_rsvps ON public.event_rsvps;
CREATE TRIGGER trg_maintain_event_total_attendees_rsvps
  AFTER INSERT OR DELETE OR UPDATE OF status, event_id, user_id
  ON public.event_rsvps
  FOR EACH ROW
  EXECUTE FUNCTION public.maintain_event_total_attendees();

-- Repair every existing public count immediately on deploy.
UPDATE public.events e
SET total_attendees = public.event_people_going_count(e.id);

REVOKE ALL ON FUNCTION public.event_people_going_count(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_event_total_attendees(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.maintain_event_total_attendees() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.event_people_going_count(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_event_total_attendees(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.maintain_event_total_attendees() TO service_role;

COMMENT ON FUNCTION public.event_people_going_count(integer) IS
  'Public attendance count: one valid ticket row per attendee/seat plus RSVP-only authenticated users who do not already hold a valid ticket.';

COMMIT;

NOTIFY pgrst, 'reload schema';
