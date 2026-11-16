-- All NEW follow relationships require recipient approval, including public
-- profiles. Existing follows and acceptance grants remain unchanged. Public
-- non-Spicy posts remain public; age/block/post visibility gates still apply.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Serialize with writers, then require the existing preservation cutover.
LOCK TABLE public.users,public.user_settings,public.follows,public.blocks IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' AND ready AND read_gate_version=1) THEN
  RAISE EXCEPTION 'Activate existing follow preservation before all-follow approval';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_follow_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_ready boolean;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Follow mutations require READ COMMITTED isolation; retry in a fresh transaction' USING ERRCODE='40001';
  END IF;
  -- A REPEATABLE READ writer with a pre-cutover snapshot must serialize/fail,
  -- not carry ready=false through a queued insert after activation.
  SELECT ready INTO v_ready FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow compatibility schema is not ready' USING ERRCODE='55000'; END IF;
  IF NOT v_ready THEN RETURN NEW; END IF;
  PERFORM id FROM public.users WHERE id IN (NEW.follower_id,NEW.following_id) ORDER BY id FOR UPDATE;
  IF NOT public.private_follow_authorized(NEW.follower_id,NEW.following_id)
    AND NOT EXISTS(SELECT 1 FROM public.follow_requests WHERE follower_id=NEW.follower_id
      AND following_id=NEW.following_id AND status='approved') THEN
    INSERT INTO public.follow_requests(follower_id,following_id,status) VALUES(NEW.follower_id,NEW.following_id,'pending')
      ON CONFLICT(follower_id,following_id) DO NOTHING;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_follow_insert() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.mutate_follow_relationship(p_actor bigint, p_target bigint, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_private boolean; v_status text; v_following boolean; v_changed boolean := false; v_notify_request boolean := false; v_notification_version timestamptz; v_ready boolean;
BEGIN
  IF p_actor IS NULL OR p_target IS NULL OR p_actor=p_target OR p_action IS NULL OR p_action NOT IN ('follow','unfollow','approve','decline','status','toggle') THEN
    RAISE EXCEPTION 'Invalid follow action' USING ERRCODE='22023';
  END IF;
  IF p_action <> 'status' AND current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Follow mutations require READ COMMITTED isolation; retry in a fresh transaction' USING ERRCODE='40001';
  END IF;
  -- Join the cutover write barrier BEFORE reading readiness. A queued new RPC
  -- must re-read the committed switch, never act on a pre-lock legacy flag.
  IF p_action <> 'status' THEN
    LOCK TABLE public.users,public.user_settings,public.follows,public.blocks IN ROW EXCLUSIVE MODE;
  END IF;
  IF p_action='status' THEN
    SELECT ready INTO v_ready FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1';
  ELSE
    SELECT ready INTO v_ready FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' FOR SHARE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow compatibility schema is not ready' USING ERRCODE='55000'; END IF;
  -- All pair operations use the same ordering and serialize cancellation/approval.
  IF p_action <> 'status' THEN
    PERFORM id FROM public.users WHERE id IN (p_actor,p_target) ORDER BY id FOR UPDATE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor) OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_target) THEN
    RAISE EXCEPTION 'Member not found' USING ERRCODE='22023';
  END IF;
  IF p_action IN ('approve','decline') THEN
    -- The caller is the recipient, never a client-supplied owner ID.
    SELECT status INTO v_status FROM public.follow_requests WHERE follower_id=p_target AND following_id=p_actor;
    IF p_action='approve' AND v_status='pending' THEN
      UPDATE public.follow_requests SET status='approved',updated_at=now() WHERE follower_id=p_target AND following_id=p_actor RETURNING updated_at INTO v_notification_version;
      v_changed := FOUND;
      INSERT INTO public.follows(follower_id,following_id) VALUES(p_target,p_actor) ON CONFLICT(follower_id,following_id) DO NOTHING;
    ELSIF p_action='decline' AND v_status='pending' THEN
      DELETE FROM public.follow_requests WHERE follower_id=p_target AND following_id=p_actor;
    END IF;
    RETURN jsonb_build_object('success',true,'notifyApproval',p_action='approve' AND v_changed,'notificationVersion',v_notification_version);
  END IF;
  SELECT coalesce(u.is_private,false) OR coalesce(s.settings#>>'{privacy,privateAccount}','false') <> 'false'
    INTO v_private FROM public.users u LEFT JOIN public.user_settings s ON s.auth_id=u.auth_id WHERE u.id=p_target;
  SELECT status INTO v_status FROM public.follow_requests WHERE follower_id=p_actor AND following_id=p_target;
  IF p_action='toggle' THEN
    -- Only legacy Edge callers with an omitted action use this operation.
    -- Decide after taking both user locks: repeated calls must toggle rather
    -- than race two independent reads into the same follow/request operation.
    -- A pending request is an existing intent to follow, so the next toggle
    -- cancels it. Historical follows also cancel without manufacturing approval.
    p_action := CASE WHEN v_status='pending' OR EXISTS (
      SELECT 1 FROM public.follows WHERE follower_id=p_actor AND following_id=p_target
    ) THEN 'unfollow' ELSE 'follow' END;
  END IF;
  IF p_action='unfollow' THEN
    DELETE FROM public.follows WHERE follower_id=p_actor AND following_id=p_target;
    DELETE FROM public.follow_requests WHERE follower_id=p_actor AND following_id=p_target;
    v_status := NULL;
  ELSIF p_action='follow' THEN
    IF v_ready AND NOT public.private_follow_authorized(p_actor,p_target) AND v_status IS DISTINCT FROM 'approved' THEN
      INSERT INTO public.follow_requests(follower_id,following_id,status) VALUES(p_actor,p_target,'pending') ON CONFLICT(follower_id,following_id) DO NOTHING RETURNING updated_at INTO v_notification_version;
      v_notify_request := FOUND;
      v_status := 'pending';
    ELSE
      INSERT INTO public.follows(follower_id,following_id) VALUES(p_actor,p_target) ON CONFLICT(follower_id,following_id) DO NOTHING;
      v_changed := FOUND;
      -- Public acceptance is recorded by the insert trigger, never as owner approval.
      DELETE FROM public.follow_requests WHERE follower_id=p_actor AND following_id=p_target AND status='pending';
      IF v_status='pending' THEN v_status:=NULL; END IF;
    END IF;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.follows WHERE follower_id=p_actor AND following_id=p_target) AND (NOT v_private OR public.private_follow_authorized(p_actor,p_target)) INTO v_following;
  RETURN jsonb_build_object('following',coalesce(v_following,false),'followRequestStatus',coalesce(v_status,'none'),'notifyFollow',v_changed,'notifyRequest',v_notify_request,'notificationVersion',v_notification_version);
END;
$$;
REVOKE ALL ON FUNCTION public.mutate_follow_relationship(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_follow_relationship(bigint,bigint,text) TO service_role;

COMMIT;
NOTIFY pgrst,'reload schema';
