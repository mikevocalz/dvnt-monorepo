-- One transaction owns Sneaky Lynk admission, capacity and anonymous labels.
-- Only service-role server endpoints can call this RPC. Browser/native clients
-- cannot bypass ticket, age, invite, creator-standing or moderation checks.
-- Deploy this migration BEFORE deploying the updated video_join_room function.
BEGIN;

CREATE OR REPLACE FUNCTION public.lynk_admit_member_atomic(
  p_room_id integer,
  p_user_id text,
  p_anonymous boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_room public.video_rooms%ROWTYPE;
  v_member public.video_room_members%ROWTYPE;
  v_current integer;
  v_label text;
  v_next_label integer;
  v_anonymous boolean;
BEGIN
  IF p_room_id IS NULL OR nullif(btrim(p_user_id), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  -- Lock the parent room for the whole read/check/write, including room-end
  -- transitions that update this row. A second caller must see the first
  -- caller's committed membership before checking capacity or alias numbers.
  SELECT * INTO v_room
    FROM public.video_rooms
    WHERE id = p_room_id
    FOR UPDATE;
  IF NOT FOUND OR v_room.room_kind = 'call' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_not_found');
  END IF;
  IF v_room.status IS DISTINCT FROM 'open'
     OR (v_room.ends_at IS NOT NULL AND v_room.ends_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;

  -- Recheck bans while holding the room lock; the edge function already
  -- checked authorization, event entitlement and creator standing.
  IF EXISTS (
    SELECT 1 FROM public.video_room_bans b
    WHERE b.room_id = p_room_id AND b.user_id = p_user_id
      AND (b.expires_at IS NULL OR b.expires_at > now())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'member_banned');
  END IF;

  SELECT * INTO v_member
    FROM public.video_room_members
    WHERE room_id = p_room_id AND user_id = p_user_id
    FOR UPDATE;
  IF v_member.id IS NOT NULL AND v_member.status = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'member_banned');
  END IF;

  SELECT count(*)::integer INTO v_current
    FROM public.video_room_members
    WHERE room_id = p_room_id AND status = 'active';

  -- Reconnecting an ACTIVE membership cannot consume a second seat and
  -- cannot turn an anonymous identity into an attributable one by silently
  -- flipping the client's anonymous flag on token refresh.
  IF v_member.id IS NULL OR v_member.status IS DISTINCT FROM 'active' THEN
    IF v_room.max_participants IS NOT NULL
       AND v_current >= v_room.max_participants THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'room_full',
        'current', v_current, 'max', v_room.max_participants
      );
    END IF;
  END IF;

  v_anonymous := CASE
    WHEN v_member.id IS NOT NULL AND v_member.status = 'active'
      THEN v_member.is_anonymous
    ELSE coalesce(p_anonymous, false)
  END;

  IF v_anonymous THEN
    -- Retain a returning member's existing alias when it remains unambiguous.
    -- Pick the next number from ALL historical labels, not a count of rows:
    -- deletes, leaves and simultaneous joins must never recycle aliases.
    IF nullif(btrim(v_member.anon_label), '') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.video_room_members other
         WHERE other.room_id = p_room_id
           AND other.id IS DISTINCT FROM v_member.id
           AND other.is_anonymous
           AND lower(btrim(other.anon_label)) = lower(btrim(v_member.anon_label))
       )
    THEN
      v_label := v_member.anon_label;
    ELSE
      SELECT coalesce(max(
        regexp_replace(lower(btrim(m.anon_label)), '^anon( lynk)? ', '')::integer
      ), 0) + 1
      INTO v_next_label
      FROM public.video_room_members m
      WHERE m.room_id = p_room_id
        AND lower(btrim(m.anon_label)) ~ '^anon( lynk)? [0-9]{1,8}$';
      v_label := 'Anon ' || v_next_label::text;
    END IF;
  ELSE
    v_label := NULL;
  END IF;

  IF v_member.id IS NOT NULL THEN
    -- For active members, keep role, joined_at, and anonymous mode stable.
    -- For returning left/kicked members, match prior explicit rejoin semantics.
    UPDATE public.video_room_members
    SET status = 'active',
        joined_at = CASE WHEN status = 'active' THEN joined_at ELSE now() END,
        left_at = NULL,
        hand_raised = CASE WHEN status = 'active' THEN hand_raised ELSE false END,
        is_anonymous = v_anonymous,
        anon_label = v_label
    WHERE id = v_member.id
    RETURNING * INTO v_member;
  ELSE
    INSERT INTO public.video_room_members (
      room_id, user_id, role, status, hand_raised, is_anonymous, anon_label
    ) VALUES (
      p_room_id, p_user_id, 'participant', 'active', false, v_anonymous, v_label
    ) RETURNING * INTO v_member;
  END IF;

  SELECT count(*)::integer INTO v_current
    FROM public.video_room_members
    WHERE room_id = p_room_id AND status = 'active';
  UPDATE public.video_rooms
    SET participant_count = v_current
    WHERE id = p_room_id;

  RETURN jsonb_build_object(
    'ok', true, 'memberRole', v_member.role,
    'isAnonymous', v_member.is_anonymous, 'anonLabel', v_member.anon_label,
    'current', v_current, 'max', v_room.max_participants
  );
END;
$function$;

-- Function lives in public only because Supabase RPC uses the exposed schema.
-- SECURITY DEFINER is never a public authorization bypass.
REVOKE ALL ON FUNCTION public.lynk_admit_member_atomic(integer, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lynk_admit_member_atomic(integer, text, boolean)
  TO service_role;


-- Accepting a co-host invite also allocates a seat. It must use the same lock
-- and capacity allocator as an ordinary join; an invite is not a capacity
-- override, and a decline or an already-resolved invite grants nothing.
CREATE OR REPLACE FUNCTION public.lynk_accept_cohost_atomic(
  p_invite_id integer,
  p_user_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_room_id integer;
  v_room public.video_rooms%ROWTYPE;
  v_invite public.lynk_cohost_invites%ROWTYPE;
  v_admission jsonb;
BEGIN
  IF p_invite_id IS NULL OR nullif(btrim(p_user_id), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;
  -- First find the parent lock key. Pending status and recipient are checked
  -- again AFTER the lock, so two accepting devices cannot both accept.
  SELECT room_id INTO v_room_id
  FROM public.lynk_cohost_invites WHERE id = p_invite_id;
  IF v_room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invite_not_found');
  END IF;
  SELECT * INTO v_room FROM public.video_rooms
    WHERE id = v_room_id FOR UPDATE;
  IF NOT FOUND OR v_room.room_kind IS DISTINCT FROM 'lynk'
     OR v_room.status IS DISTINCT FROM 'open'
     OR (v_room.ends_at IS NOT NULL AND v_room.ends_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'room_ended');
  END IF;
  SELECT * INTO v_invite FROM public.lynk_cohost_invites
    WHERE id = p_invite_id FOR UPDATE;
  IF v_invite.id IS NULL OR v_invite.room_id IS DISTINCT FROM v_room_id
     OR v_invite.invitee_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invite_not_found');
  END IF;
  IF v_invite.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invite_resolved');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.video_room_members
    WHERE room_id=v_room_id AND user_id=p_user_id
      AND status IN ('banned','kicked')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'member_banned');
  END IF;

  v_admission := public.lynk_admit_member_atomic(v_room_id,p_user_id,false);
  IF coalesce((v_admission->>'ok')::boolean,false) IS NOT TRUE THEN
    RETURN v_admission;
  END IF;

  UPDATE public.video_room_members SET role='co-host'
    WHERE room_id=v_room_id AND user_id=p_user_id
      AND role IS DISTINCT FROM 'host';
  UPDATE public.lynk_cohost_invites
    SET status='accepted', responded_at=now()
    WHERE id=p_invite_id;

  RETURN jsonb_build_object(
    'ok', true, 'role', 'co-host', 'roomId', v_room.uuid,
    'current', v_admission->'current'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.lynk_accept_cohost_atomic(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lynk_accept_cohost_atomic(integer, text)
  TO service_role;

COMMIT;
