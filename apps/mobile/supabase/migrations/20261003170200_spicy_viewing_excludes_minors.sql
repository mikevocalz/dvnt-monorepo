-- SPICY reads exclude members with an under-18 identity document on file.
--
-- Product rule (checklist A02, 2026-10-03): SPICY may be viewed by a signed-in
-- member who does NOT have an under-18 identity document on file. Signed-out
-- callers never see SPICY. 20261003170100 opened SPICY reads to every signed-in
-- caller; this migration takes them away from a flagged minor. Writes do not
-- change: spicy_write_requires_verified_adult and
-- spicy_update_requires_verified_adult still call viewer_is_verified_adult().
--
-- "Flagged minor" uses the same test as verified_participation_allowed(): an
-- identity_verifications row for the caller with date_of_birth later than
-- CURRENT_DATE - 18 years, whatever its status. A member with no row is not a
-- flagged minor. The post author and service_role keep read access.
BEGIN;

-- True when the caller's own identity document says they are under 18.
-- SECURITY DEFINER because identity_verifications is not readable by the
-- caller's role; the lookup is pinned to the caller's own JWT sub.
CREATE OR REPLACE FUNCTION public.viewer_is_flagged_minor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT (auth.jwt() ->> 'sub') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.identity_verifications v
      WHERE v.user_id = auth.jwt() ->> 'sub'
        AND v.date_of_birth IS NOT NULL
        AND v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
    );
$$;
REVOKE ALL ON FUNCTION public.viewer_is_flagged_minor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_flagged_minor() TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.viewer_is_flagged_minor() IS
  'Caller has an identity_verifications row with an under-18 date_of_birth. '
  'Since 20261003170200 such a caller cannot read SPICY posts they did not author.';

-- True when the post is SPICY, the caller is not its author, not
-- service_role, and is either signed out or a flagged minor. The posts_media
-- and post_text_slides policies from 20261003170000 call this by name.
CREATE OR REPLACE FUNCTION public.post_spicy_hidden(p_post_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
    AND ((auth.jwt() ->> 'sub') IS NULL OR public.viewer_is_flagged_minor())
    AND EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.id = p_post_id
        AND p.is_nsfw IS TRUE
        AND p.author_id IS DISTINCT FROM public.viewer_user_id()
    );
$$;
REVOKE ALL ON FUNCTION public.post_spicy_hidden(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_spicy_hidden(bigint) TO anon, authenticated, service_role;

-- The (SELECT ...) wrappers evaluate each viewer check once per statement.
DROP POLICY IF EXISTS spicy_requires_verified_viewer ON public.posts;
CREATE POLICY spicy_requires_verified_viewer ON public.posts AS RESTRICTIVE
  FOR SELECT TO anon, authenticated
  USING (
    is_nsfw IS NOT TRUE
    OR (SELECT COALESCE(auth.jwt() ->> 'role', '')) = 'service_role'
    OR (
      (SELECT auth.jwt() ->> 'sub') IS NOT NULL
      AND (
        NOT (SELECT public.viewer_is_flagged_minor())
        OR author_id = (SELECT public.viewer_user_id())
      )
    )
  );

COMMENT ON FUNCTION public.viewer_is_verified_adult() IS
  'Approved adult ID (or service_role). Since 20261003170100 it gates SPICY writes only; '
  'SPICY reads need a signed-in caller who is not a flagged minor (20261003170200).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Roll back to "any signed-in caller": re-run 20261003170100 and
-- DROP FUNCTION public.viewer_is_flagged_minor().
