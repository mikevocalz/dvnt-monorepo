-- SOURCE-ONLY: legacy-readable copy does not supply review UI to old native builds.
-- Keep producer activation held until native compatibility release checks pass.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Only a new pending request or a genuine pending -> approved transition emits
-- activity. It commits or rolls back with the relationship operation, rather
-- than relying on a fire-and-forget Edge insert. Repeated Follow/Approve calls
-- therefore cannot duplicate the notification. Existing follows are untouched.
CREATE OR REPLACE FUNCTION public.guard_follow_request_block()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.blocks b
    WHERE (b.blocker_id=NEW.follower_id AND b.blocked_id=NEW.following_id)
       OR (b.blocker_id=NEW.following_id AND b.blocked_id=NEW.follower_id)) THEN
    RAISE EXCEPTION 'This follow request is unavailable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_follow_request_block() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER follow_requests_block_guard BEFORE INSERT OR UPDATE
  ON public.follow_requests FOR EACH ROW EXECUTE FUNCTION public.guard_follow_request_block();

CREATE OR REPLACE FUNCTION public.notify_follow_request_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    -- Cancellation, decline, or retirement removes an actionable request. An
    -- approval notification is historical activity, not an access grant.
    DELETE FROM public.notifications WHERE (type='follow_request' OR (type='system' AND entity_payload->>'semantic_type'='follow_request'))
      AND recipient_id=OLD.following_id AND actor_id=OLD.follower_id;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND (OLD.follower_id,OLD.following_id)
      IS DISTINCT FROM (NEW.follower_id,NEW.following_id) THEN
    RAISE EXCEPTION 'Follow request identities cannot be changed' USING ERRCODE='22023';
  END IF;
  IF TG_OP='INSERT' AND NEW.status='pending' THEN
    INSERT INTO public.notifications(recipient_id,actor_id,type,entity_type,entity_id,entity_payload)
      VALUES(NEW.following_id,NEW.follower_id,'system','user',NEW.follower_id::text,
        jsonb_build_object('semantic_type','follow_request','title',coalesce((SELECT username FROM public.users WHERE id=NEW.follower_id),'Someone') || ' requested to follow you',
          'body','Someone requested to follow you. To review, open dvntapp.live in your browser and go to Settings > Privacy > Follow requests.',
          'url','/settings/privacy#follow-requests'));
  ELSIF TG_OP='UPDATE' AND OLD.status='pending' AND NEW.status='approved' THEN
    DELETE FROM public.notifications WHERE (type='follow_request' OR (type='system' AND entity_payload->>'semantic_type'='follow_request'))
      AND recipient_id=NEW.following_id AND actor_id=NEW.follower_id;
    INSERT INTO public.notifications(recipient_id,actor_id,type,entity_type,entity_id,entity_payload)
      VALUES(NEW.follower_id,NEW.following_id,'system','user',NEW.following_id::text,
        jsonb_build_object('semantic_type','follow_request_approved','title',coalesce((SELECT username FROM public.users WHERE id=NEW.following_id),'A member') || ' accepted your follow request',
          'body','Your follow request was accepted. Open this member’s profile to view it.'));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_follow_request_transition() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER follow_requests_notify_transition AFTER INSERT OR UPDATE OR DELETE
  ON public.follow_requests FOR EACH ROW EXECUTE FUNCTION public.notify_follow_request_transition();
-- Preserve the existing locked mutation and return exact committed transition
-- hints for best-effort push. The durable in-app activity is created above.
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
    IF v_ready AND v_private AND NOT public.private_follow_authorized(p_actor,p_target) AND v_status IS DISTINCT FROM 'approved' THEN
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
NOTIFY pgrst, 'reload schema';
