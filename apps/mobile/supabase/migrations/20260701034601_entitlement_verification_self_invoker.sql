-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260701034601 :: entitlement_verification_self_invoker). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Flip self-lookup RPCs to SECURITY INVOKER so the caller's role
-- decides table access, and RLS (already scoped to the JWT sub on
-- both tables) enforces the row filter. This closes the
-- `authenticated_security_definer_function_executable` advisor —
-- the fns are no longer definer, so there's nothing to advise on.
GRANT SELECT ON identity_verifications TO authenticated;

CREATE OR REPLACE FUNCTION public.is_entitled_self()
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
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

CREATE OR REPLACE FUNCTION public.is_verified_self()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity_verifications
    WHERE user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub')
      AND status = 'passed'
  );
$$;;
