-- Reuse existing server-owned legacy adult approval; do not fabricate ID evidence.
-- Location sharing still requires independent explicit consent and all map privacy gates.
BEGIN;
CREATE OR REPLACE FUNCTION public.member_map_eligible(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.users u JOIN public."user" a ON a.id=u.auth_id
  LEFT JOIN public.identity_verifications v ON v.user_id=u.auth_id
  JOIN public.verified_admission_policy policy ON policy.id=1
  LEFT JOIN public.user_settings us ON us.auth_id=u.auth_id
  WHERE u.auth_id=p_user_id AND u.is_private IS FALSE
   AND COALESCE(to_jsonb(u)->>'private_account','false')='false'
   AND COALESCE(us.settings #>> '{privacy,privateAccount}','false')='false'
   AND u.banned_at IS NULL AND a.banned IS NOT TRUE
   AND public.member_map_moderation_clear(u.id)
   AND ((v.status='passed' AND v.date_of_birth IS NOT NULL
   AND v.date_of_birth <= (CURRENT_DATE - interval '18 years')::date
   AND v.date_of_birth > (CURRENT_DATE - interval '121 years')::date
   AND COALESCE(v.failure_code,'') NOT IN ('underage','duplicate_identity'))
     OR public.legacy_adult_content_access(p_user_id))
   AND NOT(p_user_id=ANY(policy.denylist))
 );
$$;
COMMIT;
