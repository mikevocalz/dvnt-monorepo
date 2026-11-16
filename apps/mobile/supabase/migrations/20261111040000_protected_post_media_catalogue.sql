-- Source-only: close the central media catalogue alternative to posts_media RLS.
-- This does not revoke already known CDN URLs; origin authorization is separate.
BEGIN;
CREATE INDEX IF NOT EXISTS posts_media_source_path_idx ON public.posts_media
  ((split_part(split_part(url, '?', 1), '#', 1)));
CREATE INDEX IF NOT EXISTS posts_media_motion_path_idx ON public.posts_media
  ((split_part(split_part(live_photo_video_url, '?', 1), '#', 1)));
CREATE INDEX IF NOT EXISTS posts_media_thumbnail_path_idx ON public.posts_media
  ((split_part(split_part(thumbnail, '?', 1), '#', 1)));

CREATE OR REPLACE FUNCTION public.media_post_access_hidden(p_media_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.media m
    JOIN public.posts_media pm ON (
      split_part(split_part(m.url, '?', 1), '#', 1) = split_part(split_part(pm.url, '?', 1), '#', 1)
      OR split_part(split_part(m.url, '?', 1), '#', 1) = split_part(split_part(pm.live_photo_video_url, '?', 1), '#', 1)
      OR split_part(split_part(m.url, '?', 1), '#', 1) = split_part(split_part(pm.thumbnail, '?', 1), '#', 1)
    )
    LEFT JOIN public.posts p ON p.id=pm._parent_id
    WHERE m.id=p_media_id AND NULLIF(m.url,'') IS NOT NULL
      AND (p.id IS NULL OR public.post_follow_hidden(pm._parent_id)
        OR public.post_spicy_hidden(pm._parent_id)
        OR (p.visibility IS DISTINCT FROM 'public' AND
          p.author_id IS DISTINCT FROM public.viewer_user_id()))
  ) OR EXISTS (
    -- A fresh upload is catalogued before create-post links it. Do not expose
    -- that interval (or deleted-post remnants) through the public catalogue.
    SELECT 1 FROM public.media m WHERE m.id=p_media_id
      AND (m.filename ~ '^(post-image|post-video|posts)/'
        OR m.url ~ '^https?://[^/]+/(post-image|post-video|posts)/')
      AND NOT EXISTS (SELECT 1 FROM public.posts_media pm WHERE
        split_part(split_part(m.url, '?', 1), '#', 1) IN (
          split_part(split_part(pm.url, '?', 1), '#', 1),
          split_part(split_part(pm.live_photo_video_url, '?', 1), '#', 1),
          split_part(split_part(pm.thumbnail, '?', 1), '#', 1)))
      AND NOT EXISTS (SELECT 1 FROM public.live_photo_upload_receipts r
        WHERE r.media_id=m.id AND r.url=m.url AND r.object_key=m.filename
          AND r.owner_auth_id=auth.jwt()->>'sub')
  );
$$;
REVOKE ALL ON FUNCTION public.media_post_access_hidden(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.media_post_access_hidden(bigint) TO anon,authenticated,service_role;
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS media_requires_post_access ON public.media;
CREATE POLICY media_requires_post_access ON public.media AS RESTRICTIVE
  FOR SELECT TO anon,authenticated USING (NOT public.media_post_access_hidden(id));
COMMIT;
NOTIFY pgrst, 'reload schema';
