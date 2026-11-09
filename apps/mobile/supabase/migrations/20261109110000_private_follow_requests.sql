BEGIN;
-- Additive compatibility phase only. No live rows are captured here.
-- Deploy/drain compatible readers and writers, install the staged post gate,
-- then separately approve/run docs/security/private-follow-preservation-cutover.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
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

CREATE TABLE IF NOT EXISTS public.follow_access_cutovers (
  batch_id text PRIMARY KEY CHECK(batch_id='private-follow-v1'),
  captured_at timestamptz,
  relationship_count bigint,
  provenance text NOT NULL CHECK(provenance='legacy_access_preservation'),
  source_migration text NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  read_gate_version integer NOT NULL DEFAULT 0 CHECK(read_gate_version IN (0,1)),
  CHECK ((ready AND captured_at IS NOT NULL AND relationship_count IS NOT NULL)
    OR (NOT ready AND captured_at IS NULL AND relationship_count IS NULL))
);
CREATE TABLE IF NOT EXISTS public.follow_legacy_access (
  follow_id integer PRIMARY KEY REFERENCES public.follows(id) ON DELETE CASCADE,
  batch_id text NOT NULL REFERENCES public.follow_access_cutovers(batch_id)
);
-- Acceptance while Public is distinct from both cutover preservation and an
-- owner's explicit approval. It survives later privacy changes for this row only.
CREATE TABLE IF NOT EXISTS public.public_follow_acceptances (
  follow_id integer PRIMARY KEY REFERENCES public.follows(id) ON DELETE CASCADE,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provenance text NOT NULL DEFAULT 'public_follow' CHECK(provenance='public_follow')
);
ALTER TABLE public.public_follow_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_follow_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.public_follow_acceptances TO service_role;
ALTER TABLE public.follow_access_cutovers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_legacy_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.follow_access_cutovers,public.follow_legacy_access FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.follow_access_cutovers TO service_role;
GRANT SELECT ON public.follow_legacy_access TO service_role;
INSERT INTO public.follow_access_cutovers(batch_id,provenance,source_migration,ready)
  VALUES('private-follow-v1','legacy_access_preservation','20261109110000_private_follow_requests.sql',false)
  ON CONFLICT(batch_id) DO NOTHING;

-- Pair/id mutation is a new relationship, even if the old id is later reused.
-- Deletion also retires real approval so a direct delete/reinsert cannot restore it.
CREATE OR REPLACE FUNCTION public.retire_follow_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Follow mutations require READ COMMITTED isolation; retry in a fresh transaction' USING ERRCODE='40001';
  END IF;
  IF TG_OP='DELETE' OR (OLD.id,OLD.follower_id,OLD.following_id)
    IS DISTINCT FROM (NEW.id,NEW.follower_id,NEW.following_id) THEN
    -- Do not let an old repeatable-read snapshot miss grants captured since
    -- that snapshot and transfer them to a different id/pair. Locking the
    -- changed readiness row forces serialization failure instead.
    PERFORM ready FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Follow compatibility schema is not ready' USING ERRCODE='55000'; END IF;
    DELETE FROM public.follow_legacy_access WHERE follow_id=OLD.id;
    DELETE FROM public.public_follow_acceptances WHERE follow_id=OLD.id;
    DELETE FROM public.follow_requests WHERE follower_id=OLD.follower_id AND following_id=OLD.following_id;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.retire_follow_authorization() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS follows_retire_authorization ON public.follows;
CREATE TRIGGER follows_retire_authorization BEFORE DELETE OR UPDATE OF id,follower_id,following_id
  ON public.follows FOR EACH ROW EXECUTE FUNCTION public.retire_follow_authorization();

-- Internal/service-only helper; never accepts an unverified client identity.
CREATE OR REPLACE FUNCTION public.private_follow_authorized(p_follower bigint,p_following bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM public.follows f
    WHERE f.follower_id=p_follower AND f.following_id=p_following
      AND (EXISTS(SELECT 1 FROM public.follow_access_cutovers c WHERE c.batch_id='private-follow-v1' AND NOT c.ready)
        OR EXISTS(SELECT 1 FROM public.follow_requests r WHERE r.follower_id=p_follower
        AND r.following_id=p_following AND r.status='approved')
        OR EXISTS(SELECT 1 FROM public.public_follow_acceptances a WHERE a.follow_id=f.id)
        OR EXISTS(SELECT 1 FROM public.follow_legacy_access g
          JOIN public.follow_access_cutovers c USING(batch_id) WHERE g.follow_id=f.id AND c.ready)));
$$;
REVOKE ALL ON FUNCTION public.private_follow_authorized(bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.private_follow_authorized(bigint,bigint) TO service_role;

-- Covers verified RPC, brand jobs and other service inserts, not only one
-- cooperative handler. The table INSERT lock joins the cutover write barrier.
-- Lock both users in the RPC order; the staged privacy-sync trigger updates the
-- owner row too. Read privacy AFTER acquiring the row lock, in a fresh statement.
CREATE OR REPLACE FUNCTION public.guard_follow_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_private boolean; v_ready boolean;
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
  SELECT coalesce(u.is_private,false) OR coalesce(s.settings#>>'{privacy,privateAccount}','false') <> 'false'
    INTO v_private FROM public.users u LEFT JOIN public.user_settings s ON s.auth_id=u.auth_id WHERE u.id=NEW.following_id;
  IF v_private AND NOT public.private_follow_authorized(NEW.follower_id,NEW.following_id)
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
DROP TRIGGER IF EXISTS follows_guard_insert ON public.follows;
CREATE TRIGGER follows_guard_insert BEFORE INSERT ON public.follows FOR EACH ROW EXECUTE FUNCTION public.guard_follow_insert();
CREATE OR REPLACE FUNCTION public.record_public_follow_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1' AND ready)
    AND EXISTS(SELECT 1 FROM public.users u LEFT JOIN public.user_settings s ON s.auth_id=u.auth_id
      WHERE u.id=NEW.following_id AND NOT coalesce(u.is_private,false)
        AND coalesce(s.settings#>>'{privacy,privateAccount}','false')='false') THEN
    INSERT INTO public.public_follow_acceptances(follow_id) VALUES(NEW.id);
    DELETE FROM public.follow_requests WHERE follower_id=NEW.follower_id
      AND following_id=NEW.following_id AND status='pending';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_public_follow_acceptance() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS follows_record_public_acceptance ON public.follows;
CREATE TRIGGER follows_record_public_acceptance AFTER INSERT ON public.follows FOR EACH ROW EXECUTE FUNCTION public.record_public_follow_acceptance();

-- One statement/snapshot for Edge: separate REST lookups could combine an old
-- approval/grant with a new relationship or stale privacy across an unfollow.
CREATE OR REPLACE FUNCTION public.post_relationship_access(p_viewer bigint,p_authors bigint[])
RETURNS TABLE(author_id bigint,is_private boolean,is_following boolean,is_blocked boolean,enforcement_ready boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.follow_access_cutovers WHERE batch_id='private-follow-v1') THEN
    RAISE EXCEPTION 'Follow compatibility schema is not ready' USING ERRCODE='55000';
  END IF;
  RETURN QUERY SELECT u.id::bigint,
    coalesce(u.is_private,false) OR coalesce(s.settings#>>'{privacy,privateAccount}','false') <> 'false',
    EXISTS(SELECT 1 FROM public.follows f WHERE f.follower_id=p_viewer AND f.following_id=u.id)
      AND (NOT (coalesce(u.is_private,false) OR coalesce(s.settings#>>'{privacy,privateAccount}','false') <> 'false')
        OR public.private_follow_authorized(p_viewer,u.id)),
    EXISTS(SELECT 1 FROM public.blocks b WHERE (b.blocker_id=p_viewer AND b.blocked_id=u.id)
      OR (b.blocker_id=u.id AND b.blocked_id=p_viewer)),
    (SELECT c.ready FROM public.follow_access_cutovers c WHERE c.batch_id='private-follow-v1')
    FROM public.users u LEFT JOIN public.user_settings s ON s.auth_id=u.auth_id
    WHERE u.id=ANY(p_authors);
END;
$$;
REVOKE ALL ON FUNCTION public.post_relationship_access(bigint,bigint[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_relationship_access(bigint,bigint[]) TO service_role;

-- Service-only: p_actor is resolved from a verified Better Auth session by Edge.
CREATE OR REPLACE FUNCTION public.mutate_follow_relationship(p_actor bigint, p_target bigint, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_private boolean; v_status text; v_following boolean; v_changed boolean := false; v_ready boolean;
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
      INSERT INTO public.follow_requests(follower_id,following_id,status) VALUES(p_actor,p_target,'pending') ON CONFLICT(follower_id,following_id) DO NOTHING;
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
  RETURN jsonb_build_object('following',coalesce(v_following,false),'followRequestStatus',coalesce(v_status,'none'),'notifyFollow',v_changed);
END;
$$;
REVOKE ALL ON FUNCTION public.mutate_follow_relationship(bigint,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_follow_relationship(bigint,bigint,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
