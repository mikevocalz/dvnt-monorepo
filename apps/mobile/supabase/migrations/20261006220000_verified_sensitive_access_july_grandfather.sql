-- Verified-sensitive access policy.
--
-- Product policy 2026-10-06:
--   * accounts created before 2026-07-01 are grandfathered as verified;
--   * any explicit under-18 identity evidence still blocks, including legacy;
--   * accounts created on/after 2026-07-01 need a passed adult ID;
--   * unverified members may keep normal DVNT access and buy tickets;
--   * SPICY posts/events, comments, and Sneaky Lynks are verified-only.
--
-- This migration deliberately does NOT enable verified_admission_policy.enforce:
-- that older gate closes too many unrelated features (posting, messaging, etc.).
BEGIN;

CREATE OR REPLACE FUNCTION public.viewer_has_verified_sensitive_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT auth.jwt() ->> 'sub' AS auth_id
  ),
  v AS (
    SELECT iv.status, iv.date_of_birth, iv.failure_code
    FROM public.identity_verifications iv, me
    WHERE iv.user_id = me.auth_id
    LIMIT 1
  ),
  account_age AS (
    SELECT u."createdAt" AS created_at
    FROM public."user" u, me
    WHERE u.id = me.auth_id
    LIMIT 1
  )
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    WHEN (SELECT auth_id FROM me) IS NULL THEN false
    -- Explicit underage / duplicate evidence always wins over grandfathering.
    WHEN EXISTS (
      SELECT 1 FROM v
      WHERE failure_code IN ('underage', 'duplicate_identity')
         OR (
           date_of_birth IS NOT NULL
           AND date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
         )
    ) THEN false
    WHEN EXISTS (
      SELECT 1 FROM v
      WHERE status = 'passed'
        AND date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
        AND date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
    ) THEN true
    WHEN EXISTS (
      SELECT 1 FROM account_age
      WHERE created_at < TIMESTAMPTZ '2026-07-01 00:00:00+00'
    ) THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.viewer_has_verified_sensitive_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_has_verified_sensitive_access()
  TO anon, authenticated, service_role;

-- Keep the existing SPICY policies/functions calling the old name, but change
-- its meaning to the new product rule.
CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.viewer_has_verified_sensitive_access();
$$;

REVOKE ALL ON FUNCTION public.viewer_is_verified_adult() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_verified_adult()
  TO anon, authenticated, service_role;

-- Event comments are written directly from the app. A RESTRICTIVE INSERT
-- policy closes that bypass while leaving comment reads open.
DO $$
BEGIN
  IF to_regclass('public.event_comments') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS verified_sensitive_event_comment_insert ON public.event_comments';
    EXECUTE $policy$
      CREATE POLICY verified_sensitive_event_comment_insert
      ON public.event_comments AS RESTRICTIVE
      FOR INSERT TO authenticated
      WITH CHECK ((SELECT public.viewer_has_verified_sensitive_access()))
    $policy$;
  END IF;
END;
$$;

-- SPICY events should not be returned by ordinary PostgREST reads to
-- unverified viewers. The service-role event RPCs are separately filtered in
-- application code; this policy closes direct-table access.
DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS spicy_event_requires_verified_viewer ON public.events';
    EXECUTE $policy$
      CREATE POLICY spicy_event_requires_verified_viewer
      ON public.events AS RESTRICTIVE
      FOR SELECT TO anon, authenticated
      USING (
        COALESCE(nsfw, false) IS NOT TRUE
        OR (SELECT public.viewer_has_verified_sensitive_access())
      )
    $policy$;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.viewer_has_verified_sensitive_access() IS
  'Verified-only sensitive access: pre-2026-07-01 accounts are grandfathered unless explicit underage/duplicate evidence exists; newer accounts require a passed adult ID.';

COMMIT;

NOTIFY pgrst, 'reload schema';
