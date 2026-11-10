-- SOURCE ONLY. Additive prerequisite: install before deploying guarded list handlers.
-- This migration does not restrict existing raw reads; privacy rollout is incomplete
-- until compatible clients/handlers are live and the separate 10300 gate is approved.
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

-- One SQL statement/snapshot covers authorization, rows, counts and projection.
-- No service-role list is fetched after a separately evaluated permission check.
CREATE OR REPLACE FUNCTION public.get_profile_social_graph(
  p_viewer bigint,p_target bigint,p_direction text,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  WITH access AS (
    SELECT p_direction IN ('followers','following') AND EXISTS(SELECT 1 FROM public.users WHERE id=p_target)
      AND (p_viewer=p_target OR EXISTS(
        SELECT 1 FROM public.post_relationship_access(p_viewer,ARRAY[p_target]) a
        WHERE a.author_id=p_target AND NOT a.is_blocked AND (NOT a.is_private OR a.is_following)
      )) AS allowed
  ), relationships AS (
    SELECT f.id AS relationship_id,
      CASE WHEN p_direction='followers' THEN f.follower_id ELSE f.following_id END AS member_id
    FROM public.follows f WHERE (SELECT allowed FROM access) AND
      ((p_direction='followers' AND f.following_id=p_target) OR
       (p_direction='following' AND f.follower_id=p_target))
  ), page_rows AS (
    SELECT * FROM relationships ORDER BY relationship_id
      LIMIT LEAST(GREATEST(p_limit,1),50) OFFSET GREATEST(p_offset,0)
  ), documents AS (
    SELECT r.relationship_id,jsonb_build_object(
      'id',u.id::text,'username',COALESCE(NULLIF(u.username,''),'unknown'),
      'name',COALESCE(NULLIF(u.first_name,''),NULLIF(u.username,''),'Unknown'),
      'avatar',COALESCE(m.url,''),'verified',COALESCE(u.verified,false),
      'isFollowing',EXISTS(SELECT 1 FROM public.follows x WHERE x.follower_id=p_viewer AND x.following_id=u.id),
      'followsYou',EXISTS(SELECT 1 FROM public.follows x WHERE x.follower_id=u.id AND x.following_id=p_viewer)
    ) AS doc FROM page_rows r JOIN public.users u ON u.id=r.member_id
      LEFT JOIN public.media m ON m.id=u.avatar_id
  )
  SELECT jsonb_build_object('allowed',COALESCE((SELECT allowed FROM access),false),
    'docs',COALESCE((SELECT jsonb_agg(doc ORDER BY relationship_id) FROM documents),'[]'::jsonb),
    'totalDocs',(SELECT count(*) FROM relationships));
$$;
REVOKE ALL ON FUNCTION public.get_profile_social_graph(bigint,bigint,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_social_graph(bigint,bigint,text,integer,integer) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
