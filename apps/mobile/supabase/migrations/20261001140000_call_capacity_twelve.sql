-- Two changes, both so a 12-person group chat can actually get on one call.
--
-- First, seats. Capacity still comes from the room's own max_participants;
-- only the fallback moves from 10 to 12, matching CALL_HUMAN_CAPACITY in
-- supabase/functions/_shared/call-capacity.ts (the provider room is created
-- with CALL_PROVIDER_MAX_PEERS = 14, two peers of headroom for stale
-- reconnects). Open call rooms created under the ten-seat rule are raised to
-- 12 so a live call does not refuse the eleventh person, and the column
-- default moves to 12 as well so the number 10 is gone from the schema.
--
-- Second, the lease window, which is a live bug rather than a limit.
-- begin_call_media held the per-room provisioning lease for 90 seconds, but
-- call-media.ts declares the lease is CALL_MEDIA_LEASE_SECONDS = 55 and gives
-- up polling for a pending lease after 80 seconds. A provisioner that crashed
-- or hung between begin_call_media and finish_call_media therefore kept the
-- room locked for longer than any other joiner would ever wait: in a 12-way
-- join storm, every joiner behind the dead lease burned its 80 seconds and
-- returned call_join_pending. The lease is now 55 seconds, inside the 80-second
-- poll window, so the next joiner takes the room over instead of timing out.
-- The function body is otherwise the one from 20260905121000_call_admission.sql.
--
-- Rollback: re-run 20261001120000_call_capacity_ten.sql to restore the 10-seat
-- fallback, re-run the begin_call_media body from
-- 20260905121000_call_admission.sql to restore the 90-second lease, and
-- ALTER TABLE public.video_rooms ALTER COLUMN max_participants SET DEFAULT 10.
-- The backfilled max_participants values are left as-is by that rollback;
-- lowering them is a separate deliberate write, and rooms above the fallback
-- are already what admission reads anyway.
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
  v_max := COALESCE(v_room.max_participants, 12);
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

-- Existing open call rooms were created under the ten-seat rule; give them the
-- same capacity as new rooms. Bounded by room_kind/status, and the predicate
-- makes a re-run a no-op.
UPDATE public.video_rooms
SET max_participants = 12
WHERE room_kind = 'call' AND status = 'open' AND max_participants < 12;

-- The column default has been 10 since 20260213100001_video_rooms_schema.sql
-- and no later migration moved it, so it was the last place still saying 10.
-- It is a table-wide default shared with Lynk rooms, but Lynk capacity is
-- resolved from the subscription tier and written explicitly on every insert by
-- the video_create_room edge function, which is the only writer of this table;
-- nothing inserts a video_rooms row without a max_participants value, so no
-- Lynk room ever receives this default. Catalog-only change, no table rewrite.
ALTER TABLE public.video_rooms ALTER COLUMN max_participants SET DEFAULT 12;

-- Lease interval 90s -> 55s. Everything else is verbatim: the FOR UPDATE room
-- lock, the call_join_pending early return, the newly_active stale-seat
-- reclamation, the lease delete, the v_active probe, the admit_call_participant
-- delegation, the lease upsert, and the returned jsonb shape.
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
    VALUES(v_room.id, p_lease_id, p_user_id, clock_timestamp() + interval '55 seconds', NOT v_active)
    ON CONFLICT(room_id) DO UPDATE SET lease_id=excluded.lease_id, user_id=excluded.user_id,
      expires_at=excluded.expires_at, newly_active=excluded.newly_active;
  SELECT * INTO v_peer FROM public.call_media_peers WHERE room_id=v_room.id AND user_id=p_user_id;
  RETURN v_admission || jsonb_build_object('roomId', v_room.id, 'fishjamRoomId', v_room.fishjam_room_id,
    'previousPeerId', v_peer.peer_id, 'previousFishjamRoomId', v_peer.fishjam_room_id);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_call_media(uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_call_media(uuid,text,uuid) TO service_role;
