-- Show the consenting viewer alongside peers without collecting a new location.
BEGIN;
CREATE OR REPLACE FUNCTION public.member_map_nearby(p_user_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE viewer public.member_map_presence; viewer_id integer; result jsonb; self_member jsonb; viewer_expires timestamptz;
BEGIN
 SELECT p.* INTO viewer FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
 WHERE p.user_id=p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
  AND s.location_enabled AND s.events_map_enabled AND s.share_until>now()
  AND s.consent_version='events-map-v1' AND p.revision=s.revision;
 IF viewer.user_id IS NULL OR NOT public.member_map_eligible(p_user_id) THEN
  RETURN jsonb_build_object('members','[]'::jsonb,'self',NULL,'center',NULL,'expiresAt',NULL);
 END IF;
 -- Self is the same coarse, server-published point, never a device/GPS fallback.
 -- Keep it separate so the peer cap, ordering, and block filtering remain unchanged.
 SELECT u.id, least(viewer.expires_at,s.share_until),
  jsonb_build_object('id',u.id::text,'username',u.username,
   'displayName',COALESCE(NULLIF(u.first_name,''),u.username),'avatarUrl',m.url,
   'latitude',viewer.latitude,'longitude',viewer.longitude,
   'expiresAt',least(viewer.expires_at,s.share_until))
 INTO viewer_id, viewer_expires, self_member
 FROM public.users u JOIN public.member_map_settings s ON s.user_id=u.auth_id
 LEFT JOIN public.media m ON m.id=u.avatar_id WHERE u.auth_id=p_user_id;
 SELECT COALESCE(jsonb_agg(row_data),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',u.id::text,'username',u.username,
   'displayName',COALESCE(NULLIF(u.first_name,''),u.username),'avatarUrl',m.url,
   'latitude',p.latitude,'longitude',p.longitude,'expiresAt',least(p.expires_at,s.share_until)) row_data
  FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
  JOIN public.users u ON u.auth_id=p.user_id LEFT JOIN public.media m ON m.id=u.avatar_id
  WHERE p.user_id<>p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
   AND s.location_enabled AND s.events_map_enabled AND s.share_until>now()
   AND s.consent_version='events-map-v1' AND p.revision=s.revision
   AND public.member_map_eligible(p.user_id)
   AND NOT EXISTS(SELECT 1 FROM public.blocks b WHERE
    (b.blocker_id=viewer_id AND b.blocked_id=u.id) OR (b.blocker_id=u.id AND b.blocked_id=viewer_id))
   AND 6371*2*asin(least(1,sqrt(power(sin(radians(p.latitude-viewer.latitude)/2),2)
    +cos(radians(viewer.latitude))*cos(radians(p.latitude))*power(sin(radians(p.longitude-viewer.longitude)/2),2))))<=50
  ORDER BY p.user_id LIMIT 100
 ) eligible;
 RETURN jsonb_build_object('members',result,'self',self_member,
  'center',jsonb_build_object('latitude',viewer.latitude,'longitude',viewer.longitude),'expiresAt',viewer_expires);
END; $$;
COMMIT;
