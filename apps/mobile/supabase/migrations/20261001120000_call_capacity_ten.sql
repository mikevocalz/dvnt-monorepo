-- Calls used to seat four total: admit_call_participant refused the fifth
-- seat with call_full no matter what the room row said, so a group chat
-- larger than four could never all get on the same call. Seat admission now
-- reads the room's own max_participants (video_create_room writes 10 for
-- call rooms), so capacity is decided in exactly one place and a future
-- change needs no function update.
CREATE OR REPLACE FUNCTION public.admit_call_participant(
  p_room_uuid uuid,
  p_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_room public.video_rooms%ROWTYPE;
  v_member public.video_room_members%ROWTYPE;
  v_count integer;
  v_max integer;
BEGIN
  SELECT * INTO v_room FROM public.video_rooms
    WHERE uuid = p_room_uuid FOR UPDATE;
  IF NOT FOUND OR v_room.room_kind <> 'call' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_room.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'call_ended');
  END IF;
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  SELECT * INTO v_member FROM public.video_room_members
    WHERE room_id = v_room.id AND user_id = p_user_id
    ORDER BY id LIMIT 1;
  IF v_member.status IN ('banned', 'kicked') OR
      public.is_user_banned_from_room(p_user_id, v_room.id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;
  IF p_user_id <> v_room.created_by AND v_member.id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.video_room_invites
      WHERE room_id = v_room.id AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invite_only');
  END IF;
  -- An active reconnect consumes no additional seat, even when the call is full.
  IF v_member.status = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'role', v_member.role, 'reconnected', true);
  END IF;
  SELECT count(*) INTO v_count FROM public.video_room_members
    WHERE room_id = v_room.id AND status = 'active';
  v_max := COALESCE(v_room.max_participants, 10);
  IF v_count >= v_max THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'call_full', 'current', v_count, 'max', v_max);
  END IF;
  IF v_member.id IS NULL THEN
    INSERT INTO public.video_room_members (room_id, user_id, role, status)
      VALUES (v_room.id, p_user_id,
        CASE WHEN p_user_id = v_room.created_by THEN 'host' ELSE 'participant' END, 'active')
      RETURNING * INTO v_member;
  ELSE
    UPDATE public.video_room_members SET status = 'active', joined_at = now(),
      left_at = NULL, hand_raised = false, is_anonymous = false, anon_label = NULL
      WHERE id = v_member.id RETURNING * INTO v_member;
  END IF;
  UPDATE public.video_rooms SET participant_count = v_count + 1 WHERE id = v_room.id;
  RETURN jsonb_build_object('ok', true, 'role', v_member.role, 'reconnected', false);
END;
$$;

REVOKE ALL ON FUNCTION public.admit_call_participant(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admit_call_participant(uuid, text) TO service_role;

-- Existing open call rooms were created under the four-seat rule; give them
-- the same capacity as new rooms.
UPDATE public.video_rooms
SET max_participants = 10
WHERE room_kind = 'call' AND status = 'open' AND max_participants < 10;
