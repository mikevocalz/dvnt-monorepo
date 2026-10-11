-- A legacy entitlement is not a fabricated identity document or date of birth.
BEGIN;
CREATE TABLE public.legacy_adult_access (
  auth_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
  profile_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  basis text NOT NULL CHECK (basis IN ('pre_july_membership','owner_confirmed_legacy')),
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by text NOT NULL,
  revoked_at timestamptz,
  note text NOT NULL
);
ALTER TABLE public.legacy_adult_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_adult_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.legacy_adult_access TO service_role;
CREATE FUNCTION public.legacy_adult_content_access(p_auth_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.legacy_adult_access g
    JOIN public.users u ON u.id=g.profile_id AND u.auth_id=g.auth_id
    JOIN public."user" a ON a.id=g.auth_id
    WHERE g.auth_id=p_auth_id AND g.revoked_at IS NULL
      AND u.banned_at IS NULL AND a.banned IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM payload.members m WHERE m.app_user_id=u.id::text
        AND m.status IN ('suspended','banned','shadow_banned'))
      AND NOT EXISTS (SELECT 1 FROM public.verified_admission_policy p
        WHERE p.id=1 AND p_auth_id=ANY(p.denylist))
      AND NOT EXISTS (SELECT 1 FROM public.identity_verifications v WHERE v.user_id=g.auth_id
        AND (v.failure_code IN ('underage','duplicate_identity') OR v.status='failed'
          OR v.date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date))
  );
$$;
REVOKE ALL ON FUNCTION public.legacy_adult_content_access(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_adult_content_access(text) TO service_role;
COMMENT ON TABLE public.legacy_adult_access IS
  'Server-owned legacy membership eligibility; no identity provider pass or DOB is created. Revocation and safety blocks take precedence.';
INSERT INTO public.legacy_adult_access(auth_id,profile_id,basis,approved_by,note)
SELECT u.auth_id,u.id,'pre_july_membership','platform_owner_policy_2026_10_06',
  'Existing membership created before 2026-07-01; owner-confirmed cohort policy.'
FROM public.users u JOIN public."user" a ON a.id=u.auth_id
WHERE u.created_at < timestamptz '2026-07-01T00:00:00Z'
  AND u.banned_at IS NULL AND a.banned IS NOT TRUE
ON CONFLICT(auth_id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
 SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
 OR EXISTS (SELECT 1 FROM public.identity_verifications v
   WHERE v.user_id = auth.jwt() ->> 'sub' AND v.status='passed'
     AND v.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')::date
     AND v.date_of_birth > (CURRENT_DATE - INTERVAL '121 years')::date
     AND COALESCE(v.failure_code,'') NOT IN ('underage','duplicate_identity'))
 OR public.legacy_adult_content_access(auth.jwt() ->> 'sub');
$$;
REVOKE ALL ON FUNCTION public.viewer_is_verified_adult() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_verified_adult() TO anon,authenticated,service_role;
COMMIT;
