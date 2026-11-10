-- SOURCE ONLY. Apply only after 10200, guarded handlers/readers and compatible
-- clients are deployed, old handlers drained, and installed-client compatibility
-- is approved. Anon-only callers lose private relationship reads by design.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.viewer_user_id()') IS NULL
    OR to_regprocedure('public.private_follow_authorized(bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'Trusted identity and preserved follow prerequisites are required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.follow_access_cutovers
    WHERE batch_id='private-follow-v1' AND ready AND read_gate_version=1) THEN
    RAISE EXCEPTION 'Activate preserved private follows before the social graph gate';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.get_profile_social_graph(bigint,bigint,text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Install social graph RPC before activating raw read gate';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.follow_graph_row_visible(p_follower bigint,p_following bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE viewer bigint; endpoint record;
BEGIN
  viewer := public.viewer_user_id();
  -- A verified member may inspect their own relationships (including inbox
  -- classification). Neither arbitrary body IDs nor anon requests grant this.
  IF viewer=p_follower OR viewer=p_following THEN RETURN true; END IF;
  FOR endpoint IN
    SELECT u.id,
      u.is_private IS TRUE OR COALESCE(s.settings#>>'{privacy,privateAccount}','false') <> 'false' AS private
    FROM public.users u LEFT JOIN public.user_settings s ON s.auth_id=u.auth_id
    WHERE u.id=ANY(ARRAY[p_follower,p_following])
  LOOP
    IF viewer IS NOT NULL AND EXISTS(SELECT 1 FROM public.blocks b WHERE
      (b.blocker_id=viewer AND b.blocked_id=endpoint.id)
      OR (b.blocker_id=endpoint.id AND b.blocked_id=viewer)) THEN RETURN false; END IF;
    IF endpoint.private AND (viewer IS NULL OR NOT public.private_follow_authorized(viewer,endpoint.id)) THEN
      RETURN false;
    END IF;
  END LOOP;
  -- Orphan relationships must not become a bypass.
  RETURN (SELECT count(*) FROM public.users WHERE id=ANY(ARRAY[p_follower,p_following]))
    = CASE WHEN p_follower=p_following THEN 1 ELSE 2 END;
END;
$$;
REVOKE ALL ON FUNCTION public.follow_graph_row_visible(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.follow_graph_row_visible(bigint,bigint) TO anon,authenticated,service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS private_social_graph_gate ON public.follows;
CREATE POLICY private_social_graph_gate ON public.follows AS RESTRICTIVE
  FOR SELECT TO anon,authenticated
  USING(public.follow_graph_row_visible(follower_id,following_id));

COMMIT;
NOTIFY pgrst,'reload schema';
