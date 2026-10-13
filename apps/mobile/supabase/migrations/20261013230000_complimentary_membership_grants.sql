-- Prepared only: no recipients are seeded and no paid subscription is modified.
-- Explicit, audited VIP grants. No staff-role rule, account creation, or processor write.
-- Identity snapshots deliberately do not add users FKs: deleting an account
-- must not be blocked by an audit record. Reads require a current exact binding.
BEGIN;
CREATE TABLE public.membership_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  profile_user_id bigint NOT NULL,
  plan_key text NOT NULL DEFAULT 'dvnt_vip' CHECK (plan_key = 'dvnt_vip'),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);
CREATE INDEX membership_grants_owner ON public.membership_grants(user_id);
ALTER TABLE public.membership_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_grants FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membership_grants TO service_role;

-- A narrowly scoped own-record read, without exposing audit rows or depending
-- on the caller having access to users.auth_id (a private identity column).
CREATE VIEW public.membership_grant_records WITH (security_barrier = true) AS
SELECT g.user_id, 'dvnt_membership'::text AS product_family, g.plan_key,
  CASE WHEN g.revoked_at IS NULL AND g.starts_at <= now() THEN 'active' ELSE 'inactive' END AS status,
  g.expires_at AS current_period_end, false AS cancel_at_period_end,
  NULL::timestamptz AS grace_period_ends_at, NULL::text AS rail,
  NULL::text AS stripe_subscription_id, NULL::text AS stripe_customer_id,
  'complimentary'::text AS source
FROM public.membership_grants g
JOIN public.users u ON u.id = g.profile_user_id AND u.auth_id = g.user_id
  AND (SELECT count(*) FROM public.users bound WHERE bound.auth_id = g.user_id) = 1
JOIN public."user" a ON a.id = g.user_id AND a.banned IS NOT TRUE
WHERE u.banned_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM payload.members m WHERE m.app_user_id = u.id::text
    AND m.status IN ('suspended','banned','shadow_banned'))
  AND ((nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') = 'service_role'
  OR g.user_id = (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'));
REVOKE ALL ON public.membership_grant_records FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membership_grant_records TO authenticated, service_role;

-- Append-only ledger; trusted service tooling supplies a verified actor's stable
-- public.users id. Both actor and recipient auth identities are snapshotted.
CREATE TABLE public.membership_grant_events (
  request_id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES public.membership_grants(id),
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  actor_user_id bigint NOT NULL,
  actor_auth_id text NOT NULL,
  subject_user_id bigint NOT NULL,
  subject_auth_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.membership_grant_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.membership_grant_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membership_grant_events TO service_role;

CREATE FUNCTION public.grant_complimentary_vip(
  p_user_id bigint, p_actor_user_id bigint, p_reason text,
  p_expires_at timestamptz, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user_auth text;
  v_actor_auth text;
  v_grant uuid;
  v_existing public.membership_grant_events%ROWTYPE;
BEGIN
  -- ACL is the primary gate; the JWT check also denies accidental nested calls
  -- from a definer function exposed to ordinary authenticated users.
  IF (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'request id and reason required' USING ERRCODE = '22023';
  END IF;
  -- Serialize retries using the idempotency key; a reused key must match exactly.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_existing FROM public.membership_grant_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.action <> 'grant' OR v_existing.subject_user_id IS DISTINCT FROM p_user_id
      OR v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.reason IS DISTINCT FROM btrim(p_reason)
      OR v_existing.expires_at IS DISTINCT FROM p_expires_at THEN
      RAISE EXCEPTION 'request id conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.grant_id;
  END IF;
  SELECT auth_id INTO v_user_auth FROM public.users WHERE id = p_user_id FOR SHARE;
  SELECT auth_id INTO v_actor_auth FROM public.users WHERE id = p_actor_user_id FOR SHARE;
  IF nullif(btrim(v_user_auth),'') IS NULL OR nullif(btrim(v_actor_auth),'') IS NULL
    OR (SELECT count(*) FROM public.users WHERE auth_id = v_user_auth) <> 1
    OR (SELECT count(*) FROM public.users WHERE auth_id = v_actor_auth) <> 1 THEN
    RAISE EXCEPTION 'recipient and actor require unique verified app identities' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u JOIN public."user" a ON a.id = u.auth_id
    WHERE u.id = p_user_id AND u.auth_id = v_user_auth AND u.banned_at IS NULL AND a.banned IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM payload.members m WHERE m.app_user_id = u.id::text
        AND m.status IN ('suspended','banned','shadow_banned'))) THEN
    RAISE EXCEPTION 'recipient is unavailable or moderation-restricted' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'expiry must be in the future or explicitly null' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.membership_grants(user_id,profile_user_id,expires_at)
    VALUES (v_user_auth,p_user_id,p_expires_at) RETURNING id INTO v_grant;
  INSERT INTO public.membership_grant_events(request_id,grant_id,action,actor_user_id,actor_auth_id,
    subject_user_id,subject_auth_id,reason,expires_at)
    VALUES (p_request_id,v_grant,'grant',p_actor_user_id,v_actor_auth,p_user_id,v_user_auth,btrim(p_reason),p_expires_at);
  RETURN v_grant;
END;
$$;

CREATE FUNCTION public.revoke_complimentary_vip(
  p_grant_id uuid, p_actor_user_id bigint, p_reason text, p_request_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_auth text;
  v_grant public.membership_grants%ROWTYPE;
  v_existing public.membership_grant_events%ROWTYPE;
BEGIN
  IF (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'request id and reason required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_existing FROM public.membership_grant_events WHERE request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.action <> 'revoke' OR v_existing.grant_id IS DISTINCT FROM p_grant_id
      OR v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR v_existing.reason IS DISTINCT FROM btrim(p_reason) THEN
      RAISE EXCEPTION 'request id conflict' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing.grant_id;
  END IF;
  SELECT auth_id INTO v_actor_auth FROM public.users WHERE id = p_actor_user_id FOR SHARE;
  IF nullif(btrim(v_actor_auth),'') IS NULL OR (SELECT count(*) FROM public.users WHERE auth_id = v_actor_auth) <> 1 THEN
    RAISE EXCEPTION 'actor requires unique verified app identity' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO STRICT v_grant FROM public.membership_grants WHERE id = p_grant_id FOR UPDATE;
  IF v_grant.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'grant already revoked; use the original request id for retries' USING ERRCODE = '22023';
  END IF;
  UPDATE public.membership_grants SET revoked_at = now() WHERE id = p_grant_id;
  INSERT INTO public.membership_grant_events(request_id,grant_id,action,actor_user_id,actor_auth_id,
    subject_user_id,subject_auth_id,reason,expires_at)
    VALUES (p_request_id,p_grant_id,'revoke',p_actor_user_id,v_actor_auth,
      v_grant.profile_user_id,v_grant.user_id,btrim(p_reason),v_grant.expires_at);
  RETURN p_grant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.grant_complimentary_vip(bigint,bigint,text,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_complimentary_vip(uuid,bigint,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_complimentary_vip(bigint,bigint,text,timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_complimentary_vip(uuid,bigint,text,uuid) TO service_role;

-- One service-only effective tier for badges, existing entitlement RPCs and door
-- roster/scanner perks. Processor fields are never copied into grant rows or this public-facing
-- tier projection. Canonical auth-id ownership wins an ambiguous numeric key;
-- a legacy profile-id owner is used only if no canonical owner exists.
CREATE VIEW public.effective_membership_tiers WITH (security_barrier = true) AS
WITH plans(plan_key, product_family, rank) AS (VALUES
  ('sneaky_tier_1','sneaky_lynk',1), ('sneaky_tier_2','sneaky_lynk',2),
  ('dvnt_core','dvnt_membership',3), ('dvnt_insider','dvnt_membership',4),
  ('dvnt_vip','dvnt_membership',5), ('dvnt_founders_circle','dvnt_membership',6)
), paid AS (
  SELECT public.membership_subscription_auth_id(s.user_id) AS user_id,
    s.plan_key, s.product_family, s.status, s.current_period_end,
    s.cancel_at_period_end, s.grace_period_ends_at
  FROM public.membership_subscriptions s
  UNION ALL
  SELECT u.auth_id,
    CASE s.plan_id WHEN 'host_25' THEN 'sneaky_tier_1' WHEN 'host_50' THEN 'sneaky_tier_2' ELSE 'free' END,
    'sneaky_lynk', s.status, s.current_period_end, s.cancel_at_period_end, s.grace_period_ends_at
  FROM public.sneaky_subscriptions s JOIN public.users u ON u.auth_id = s.host_id
    AND (SELECT count(*) FROM public.users bound WHERE bound.auth_id = s.host_id) = 1
), active AS (
  SELECT s.user_id, s.plan_key, p.rank FROM paid s
  JOIN plans p ON p.plan_key = s.plan_key AND p.product_family = s.product_family
  WHERE s.user_id IS NOT NULL AND (
    (s.status IN ('active','trialing') AND (s.current_period_end IS NULL OR s.current_period_end > now()))
    OR (s.status = 'past_due' AND s.grace_period_ends_at > now())
    OR (s.status = 'canceled' AND s.cancel_at_period_end IS TRUE AND s.current_period_end > now())
  )
  UNION ALL
  SELECT g.user_id, g.plan_key, p.rank FROM public.membership_grants g
  JOIN public.users u ON u.id = g.profile_user_id AND u.auth_id = g.user_id
  AND (SELECT count(*) FROM public.users bound WHERE bound.auth_id = g.user_id) = 1
  JOIN public."user" a ON a.id = g.user_id AND a.banned IS NOT TRUE
  JOIN plans p ON p.plan_key = g.plan_key
  WHERE u.banned_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM payload.members m WHERE m.app_user_id = u.id::text
      AND m.status IN ('suspended','banned','shadow_banned'))
    AND g.revoked_at IS NULL AND g.starts_at <= now()
    AND (g.expires_at IS NULL OR g.expires_at > now())
)
SELECT DISTINCT ON (user_id) user_id, plan_key, rank FROM active ORDER BY user_id, rank DESC;
REVOKE ALL ON public.effective_membership_tiers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.effective_membership_tiers TO service_role;

-- Keep the established public badge shape. Neither auth ids nor audit/billing
-- data become public. Badge art/components are unchanged.
-- The definer helper exposes only numeric profile IDs and badge plans. View
-- callers cannot execute the private auth-ID mapper through a nested view.
CREATE FUNCTION public.membership_badge_tiers()
RETURNS TABLE (profile_user_id bigint, plan_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id::bigint, t.plan_key FROM public.users u
  JOIN public.effective_membership_tiers t ON t.user_id = u.auth_id;
$$;
REVOKE ALL ON FUNCTION public.membership_badge_tiers() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.membership_badge_tiers() TO authenticated;
CREATE OR REPLACE VIEW public.user_badge_tiers AS
SELECT u.id::text AS user_id, u.username, t.plan_key
FROM public.users u JOIN public.membership_badge_tiers() t ON t.profile_user_id = u.id;
-- Preserve the verified live audience: signed-in profile badge reads only.
REVOKE ALL ON public.user_badge_tiers FROM PUBLIC, anon, service_role;
GRANT SELECT ON public.user_badge_tiers TO authenticated;

CREATE OR REPLACE FUNCTION public.is_entitled(uid text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_claims jsonb := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
BEGIN
  IF v_claims->>'role' IS DISTINCT FROM 'service_role' AND uid IS DISTINCT FROM (v_claims->>'sub') THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT plan_key FROM public.effective_membership_tiers WHERE user_id = uid);
END;
$$;
CREATE OR REPLACE FUNCTION public.is_entitled_self()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.is_entitled(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub');
$$;
-- Preserve existing caller audiences. The self RPC has no caller-supplied ID;
-- its definer context only bridges to the service-only effective-tier lookup.
REVOKE ALL ON FUNCTION public.is_entitled(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_entitled_self() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_entitled(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_entitled_self() TO authenticated;

-- The optional watch_door_summary RPC is absent from the verified live schema.
-- Its separate feature migration remains responsible for creating/updating it.

COMMIT;
