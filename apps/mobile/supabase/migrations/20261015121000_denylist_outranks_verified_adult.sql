-- Operator denylist outranks a passed ID, the allowlist and enforce = false.
--
-- verified_participation_allowed() (20261003180000) returned true at
-- `WHEN NOT p.enforce` before it read the denylist, and with enforcement on
-- the denylist only cancelled an allowlist hit, so a denied account with a
-- passed adult ID still passed through is_verified_self().
-- viewer_is_verified_adult() (20261011203000) never read the denylist on its
-- identity_verifications branch. Both are copied verbatim from those files
-- with one denylist branch added each. SECURITY DEFINER, search_path and
-- grants are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public.verified_participation_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    ELSE (
      SELECT
        CASE
          -- An under-18 document closes participation whatever the config says.
          WHEN EXISTS (
            SELECT 1 FROM public.identity_verifications v
            WHERE v.user_id = sub.id AND v.date_of_birth IS NOT NULL
              AND v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date
          ) THEN false
          -- An operator-denied account stays closed whatever the rollout
          -- switch, the allowlist or a passed ID says.
          WHEN sub.id IS NOT NULL AND sub.id = ANY (p.denylist) THEN false
          -- A checkout-created profile is locked until it passes adult
          -- verification, whatever the rollout switch says.
          WHEN sub.id IS NOT NULL AND public.is_checkout_restricted(sub.id) THEN false
          WHEN NOT p.enforce THEN true
          WHEN sub.id IS NULL THEN false
          WHEN sub.id = ANY (p.allowlist) AND NOT sub.id = ANY (p.denylist) THEN true
          -- Grace is opt-in: only a deadline still in the future admits an
          -- unverified account. NULL means refuse.
          ELSE public.is_verified_self()
            OR (p.grace_deadline IS NOT NULL AND now() < p.grace_deadline)
        END
      FROM public.verified_admission_policy p,
           LATERAL (SELECT auth.jwt() ->> 'sub' AS id) sub
      WHERE p.id = 1
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.verified_participation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verified_participation_allowed() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
 SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
 OR (
   -- An operator-denied caller is never a verified adult, passed ID or not.
   NOT EXISTS (SELECT 1 FROM public.verified_admission_policy p
     WHERE p.id = 1 AND (auth.jwt() ->> 'sub') = ANY (p.denylist))
   AND (
     EXISTS (SELECT 1 FROM public.identity_verifications v
       WHERE v.user_id = auth.jwt() ->> 'sub' AND v.status='passed'
         AND v.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
         AND v.date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
         AND COALESCE(v.failure_code,'') NOT IN ('underage','duplicate_identity'))
     OR public.legacy_adult_content_access(auth.jwt() ->> 'sub')
   )
 );
$$;
REVOKE ALL ON FUNCTION public.viewer_is_verified_adult() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_verified_adult() TO anon,authenticated,service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
