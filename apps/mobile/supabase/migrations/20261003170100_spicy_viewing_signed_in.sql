-- SPICY posts are visible to every signed-in member.
--
-- Product rule (2026-10-03): "spicy viewing is for those that are logged in,
-- only". 20261003170000 limited SPICY reads to viewers with an approved adult
-- ID. On 2026-10-03 production had 56 public SPICY posts and no member with a
-- passed ID, so SPICY was empty for everyone. This migration changes who may
-- READ. Who may WRITE does not change: creating a post as SPICY, or marking an
-- existing post SPICY, still needs viewer_is_verified_adult() through
-- spicy_write_requires_verified_adult and spicy_update_requires_verified_adult,
-- which this file does not touch.
--
-- "Signed in" means the request carries a JWT with a sub claim. Signed-in
-- clients reach PostgREST through the mint-supabase-jwt bridge, which issues
-- role = authenticated with sub = the Better Auth user id. Signed-out clients
-- send the anon key, which has no sub. service_role keeps full read access.
BEGIN;

-- True when the post is SPICY and the caller is not signed in. Kept as a
-- SECURITY DEFINER helper because the child-table policies must read
-- posts.is_nsfw without going through the posts policy, which would hide the
-- post and make it read as "not SPICY".
CREATE OR REPLACE FUNCTION public.post_spicy_hidden(p_post_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT (auth.jwt() ->> 'sub') IS NULL
    AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = p_post_id
        AND p.is_nsfw IS TRUE
        AND p.author_id IS DISTINCT FROM public.viewer_user_id()
    );
$$;
REVOKE ALL ON FUNCTION public.post_spicy_hidden(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_spicy_hidden(bigint) TO anon, authenticated, service_role;

-- Same name as before, so the posts_media and post_text_slides policies from
-- 20261003170000 pick up the new post_spicy_hidden() with no change. The
-- (SELECT ...) wrappers evaluate the viewer checks once per statement.
DROP POLICY IF EXISTS spicy_requires_verified_viewer ON public.posts;
CREATE POLICY spicy_requires_verified_viewer ON public.posts AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (
    is_nsfw IS NOT TRUE
    OR (SELECT auth.jwt() ->> 'sub') IS NOT NULL
    OR (SELECT COALESCE(auth.jwt() ->> 'role', '')) = 'service_role'
  );

COMMENT ON FUNCTION public.viewer_is_verified_adult() IS
  'Approved adult ID (or service_role). Since 20261003170100 it gates SPICY writes only; '
  'SPICY reads need a signed-in caller (JWT sub present).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Roll back to verified-adult reads: re-run section 3's post_spicy_hidden and
-- the posts spicy_requires_verified_viewer policy from 20261003170000.
