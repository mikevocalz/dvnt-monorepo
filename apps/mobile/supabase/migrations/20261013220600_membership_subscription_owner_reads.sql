-- Read-only identity compatibility for processor membership records.
-- Verified production evidence, 2026-10-13: membership_subs_own currently uses
-- user_id = (SELECT u.id::text FROM users u
--            WHERE u.auth_id = request.jwt.claims->>'sub' LIMIT 1).
-- The Next checkout writes that numeric id; edge checkout writes auth_id and
-- RevenueCat retains app_user_id. Keep both namespaces without rewriting any
-- subscription, billing reference, entitlement, or provider event history.
-- Canonical auth-id ownership takes precedence over numeric-id collisions.
-- Existing table privileges: authenticated SELECT only; anon none. This
-- migration does not grant or expand table write access.
BEGIN;

CREATE OR REPLACE FUNCTION public.membership_subscription_auth_id(p_owner_key text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.auth_id
  FROM public.users u
  WHERE u.auth_id IS NOT NULL AND u.auth_id <> ''
    -- Match the client/server identity resolver: duplicate profile bindings
    -- are ambiguous even when a damaged schema lacks a UNIQUE constraint.
    AND (SELECT count(*) FROM public.users bound WHERE bound.auth_id = u.auth_id) = 1
    AND (
      u.auth_id = p_owner_key
      OR (
        u.id::text = p_owner_key
        AND NOT EXISTS (
          SELECT 1 FROM public.users canonical
          WHERE canonical.auth_id = p_owner_key
        )
      )
    )
$$;
REVOKE ALL ON FUNCTION public.membership_subscription_auth_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.membership_subscription_auth_id(text) TO service_role;

-- The client may ask only "does this owner key belong to my JWT principal?";
-- the generic cross-account identity resolver remains service-role-only.
CREATE OR REPLACE FUNCTION public.membership_subscription_owned_by_viewer(p_owner_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(
    public.membership_subscription_auth_id(p_owner_key) =
      nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', ''),
    false
  )
$$;
REVOKE ALL ON FUNCTION public.membership_subscription_owned_by_viewer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.membership_subscription_owned_by_viewer(text) TO authenticated, service_role;

DROP POLICY IF EXISTS membership_subs_own ON public.membership_subscriptions;
CREATE POLICY membership_subs_own ON public.membership_subscriptions
  FOR SELECT TO authenticated
  USING (public.membership_subscription_owned_by_viewer(user_id));

COMMIT;
