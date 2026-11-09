-- Source-only. Requires reviewed private-follow approval schema and the existing
-- users client-write lockdown. This file does not apply itself to any database.
BEGIN;

-- An authorization check cannot trust author/viewer mappings that clients can
-- rewrite. Refuse rollout until the existing identity-lockdown prerequisite is
-- applied; do not silently install another copy of that security work here.
DO $$
DECLARE role_name text; column_name text;
BEGIN
  IF to_regclass('public.follow_requests') IS NULL THEN
    RAISE EXCEPTION 'Apply private follow requests before the post read gate';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name, 'public.users', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'Trusted users identity prerequisite is missing for %', role_name;
    END IF;
    FOR column_name IN SELECT attname FROM pg_attribute
      WHERE attrelid='public.users'::regclass AND attnum>0 AND NOT attisdropped LOOP
      IF has_column_privilege(role_name,'public.users',column_name,'INSERT,UPDATE') THEN
        RAISE EXCEPTION 'Trusted users identity column prerequisite is missing for %', role_name;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Privacy choices are written only by the verified user-settings service.
-- Other members must never be able to make an author public through REST.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_settings FROM PUBLIC, anon, authenticated;
DO $$
DECLARE col text;
BEGIN
  FOR col IN SELECT attname FROM pg_attribute
    WHERE attrelid='public.user_settings'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE INSERT (%1$I), UPDATE (%1$I) ON public.user_settings FROM PUBLIC, anon, authenticated',col);
  END LOOP;
END $$;

-- The UI writes privateAccount through user-settings. Keep the legacy users
-- flag in that same transaction, so choosing Public cannot leave an invisible
-- second flag permanently forcing Private (and choosing Private is atomic).
CREATE OR REPLACE FUNCTION public.sync_account_privacy_setting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.settings#>'{privacy,privateAccount}' IN ('true'::jsonb,'false'::jsonb) THEN
    UPDATE public.users SET is_private=(NEW.settings#>>'{privacy,privateAccount}')::boolean
      WHERE auth_id=NEW.auth_id AND is_private IS DISTINCT FROM (NEW.settings#>>'{privacy,privateAccount}')::boolean;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_account_privacy_setting() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS user_settings_sync_account_privacy ON public.user_settings;
CREATE TRIGGER user_settings_sync_account_privacy AFTER INSERT OR UPDATE OF settings
ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.sync_account_privacy_setting();

CREATE OR REPLACE FUNCTION public.post_follow_hidden(p_post_id bigint)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  author_id integer;
  viewer_id integer;
  spicy boolean;
  private_author boolean;
BEGIN
  IF COALESCE(auth.jwt()->>'role','')='service_role' THEN RETURN false; END IF;
  SELECT p.author_id, p.is_nsfw IS TRUE,
    u.is_private IS TRUE OR COALESCE(us.settings#>>'{privacy,privateAccount}','false') <> 'false'
    INTO author_id, spicy, private_author
    FROM public.posts p JOIN public.users u ON u.id=p.author_id
    LEFT JOIN public.user_settings us ON us.auth_id=u.auth_id
    WHERE p.id=p_post_id;
  -- Orphaned child rows must never become an alternative read path.
  IF NOT FOUND THEN RETURN true; END IF;
  viewer_id := public.viewer_user_id();
  IF viewer_id=author_id THEN RETURN false; END IF;
  IF viewer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.blocks b WHERE
      (b.blocker_id=viewer_id AND b.blocked_id=author_id)
      OR (b.blocker_id=author_id AND b.blocked_id=viewer_id)
  ) THEN RETURN true; END IF;
  IF NOT spicy AND NOT private_author THEN RETURN false; END IF;
  IF viewer_id IS NULL THEN RETURN true; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.follows f
    WHERE f.follower_id=viewer_id AND f.following_id=author_id) THEN RETURN true; END IF;
  IF private_author AND NOT EXISTS (SELECT 1 FROM public.follow_requests r
    WHERE r.follower_id=viewer_id AND r.following_id=author_id AND r.status='approved') THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.post_follow_hidden(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_follow_hidden(bigint) TO anon, authenticated, service_role;

-- Additional RESTRICTIVE predicates preserve every existing age, admission,
-- moderation and visibility check. They never widen an older policy.
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_text_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS post_requires_follow_access ON public.posts;
CREATE POLICY post_requires_follow_access ON public.posts AS RESTRICTIVE
  FOR SELECT TO anon, authenticated USING (NOT public.post_follow_hidden(id));
DROP POLICY IF EXISTS post_requires_follow_access ON public.posts_media;
CREATE POLICY post_requires_follow_access ON public.posts_media AS RESTRICTIVE
  FOR SELECT TO anon, authenticated USING (NOT public.post_follow_hidden(_parent_id));
DROP POLICY IF EXISTS post_requires_follow_access ON public.post_text_slides;
CREATE POLICY post_requires_follow_access ON public.post_text_slides AS RESTRICTIVE
  FOR SELECT TO anon, authenticated USING (NOT public.post_follow_hidden(post_id));
DROP POLICY IF EXISTS post_requires_follow_access ON public.comments;
CREATE POLICY post_requires_follow_access ON public.comments AS RESTRICTIVE
  FOR SELECT TO anon, authenticated USING (post_id IS NULL OR (
    NOT public.post_follow_hidden(post_id) AND NOT public.post_spicy_hidden(post_id)
  ));

-- Share crawlers receive only explicitly public, safe content. A dedicated
-- projection also makes the web client fail closed before this migration is
-- available, instead of falling back to a broad raw REST read.
CREATE OR REPLACE FUNCTION public.public_post_share_preview(p_post_id bigint)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'description', left(COALESCE(p.content,''),200),
    'image', (SELECT pm.url FROM public.posts_media pm
      WHERE pm._parent_id=p.id AND pm.type::text IN ('image','gif','livePhoto')
        AND pm.url ~ '^https?://' ORDER BY pm._order,pm.id LIMIT 1)
  ))
  FROM public.posts p JOIN public.users u ON u.id=p.author_id
  LEFT JOIN public.user_settings us ON us.auth_id=u.auth_id
  WHERE p.id=p_post_id AND p.is_nsfw IS NOT TRUE
    AND COALESCE(to_jsonb(p)->>'visibility','public')='public'
    AND COALESCE(to_jsonb(p)->>'moderation_status','approved') IN ('approved','clean','published')
    AND COALESCE(to_jsonb(p)->>'status','published') IN ('published','active')
    AND to_jsonb(p)->>'deleted_at' IS NULL AND to_jsonb(p)->>'archived_at' IS NULL
    AND COALESCE(to_jsonb(p)->>'is_deleted','false')='false'
    AND COALESCE(to_jsonb(p)->>'is_hidden','false')='false'
    AND to_jsonb(u)->>'banned_at' IS NULL
    AND u.is_private IS NOT TRUE
    AND COALESCE(us.settings#>>'{privacy,privateAccount}','false')='false';
$$;
REVOKE ALL ON FUNCTION public.public_post_share_preview(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_post_share_preview(bigint) TO anon, authenticated, service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
