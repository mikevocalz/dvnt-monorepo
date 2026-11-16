-- Source-only. Restrictive overlays retain existing policies while preventing
-- raw REST enumeration/forged engagement around protected post readers.
BEGIN;
CREATE OR REPLACE FUNCTION public.engagement_post_visible(p_post_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.posts p WHERE p.id=p_post_id
    AND (p.visibility='public' OR p.author_id=public.viewer_user_id())
    AND NOT public.post_follow_hidden(p.id)
    AND NOT public.post_spicy_hidden(p.id));
$$;
CREATE OR REPLACE FUNCTION public.engagement_comment_visible(p_comment_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.comments c WHERE c.id=p_comment_id
    -- Post comments and event_comments are separate ID namespaces. Never use
    -- an event-comment collision to authorize a missing/hidden post parent.
    AND c.post_id IS NOT NULL
    AND public.engagement_post_visible(c.post_id));
$$;
REVOKE ALL ON FUNCTION public.engagement_post_visible(bigint),public.engagement_comment_visible(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.engagement_post_visible(bigint),public.engagement_comment_visible(bigint) TO anon,authenticated,service_role;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

-- A member may still see their own relationship row to delete it after access
-- revocation. PostgreSQL applies SELECT policies to DELETE predicates too.
-- This exception reveals neither the parent content nor anyone else's identity.
DROP POLICY IF EXISTS likes_requires_post_access ON public.likes;
CREATE POLICY likes_requires_post_access ON public.likes AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (
    user_id=public.viewer_user_id() OR public.engagement_post_visible(post_id));
DROP POLICY IF EXISTS likes_insert_own_visible ON public.likes;
CREATE POLICY likes_insert_own_visible ON public.likes AS RESTRICTIVE
  FOR INSERT TO anon,authenticated WITH CHECK (
    user_id=public.viewer_user_id() AND public.engagement_post_visible(post_id));
DROP POLICY IF EXISTS likes_delete_own_only ON public.likes;
CREATE POLICY likes_delete_own_only ON public.likes AS RESTRICTIVE
  FOR DELETE TO anon,authenticated USING (user_id=public.viewer_user_id());
DROP POLICY IF EXISTS comment_likes_requires_post_access ON public.comment_likes;
CREATE POLICY comment_likes_requires_post_access ON public.comment_likes AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (
    user_id=public.viewer_user_id() OR public.engagement_comment_visible(comment_id));
DROP POLICY IF EXISTS comment_likes_insert_own_visible ON public.comment_likes;
CREATE POLICY comment_likes_insert_own_visible ON public.comment_likes AS RESTRICTIVE
  FOR INSERT TO anon,authenticated WITH CHECK (
    user_id=public.viewer_user_id() AND public.engagement_comment_visible(comment_id));
DROP POLICY IF EXISTS comment_likes_delete_own_only ON public.comment_likes;
CREATE POLICY comment_likes_delete_own_only ON public.comment_likes AS RESTRICTIVE
  FOR DELETE TO anon,authenticated USING (user_id=public.viewer_user_id());
-- Engagement keys are immutable for clients. Preserve the current no-UPDATE
-- boundary even if a future permissive policy is added alongside these gates.
DROP POLICY IF EXISTS likes_no_client_update ON public.likes;
CREATE POLICY likes_no_client_update ON public.likes AS RESTRICTIVE
  FOR UPDATE TO anon,authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS comment_likes_no_client_update ON public.comment_likes;
CREATE POLICY comment_likes_no_client_update ON public.comment_likes AS RESTRICTIVE
  FOR UPDATE TO anon,authenticated USING (false) WITH CHECK (false);
COMMIT;
NOTIFY pgrst,'reload schema';
