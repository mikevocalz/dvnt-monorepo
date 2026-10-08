-- Personal and group calls are capped at five minutes of connected session time.
--
-- The deadline starts when the first non-host participant successfully commits
-- a Fishjam peer. Ringing time does not count. The one video_rooms.ends_at value
-- is shared by every participant and survives reconnects, so rejoining cannot
-- reset the clock.
--
-- The existing end_expired_video_rooms cron remains the server-side backstop;
-- this migration removes the historical six-hour exemption for room_kind=call.

CREATE OR REPLACE FUNCTION public.finish_call_media(
  p_room_uuid uuid,
  p_lease_id uuid,
  p_fishjam_room_id text DEFAULT NULL,
  p_peer_id text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.video_rooms%ROWTYPE;
  v_lease public.call_media_leases%ROWTYPE;
BEGIN
  SELECT * INTO v_room
  FROM public.video_rooms
  WHERE uuid = p_room_uuid
  FOR UPDATE;

  IF NOT FOUND OR v_room.room_kind <> 'call' THEN
    RETURN false;
  END IF;

  SELECT * INTO v_lease
  FROM public.call_media_leases
  WHERE room_id = v_room.id AND lease_id = p_lease_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_peer_id IS NOT NULL THEN
    IF v_lease.expires_at <= clock_timestamp() OR v_room.status <> 'open' THEN
      RETURN false;
    END IF;

    -- A leave/kick/ban during provider HTTP must not receive a fresh token.
    PERFORM 1
    FROM public.video_room_members
    WHERE room_id = v_room.id
      AND user_id = v_lease.user_id
      AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND OR public.is_user_banned_from_room(v_lease.user_id, v_room.id) THEN
      RETURN false;
    END IF;

    INSERT INTO public.call_media_peers(
      room_id,
      user_id,
      fishjam_room_id,
      peer_id
    )
    VALUES(
      v_room.id,
      v_lease.user_id,
      p_fishjam_room_id,
      p_peer_id
    )
    ON CONFLICT(room_id, user_id) DO UPDATE
    SET fishjam_room_id = excluded.fishjam_room_id,
        peer_id = excluded.peer_id;

    UPDATE public.video_rooms
    SET fishjam_room_id = p_fishjam_room_id,
        ends_at = CASE
          WHEN ends_at IS NULL AND v_lease.user_id <> created_by
            THEN clock_timestamp() + interval '5 minutes'
          ELSE ends_at
        END
    WHERE id = v_room.id;
  ELSIF v_lease.newly_active THEN
    UPDATE public.video_room_members
    SET status = 'left',
        left_at = now()
    WHERE room_id = v_room.id
      AND user_id = v_lease.user_id
      AND status = 'active';
  END IF;

  UPDATE public.video_rooms
  SET participant_count = (
    SELECT count(*)
    FROM public.video_room_members
    WHERE room_id = v_room.id AND status = 'active'
  )
  WHERE id = v_room.id;

  DELETE FROM public.call_media_leases
  WHERE room_id = v_room.id AND lease_id = p_lease_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finish_call_media(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_call_media(uuid, uuid, text, text)
  TO service_role;

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

COMMENT ON COLUMN public.video_rooms.ends_at IS
  'Server-owned session deadline. Calls start a five-minute deadline when the first non-host peer connects; tier-limited Lynks set their own deadline. NULL means no active limit.';
