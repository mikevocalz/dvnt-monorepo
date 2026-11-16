-- Presentation-only RPC. Apply before deploying the profile readers.
-- No rows, follow grants, approvals or post-access policies are changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.profile_is_private(p_user_id bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  -- This one boolean is intentionally public, like users.is_private. Keep the
  -- underlying settings (and their presence/content) inaccessible to clients.
  -- Match post_relationship_access/post_follow_hidden, including malformed
  -- legacy nonfalse values, rather than silently presenting them as Public.
  SELECT coalesce(u.is_private, false)
    OR coalesce(s.settings#>>'{privacy,privateAccount}', 'false') <> 'false'
  FROM public.users u
  LEFT JOIN public.user_settings s ON s.auth_id = u.auth_id
  WHERE u.id = p_user_id;
$$;
REVOKE ALL ON FUNCTION public.profile_is_private(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.profile_is_private(bigint) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.profile_is_private(bigint) IS
  'Public profile presentation flag only. Does not grant access to posts or relationships. NULL means profile not found.';
COMMIT;
NOTIFY pgrst, 'reload schema';
