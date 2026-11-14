-- Explicit account-wide v3 consent only. No existing v1/v2 grant is upgraded.
BEGIN;
ALTER TABLE public.member_map_presence ADD COLUMN publisher_session_id text REFERENCES public."session"(id) ON DELETE CASCADE;
ALTER TABLE public.member_map_settings DROP CONSTRAINT member_map_settings_check;
ALTER TABLE public.member_map_settings ADD CONSTRAINT member_map_settings_check CHECK (
 NOT events_map_enabled OR (location_enabled AND (
  (consent_version='events-map-account-v3' AND share_until IS NULL AND consent_session_id IS NULL)
  OR (share_until IS NOT NULL AND (consent_version='events-map-v1'
   OR (consent_version='events-map-session-v2' AND consent_session_id IS NOT NULL)))
  ))
);
CREATE OR REPLACE FUNCTION public.member_map_grant_live(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((SELECT location_enabled AND events_map_enabled AND
  (consent_version='events-map-account-v3' OR (share_until>now() AND
   (consent_version='events-map-v1' OR (consent_version='events-map-session-v2'
    AND public.member_map_session_expiry(user_id,consent_session_id)>now()))))
 FROM public.member_map_settings WHERE user_id=p_user_id),false);
$$;
CREATE OR REPLACE FUNCTION public.member_map_get_settings(p_user_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_build_object(
 'locationEnabled',s.location_enabled,'eventsMapEnabled',public.member_map_grant_live(s.user_id),
 'revision',s.revision,'shareUntil',CASE WHEN public.member_map_grant_live(s.user_id) THEN s.share_until END,
 'consentVersion',s.consent_version
 ) FROM public.member_map_settings s WHERE s.user_id=p_user_id),
 '{"locationEnabled":false,"eventsMapEnabled":false,"revision":0,"shareUntil":null,"consentVersion":null}'::jsonb);
$$;
CREATE OR REPLACE FUNCTION public.member_map_session_settings(p_user_id text,p_session_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT public.member_map_get_settings(p_user_id) || jsonb_build_object(
 'sessionKey',p_session_id,'sessionExpiresAt',public.member_map_session_expiry(p_user_id,p_session_id),
 'eventsMapEnabled',public.member_map_session_expiry(p_user_id,p_session_id) IS NOT NULL AND COALESCE(
 (SELECT public.member_map_grant_live(user_id) AND (consent_version IN ('events-map-v1','events-map-account-v3') OR consent_session_id=p_session_id)
 FROM public.member_map_settings WHERE user_id=p_user_id),false),
 'shareUntil',(SELECT least(share_until,
 CASE WHEN consent_version='events-map-session-v2' THEN public.member_map_session_expiry(user_id,consent_session_id) ELSE share_until END)
 FROM public.member_map_settings WHERE user_id=p_user_id AND public.member_map_session_expiry(p_user_id,p_session_id) IS NOT NULL
 AND public.member_map_grant_live(user_id) AND (consent_version IN ('events-map-v1','events-map-account-v3') OR consent_session_id=p_session_id))
 );
$$;
CREATE FUNCTION public.member_map_update_account(p_user_id text,p_session_id text,p_expected_revision integer,
 p_location_enabled boolean,p_events_map_enabled boolean,p_consent_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF public.member_map_session_expiry(p_user_id,p_session_id) IS NULL THEN
  RAISE EXCEPTION 'Live sign-in required' USING ERRCODE='42501'; END IF;
 IF p_events_map_enabled AND p_consent_version IS DISTINCT FROM 'events-map-account-v3' THEN
  RAISE EXCEPTION 'Explicit account-wide map consent required' USING ERRCODE='42501'; END IF;
 -- Reuse revision locking, eligibility, overall-off safety and presence removal.
 PERFORM public.member_map_update_settings(p_user_id,p_expected_revision,p_location_enabled,p_events_map_enabled,
  CASE WHEN p_events_map_enabled THEN 'events-map-v1' END);
 UPDATE public.member_map_settings SET consent_version=CASE WHEN p_events_map_enabled AND p_location_enabled THEN 'events-map-account-v3' END,
  share_until=NULL,consent_session_id=NULL WHERE user_id=p_user_id;
 RETURN public.member_map_session_settings(p_user_id,p_session_id);
END; $$;
CREATE FUNCTION public.member_map_publish_account(p_user_id text,p_session_id text,p_revision integer,p_latitude double precision,
 p_longitude double precision,p_observed_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.member_map_settings; lat double precision; lng double precision; step double precision; expires timestamptz; session_expiry timestamptz;
BEGIN
 SELECT * INTO s FROM public.member_map_settings WHERE user_id=p_user_id FOR UPDATE;
 session_expiry:=public.member_map_session_expiry(p_user_id,p_session_id);
 IF s.user_id IS NULL OR s.consent_version IS DISTINCT FROM 'events-map-account-v3'
  OR NOT public.member_map_grant_live(p_user_id) OR session_expiry IS NULL
  OR p_revision IS NULL OR p_revision<>s.revision OR NOT public.member_map_eligible(p_user_id)
 THEN RAISE EXCEPTION 'Map sharing is off or expired' USING ERRCODE='42501'; END IF;
 IF p_latitude IS NULL OR p_longitude IS NULL OR NOT(p_latitude BETWEEN -85 AND 85)
  OR NOT(p_longitude BETWEEN -180 AND 180) OR p_observed_at IS NULL
  OR p_observed_at<now()-interval '60 seconds' OR p_observed_at>now()+interval '5 seconds'
 THEN RAISE EXCEPTION 'Fresh valid location required' USING ERRCODE='22023'; END IF;
 lat:=round(p_latitude::numeric,2)::double precision;
 step:=0.01/greatest(cos(radians(lat)),0.1);
 lng:=greatest(-180,least(180,round((p_longitude/step)::numeric)::double precision*step));
 expires:=least(session_expiry,p_observed_at+interval '15 minutes');
 INSERT INTO public.member_map_presence(user_id,latitude,longitude,observed_at,expires_at,revision,publisher_session_id)
 VALUES(p_user_id,lat,lng,p_observed_at,expires,p_revision,p_session_id)
 ON CONFLICT(user_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
  observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at,revision=EXCLUDED.revision,publisher_session_id=EXCLUDED.publisher_session_id;
 RETURN jsonb_build_object('published',true,'expiresAt',expires);
END; $$;
-- Bounds each point by its original publisher's live session, independently of durable consent.
CREATE FUNCTION public.member_map_presence_live(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((SELECT p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
  AND p.revision=s.revision AND public.member_map_grant_live(p.user_id)
  AND (s.consent_version<>'events-map-account-v3' OR public.member_map_session_expiry(p.user_id,p.publisher_session_id) IS NOT NULL)
 FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id) WHERE p.user_id=p_user_id),false);
$$;
CREATE FUNCTION public.member_map_presence_expiry(p_user_id text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT least(p.expires_at,s.share_until,
  CASE WHEN s.consent_version='events-map-session-v2' THEN public.member_map_session_expiry(p.user_id,s.consent_session_id)
   WHEN s.consent_version='events-map-account-v3' THEN public.member_map_session_expiry(p.user_id,p.publisher_session_id) ELSE p.expires_at END)
 FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
 WHERE p.user_id=p_user_id AND public.member_map_presence_live(p.user_id);
$$;
CREATE OR REPLACE FUNCTION public.member_map_nearby(p_user_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE viewer public.member_map_presence; viewer_id integer; result jsonb; self_member jsonb; viewer_expires timestamptz;
BEGIN
 SELECT p.* INTO viewer FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
 WHERE p.user_id=p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
  AND public.member_map_presence_live(p.user_id)
  AND public.member_map_grant_live(s.user_id) AND p.revision=s.revision;
 IF viewer.user_id IS NULL OR NOT public.member_map_eligible(p_user_id) THEN
  RETURN jsonb_build_object('members','[]'::jsonb,'self',NULL,'center',NULL,'expiresAt',NULL);
 END IF;
 -- Self is the same coarse, server-published point, never a device/GPS fallback.
 -- Keep it separate so the peer cap, ordering, and block filtering remain unchanged.
 SELECT u.id, public.member_map_presence_expiry(viewer.user_id),
  jsonb_build_object('id',u.id::text,'username',u.username,
   'displayName',COALESCE(NULLIF(u.first_name,''),u.username),'avatarUrl',m.url,
   'latitude',viewer.latitude,'longitude',viewer.longitude,
   'expiresAt',public.member_map_presence_expiry(viewer.user_id))
 INTO viewer_id, viewer_expires, self_member
 FROM public.users u JOIN public.member_map_settings s ON s.user_id=u.auth_id
 LEFT JOIN public.media m ON m.id=u.avatar_id WHERE u.auth_id=p_user_id;
 SELECT COALESCE(jsonb_agg(row_data),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',u.id::text,'username',u.username,
   'displayName',COALESCE(NULLIF(u.first_name,''),u.username),'avatarUrl',m.url,
   'latitude',p.latitude,'longitude',p.longitude,'expiresAt',public.member_map_presence_expiry(p.user_id)) row_data
  FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
  JOIN public.users u ON u.auth_id=p.user_id LEFT JOIN public.media m ON m.id=u.avatar_id
  WHERE p.user_id<>p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
   AND public.member_map_presence_live(p.user_id)
   AND public.member_map_grant_live(s.user_id) AND p.revision=s.revision
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


CREATE FUNCTION public.member_map_detach_session(p_user_id text,p_session_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.member_map_settings;
BEGIN
 IF public.member_map_session_expiry(p_user_id,p_session_id) IS NULL THEN
  RAISE EXCEPTION 'Live sign-in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.member_map_settings WHERE user_id=p_user_id FOR UPDATE;
 IF s.consent_version='events-map-account-v3' THEN
  DELETE FROM public.member_map_presence WHERE user_id=p_user_id AND publisher_session_id=p_session_id;
 ELSE
  PERFORM public.member_map_revoke(p_user_id,true);
 END IF;
 RETURN public.member_map_session_settings(p_user_id,p_session_id);
END; $$;
-- The existing sign-out trigger only revokes session-bound v2 grants.
-- Account grants have no consent_session_id; publisher FK removes only the point.
REVOKE ALL ON FUNCTION public.member_map_update_account(text,text,integer,boolean,boolean,text),
 public.member_map_publish_account(text,text,integer,double precision,double precision,timestamptz),
 public.member_map_presence_live(text),public.member_map_presence_expiry(text),
 public.member_map_detach_session(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_map_update_account(text,text,integer,boolean,boolean,text),
 public.member_map_publish_account(text,text,integer,double precision,double precision,timestamptz),
 public.member_map_presence_live(text),public.member_map_presence_expiry(text),
 public.member_map_detach_session(text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
