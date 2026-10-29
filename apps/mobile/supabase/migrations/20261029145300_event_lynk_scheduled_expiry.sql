-- Apply ONLY after the updated process-event-lynk-lifecycle is deployed and verified.
-- Do not expire scheduled event rooms against their original creation time.
-- Source only: deployment requires separately approved migration application.

CREATE OR REPLACE FUNCTION public.end_expired_video_rooms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids integer[];
BEGIN
  SELECT array(
    SELECT r.id
    FROM public.video_rooms r
    WHERE r.status = 'open'
      AND r.ends_at IS NOT NULL
      AND r.ends_at <= now()
      -- Linked Lynks use their event-shifted plan window, enforced by the
      -- event lifecycle sweep. Calls always retain their connected deadline.
      AND (r.room_kind = 'call' OR NOT EXISTS (
        SELECT 1 FROM public.events e WHERE e.lynk_room_id = r.uuid
      ))
    FOR UPDATE OF r SKIP LOCKED
  )
  INTO v_ids;

  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.video_room_members
  SET status = 'left',
      left_at = now(),
      hand_raised = false
  WHERE room_id = ANY(v_ids)
    AND status = 'active';

  INSERT INTO public.video_room_events(room_id, type, actor_id, payload)
  SELECT
    r.id,
    'room_ended',
    r.created_by,
    jsonb_build_object('reason', 'session_expired')
  FROM public.video_rooms r
  WHERE r.id = ANY(v_ids);

  UPDATE public.video_rooms
  SET status = 'ended',
      ended_at = now(),
      participant_count = 0
  WHERE id = ANY(v_ids)
    AND status = 'open';

  RETURN coalesce(array_length(v_ids, 1), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.end_expired_video_rooms()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_expired_video_rooms()
  TO service_role;


