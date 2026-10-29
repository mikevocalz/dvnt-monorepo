-- Apply this prerequisite before deploying the updated event lifecycle sweep.
-- Same row lock as the generic expiry sweep: a new event cannot attach a room
-- which expired while the client was preparing/publishing its draft.
CREATE OR REPLACE FUNCTION public.validate_event_lynk_room()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_room public.video_rooms%ROWTYPE;
BEGIN
  IF NEW.lynk_room_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.lynk_room_id IS NOT DISTINCT FROM OLD.lynk_room_id
    AND NEW.host_id IS NOT DISTINCT FROM OLD.host_id THEN RETURN NEW; END IF;
  SELECT * INTO v_room FROM public.video_rooms WHERE uuid = NEW.lynk_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.room_kind IS DISTINCT FROM 'lynk'
    OR v_room.created_by IS DISTINCT FROM NEW.host_id OR v_room.is_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'The event host must own this private Sneaky Lynk room' USING ERRCODE = '42501';
  END IF;
  IF v_room.status IS DISTINCT FROM 'open' OR v_room.ends_at <= now() THEN
    RAISE EXCEPTION 'This Sneaky Lynk room is no longer available. Prepare a new room before publishing.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE lynk_room_id = NEW.lynk_room_id AND id <> NEW.id) THEN
    RAISE EXCEPTION 'This room is already attached to another event' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_event_lynk_room ON public.events;
CREATE TRIGGER validate_event_lynk_room BEFORE INSERT OR UPDATE OF lynk_room_id, host_id
  ON public.events FOR EACH ROW EXECUTE FUNCTION public.validate_event_lynk_room();

-- Atomic event-room cleanup. Recheck the effective deadline under locks so a
-- concurrent postponement/relink cannot be closed by a stale cron decision.
CREATE OR REPLACE FUNCTION public.expire_event_lynk_room(p_event_id integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  e public.events%ROWTYPE;
  r public.video_rooms%ROWTYPE;
  duration_end timestamptz;
  effective_end timestamptz;
  did_end boolean;
BEGIN
  SELECT * INTO e FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR e.lynk_room_id IS NULL THEN RETURN false; END IF;
  SELECT * INTO r FROM public.video_rooms WHERE uuid = e.lynk_room_id FOR UPDATE;
  IF NOT FOUND OR r.room_kind IS DISTINCT FROM 'lynk' THEN RETURN false; END IF;
  IF e.start_date IS NULL AND coalesce(e.status, '') NOT IN ('cancelled','deleted') THEN RETURN false; END IF;
  duration_end := r.ends_at;
  IF r.ends_at IS NOT NULL AND r.created_at IS NOT NULL THEN
    duration_end := greatest(e.start_date, r.created_at) + greatest(interval '0', r.ends_at - r.created_at);
  END IF;
  IF e.end_date IS NOT NULL THEN
    effective_end := least(e.end_date, duration_end);
  ELSE
    effective_end := greatest(e.start_date + interval '6 hours', duration_end);
  END IF;
  IF coalesce(e.status, '') NOT IN ('cancelled','deleted') AND r.status = 'open' AND now() < effective_end THEN
    RETURN false;
  END IF;
  did_end := r.status = 'open';
  UPDATE public.video_rooms SET status = 'ended', ended_at = coalesce(ended_at, now()), participant_count = 0 WHERE id = r.id;
  UPDATE public.video_room_members SET status = 'left', left_at = now(), hand_raised = false
    WHERE room_id = r.id AND status = 'active';
  UPDATE public.video_room_tokens SET is_revoked = true, revoked_at = coalesce(revoked_at, now())
    WHERE room_id = r.id AND (is_revoked IS DISTINCT FROM true OR revoked_at IS NULL);
  IF did_end THEN
    INSERT INTO public.video_room_events(room_id, type, actor_id, payload)
      VALUES(r.id, 'room_ended', r.created_by, jsonb_build_object('reason', 'event_session_expired'));
  END IF;
  UPDATE public.event_lynk_lifecycle SET
    state = CASE WHEN e.status IN ('cancelled','deleted') THEN 'cancelled' ELSE 'ended' END,
    ended_at = coalesce(ended_at, now()), updated_at = now() WHERE event_id = e.id;
  RETURN did_end;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_event_lynk_room(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_event_lynk_room(integer) TO service_role;
