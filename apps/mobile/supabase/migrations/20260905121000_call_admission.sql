-- Call admission serializes on the room row. Existing Lynk admission is unchanged.
-- Deploy before the call-aware edge functions. Rollback: restore the prior edge
-- functions, then drop begin_call_media(uuid,text,uuid),
-- finish_call_media(uuid,uuid,text,text), admit_call_participant(uuid,text),
-- and the call_media_peers/call_media_leases tables. The isolated regression
-- harness exercises this rollback without touching existing room/member rows.
-- No historical rooms or membership rows are rewritten.
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
  IF v_count >= 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'call_full', 'current', v_count, 'max', 4);
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

-- The lease spans provider HTTP requests; peer IDs are server-owned so a
-- reconnect can remove its previous peer before minting a replacement.
CREATE TABLE IF NOT EXISTS public.call_media_leases (
  room_id integer PRIMARY KEY REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  newly_active boolean NOT NULL
);
CREATE TABLE IF NOT EXISTS public.call_media_peers (
  room_id integer NOT NULL REFERENCES public.video_rooms(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  fishjam_room_id text NOT NULL,
  peer_id text NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE public.call_media_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_media_peers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_media_leases, public.call_media_peers FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.begin_call_media(p_room_uuid uuid, p_user_id text, p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_room public.video_rooms%ROWTYPE;
  v_lease public.call_media_leases%ROWTYPE;
  v_peer public.call_media_peers%ROWTYPE;
  v_admission jsonb;
  v_active boolean;
BEGIN
  SELECT * INTO v_room FROM public.video_rooms WHERE uuid = p_room_uuid FOR UPDATE;
  IF NOT FOUND OR v_room.room_kind <> 'call' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  SELECT * INTO v_lease FROM public.call_media_leases WHERE room_id = v_room.id;
  IF FOUND AND v_lease.expires_at > clock_timestamp() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'call_join_pending');
  END IF;
  IF v_lease.newly_active THEN
    UPDATE public.video_room_members SET status = 'left', left_at = now()
      WHERE room_id = v_room.id AND user_id = v_lease.user_id AND status = 'active';
    UPDATE public.video_rooms SET participant_count=(SELECT count(*) FROM public.video_room_members
      WHERE room_id=v_room.id AND status='active') WHERE id=v_room.id;
  END IF;
  DELETE FROM public.call_media_leases WHERE room_id=v_room.id;
  SELECT EXISTS(SELECT 1 FROM public.video_room_members WHERE room_id = v_room.id
    AND user_id = p_user_id AND status = 'active') INTO v_active;
  v_admission := public.admit_call_participant(p_room_uuid, p_user_id);
  IF NOT (v_admission->>'ok')::boolean THEN RETURN v_admission; END IF;
  INSERT INTO public.call_media_leases(room_id, lease_id, user_id, expires_at, newly_active)
    VALUES(v_room.id, p_lease_id, p_user_id, clock_timestamp() + interval '90 seconds', NOT v_active)
    ON CONFLICT(room_id) DO UPDATE SET lease_id=excluded.lease_id, user_id=excluded.user_id,
      expires_at=excluded.expires_at, newly_active=excluded.newly_active;
  SELECT * INTO v_peer FROM public.call_media_peers WHERE room_id=v_room.id AND user_id=p_user_id;
  RETURN v_admission || jsonb_build_object('roomId', v_room.id, 'fishjamRoomId', v_room.fishjam_room_id,
    'previousPeerId', v_peer.peer_id, 'previousFishjamRoomId', v_peer.fishjam_room_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_call_media(
  p_room_uuid uuid, p_lease_id uuid, p_fishjam_room_id text DEFAULT NULL, p_peer_id text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_room public.video_rooms%ROWTYPE;
  v_lease public.call_media_leases%ROWTYPE;
BEGIN
  SELECT * INTO v_room FROM public.video_rooms WHERE uuid=p_room_uuid FOR UPDATE;
  IF NOT FOUND OR v_room.room_kind <> 'call' THEN RETURN false; END IF;
  SELECT * INTO v_lease FROM public.call_media_leases WHERE room_id=v_room.id AND lease_id=p_lease_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_peer_id IS NOT NULL THEN
    IF v_lease.expires_at <= clock_timestamp() OR v_room.status <> 'open' THEN RETURN false; END IF;
    -- A leave/kick/ban during provider HTTP must not receive a fresh token.
    PERFORM 1 FROM public.video_room_members WHERE room_id=v_room.id
      AND user_id=v_lease.user_id AND status='active' FOR UPDATE;
    IF NOT FOUND OR public.is_user_banned_from_room(v_lease.user_id, v_room.id) THEN RETURN false; END IF;
    INSERT INTO public.call_media_peers(room_id,user_id,fishjam_room_id,peer_id)
      VALUES(v_room.id,v_lease.user_id,p_fishjam_room_id,p_peer_id)
      ON CONFLICT(room_id,user_id) DO UPDATE SET fishjam_room_id=excluded.fishjam_room_id,peer_id=excluded.peer_id;
    UPDATE public.video_rooms SET fishjam_room_id=p_fishjam_room_id WHERE id=v_room.id;
  ELSIF v_lease.newly_active THEN
    UPDATE public.video_room_members SET status='left',left_at=now()
      WHERE room_id=v_room.id AND user_id=v_lease.user_id AND status='active';
  END IF;
  UPDATE public.video_rooms SET participant_count=(SELECT count(*) FROM public.video_room_members
    WHERE room_id=v_room.id AND status='active') WHERE id=v_room.id;
  DELETE FROM public.call_media_leases WHERE room_id=v_room.id AND lease_id=p_lease_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_call_media(uuid,text,uuid), public.finish_call_media(uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_call_media(uuid,text,uuid), public.finish_call_media(uuid,uuid,text,text)
  TO service_role;
