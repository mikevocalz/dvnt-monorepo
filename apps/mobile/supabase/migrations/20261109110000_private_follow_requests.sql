BEGIN;
-- Deliberately no backfill: historical follows never recorded owner approval.
CREATE TABLE IF NOT EXISTS public.follow_requests (
  follower_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  following_id bigint NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX IF NOT EXISTS follow_requests_inbox ON public.follow_requests(following_id, status, created_at);
ALTER TABLE public.follow_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.follow_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.follow_requests TO service_role;

-- Service-only: p_actor is resolved from a verified Better Auth session by Edge.
CREATE OR REPLACE FUNCTION public.mutate_follow_relationship(p_actor bigint, p_target bigint, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_private boolean; v_status text; v_following boolean; v_changed boolean := false;
BEGIN
  IF p_actor IS NULL OR p_target IS NULL OR p_actor=p_target OR p_action NOT IN ('follow','unfollow','approve','decline','status') THEN
    RAISE EXCEPTION 'Invalid follow action' USING ERRCODE='22023';
  END IF;
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
      UPDATE public.follow_requests SET status='approved',updated_at=now() WHERE follower_id=p_target AND following_id=p_actor;
      INSERT INTO public.follows(follower_id,following_id) VALUES(p_target,p_actor) ON CONFLICT(follower_id,following_id) DO NOTHING;
    ELSIF p_action='decline' AND v_status='pending' THEN
      DELETE FROM public.follow_requests WHERE follower_id=p_target AND following_id=p_actor;
    END IF;
    RETURN jsonb_build_object('success',true);
  END IF;
  SELECT coalesce(u.is_private,false) OR coalesce(s.settings#>>'{privacy,privateAccount}','false') <> 'false'
    INTO v_private FROM public.users u LEFT JOIN public.user_settings s ON s.auth_id=u.auth_id WHERE u.id=p_target;
  SELECT status INTO v_status FROM public.follow_requests WHERE follower_id=p_actor AND following_id=p_target;
  IF p_action='unfollow' THEN
    DELETE FROM public.follows WHERE follower_id=p_actor AND following_id=p_target;
    DELETE FROM public.follow_requests WHERE follower_id=p_actor AND following_id=p_target;
    v_status := NULL;
  ELSIF p_action='follow' THEN
    IF v_private AND v_status IS DISTINCT FROM 'approved' THEN
      INSERT INTO public.follow_requests(follower_id,following_id,status) VALUES(p_actor,p_target,'pending') ON CONFLICT(follower_id,following_id) DO NOTHING;
      v_status := 'pending';
    ELSE
      INSERT INTO public.follows(follower_id,following_id) VALUES(p_actor,p_target) ON CONFLICT(follower_id,following_id) DO NOTHING;
      v_changed := FOUND;
      -- A public follow does not constitute private-page approval.
      DELETE FROM public.follow_requests WHERE follower_id=p_actor AND following_id=p_target AND status='pending';
      IF v_status='pending' THEN v_status:=NULL; END IF;
    END IF;
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.follows WHERE follower_id=p_actor AND following_id=p_target) AND (NOT v_private OR v_status='approved') INTO v_following;
  RETURN jsonb_build_object('following',coalesce(v_following,false),'followRequestStatus',coalesce(v_status,'none'),'notifyFollow',v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.mutate_follow_relationship(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_follow_relationship(bigint,bigint,text) TO service_role;
COMMIT;
