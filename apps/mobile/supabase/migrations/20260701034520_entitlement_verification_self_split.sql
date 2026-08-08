-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260701034520 :: entitlement_verification_self_split). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Split the SECURITY DEFINER helpers into two per surface:
--   is_entitled_self() / is_verified_self()  — no arg, uses JWT sub, granted to authenticated
--   is_entitled(uid)   / is_verified(uid)    — arg version, granted ONLY to service_role
-- Silences the authenticated_security_definer_function_executable
-- advisor while keeping edge functions able to look up any uid.

CREATE OR REPLACE FUNCTION public.is_entitled_self()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT plan_key
  FROM membership_subscriptions
  WHERE user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub')
    AND (
      (status IN ('active','trialing')
        AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'past_due'
        AND grace_period_ends_at IS NOT NULL
        AND grace_period_ends_at > now())
    )
  ORDER BY current_period_end DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.is_entitled_self() FROM public;
GRANT EXECUTE ON FUNCTION public.is_entitled_self() TO authenticated;

-- Lock the argument-taking version to service_role only.
REVOKE EXECUTE ON FUNCTION public.is_entitled(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.is_verified_self()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity_verifications
    WHERE user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub')
      AND status = 'passed'
  );
$$;

REVOKE ALL ON FUNCTION public.is_verified_self() FROM public;
GRANT EXECUTE ON FUNCTION public.is_verified_self() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_verified(text) FROM authenticated;;
