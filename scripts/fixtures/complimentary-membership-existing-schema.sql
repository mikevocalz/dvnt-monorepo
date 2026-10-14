-- Synthetic replay of the read-only verified existing membership schema, 2026-10-13.
-- Contains schema definitions and ACLs only; never account or billing rows.
-- Table columns/types, view/function definitions, RLS policies, and audiences match
-- the baseline. Constraints/defaults not present in that snapshot are not inferred.
-- public.users and the unrelated dependency tables are provided by the test harness.
-- Ownership helpers and watch_door_summary are absent in the verified baseline.

CREATE TABLE public.membership_subscriptions (
  id uuid,
  user_id text,
  product_family text,
  plan_key text,
  status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean,
  canceled_at timestamp with time zone,
  grace_period_ends_at timestamp with time zone,
  trial_start timestamp with time zone,
  trial_end timestamp with time zone,
  entitlement_snapshot jsonb,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  rail text,
  provider_ref text,
  last_event_at timestamp with time zone
);
ALTER TABLE public.membership_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membership_subscriptions TO authenticated;
GRANT ALL ON public.membership_subscriptions TO service_role;

CREATE TABLE public.sneaky_subscriptions (
  id uuid,
  host_id text,
  plan_id text,
  status text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean,
  canceled_at timestamp with time zone,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  grace_period_ends_at timestamp with time zone
);
ALTER TABLE public.sneaky_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sneaky_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.sneaky_subscriptions TO authenticated;
GRANT ALL ON public.sneaky_subscriptions TO service_role;

CREATE VIEW public.user_badge_tiers AS
 SELECT u.id::text AS user_id,
    u.username,
    ms.plan_key
   FROM users u
     JOIN membership_subscriptions ms ON ms.user_id = u.id::text
  WHERE (ms.status = ANY (ARRAY['active'::text, 'trialing'::text])) AND ms.plan_key <> 'free'::text;
REVOKE ALL ON public.user_badge_tiers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.user_badge_tiers TO authenticated;

CREATE POLICY membership_subs_own ON public.membership_subscriptions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (user_id = ( SELECT (u.id)::text AS id
   FROM users u
  WHERE (u.auth_id = ((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))
 LIMIT 1));

CREATE POLICY sneaky_subs_own ON public.sneaky_subscriptions
  AS PERMISSIVE FOR ALL TO public
  USING (host_id = ( SELECT ((current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));

CREATE OR REPLACE FUNCTION public.is_entitled(uid text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jwt_sub text := current_setting('request.jwt.claims', true)::json ->> 'sub';
  v_role    text := current_setting('request.jwt.claims', true)::json ->> 'role';
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND uid <> v_jwt_sub THEN
    RETURN NULL;
  END IF;
  RETURN (
    SELECT plan_key
    FROM membership_subscriptions
    WHERE user_id = uid
      AND (
        (status IN ('active','trialing')
          AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'past_due'
          AND grace_period_ends_at IS NOT NULL
          AND grace_period_ends_at > now())
      )
    ORDER BY current_period_end DESC NULLS LAST
    LIMIT 1
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.is_entitled(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_entitled(text) TO service_role;

CREATE OR REPLACE FUNCTION public.is_entitled_self()
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.is_entitled_self() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_entitled_self() TO authenticated;
