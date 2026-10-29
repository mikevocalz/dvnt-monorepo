-- New explicit four-hour opt-ins only. The original RPC stays one hour for
-- older clients whose confirmation promises one hour. No existing grant changes.
BEGIN;
CREATE FUNCTION public.member_map_update_settings_four_hours(
 p_user_id text,p_expected_revision integer,p_location_enabled boolean,
 p_events_map_enabled boolean,p_consent_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 -- Reuse eligibility, consent, revision lock, revocation and point removal.
 -- The lock is retained until this transaction completes.
 PERFORM public.member_map_update_settings(p_user_id,p_expected_revision,
  p_location_enabled,p_events_map_enabled,p_consent_version);
 IF p_location_enabled AND p_events_map_enabled THEN
  UPDATE public.member_map_settings SET share_until=now()+interval '4 hours'
   WHERE user_id=p_user_id;
 END IF;
 RETURN public.member_map_get_settings(p_user_id);
END; $$;
REVOKE ALL ON FUNCTION public.member_map_update_settings_four_hours(text,integer,boolean,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_map_update_settings_four_hours(text,integer,boolean,boolean,text) TO service_role;
COMMIT;
