-- Fresh v2 consent only. Legacy one/four-hour grants are never extended.
BEGIN;
ALTER TABLE public.member_map_settings ADD COLUMN consent_session_id text REFERENCES public."session"(id) ON DELETE SET NULL;
ALTER TABLE public.member_map_settings DROP CONSTRAINT member_map_settings_check;
ALTER TABLE public.member_map_settings ADD CONSTRAINT member_map_settings_check CHECK (
 NOT events_map_enabled OR (location_enabled AND share_until IS NOT NULL AND
 (consent_version='events-map-v1' OR (consent_version='events-map-session-v2' AND consent_session_id IS NOT NULL)))
);

CREATE FUNCTION public.member_map_session_expiry(p_user_id text,p_session_id text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT "expiresAt"::timestamptz FROM public."session"
 WHERE id=p_session_id AND "userId"=p_user_id AND "expiresAt"::timestamptz>now();
$$;
CREATE FUNCTION public.member_map_grant_live(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((SELECT location_enabled AND events_map_enabled AND share_until>now() AND
 (consent_version='events-map-v1' OR (consent_version='events-map-session-v2' AND
 public.member_map_session_expiry(user_id,consent_session_id)>now()))
 FROM public.member_map_settings WHERE user_id=p_user_id),false);
$$;
CREATE FUNCTION public.member_map_session_settings(p_user_id text,p_session_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT public.member_map_get_settings(p_user_id) || jsonb_build_object(
 'sessionKey',p_session_id,'sessionExpiresAt',public.member_map_session_expiry(p_user_id,p_session_id),
 'eventsMapEnabled',COALESCE((SELECT public.member_map_grant_live(user_id) AND
 (consent_version='events-map-v1' OR consent_session_id=p_session_id)
 FROM public.member_map_settings WHERE user_id=p_user_id),false),
 'shareUntil',(SELECT least(share_until,
 CASE WHEN consent_version='events-map-session-v2' THEN public.member_map_session_expiry(user_id,consent_session_id) ELSE share_until END)
 FROM public.member_map_settings WHERE user_id=p_user_id AND public.member_map_grant_live(user_id)
 AND (consent_version='events-map-v1' OR consent_session_id=p_session_id)),
 'consentVersion',(SELECT consent_version FROM public.member_map_settings WHERE user_id=p_user_id)
 );
$$;
CREATE FUNCTION public.member_map_update_session(p_user_id text,p_session_id text,p_expected_revision integer,
 p_location_enabled boolean,p_events_map_enabled boolean,p_consent_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE expiry timestamptz;
BEGIN
 expiry:=public.member_map_session_expiry(p_user_id,p_session_id);
 IF expiry IS NULL THEN RAISE EXCEPTION 'Live sign-in required' USING ERRCODE='42501'; END IF;
 IF p_events_map_enabled AND p_consent_version IS DISTINCT FROM 'events-map-session-v2' THEN
  RAISE EXCEPTION 'Explicit session map consent required' USING ERRCODE='42501';
 END IF;
 -- Existing revision lock, eligibility, purge and overall-off safeguards.
 PERFORM public.member_map_update_settings(p_user_id,p_expected_revision,p_location_enabled,p_events_map_enabled,
 CASE WHEN p_events_map_enabled THEN 'events-map-v1' END);
 UPDATE public.member_map_settings SET
 consent_version=CASE WHEN p_events_map_enabled AND p_location_enabled THEN 'events-map-session-v2' END,
 consent_session_id=CASE WHEN p_events_map_enabled AND p_location_enabled THEN p_session_id END,
 share_until=CASE WHEN p_events_map_enabled AND p_location_enabled THEN expiry END WHERE user_id=p_user_id;
 RETURN public.member_map_session_settings(p_user_id,p_session_id);
END; $$;
CREATE FUNCTION public.member_map_publish_session(p_user_id text,p_session_id text,p_revision integer,p_latitude double precision,
 p_longitude double precision,p_observed_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.member_map_settings; lat double precision; lng double precision; step double precision; expires timestamptz;
BEGIN
 SELECT * INTO s FROM public.member_map_settings WHERE user_id=p_user_id FOR UPDATE;
 IF s.user_id IS NULL OR NOT s.location_enabled OR NOT s.events_map_enabled
  OR (s.consent_version IS DISTINCT FROM 'events-map-session-v2' OR s.consent_session_id IS DISTINCT FROM p_session_id OR NOT public.member_map_grant_live(p_user_id))
  OR p_revision IS NULL OR p_revision<>s.revision OR NOT public.member_map_eligible(p_user_id)
 THEN RAISE EXCEPTION 'Map sharing is off or expired' USING ERRCODE='42501'; END IF;
 IF p_latitude IS NULL OR p_longitude IS NULL OR NOT(p_latitude BETWEEN -85 AND 85)
  OR NOT(p_longitude BETWEEN -180 AND 180) OR p_observed_at IS NULL
  OR p_observed_at<now()-interval '60 seconds' OR p_observed_at>now()+interval '5 seconds'
 THEN RAISE EXCEPTION 'Fresh valid location required' USING ERRCODE='22023'; END IF;
 -- Approximately 1.1km stable cells; no raw GPS or accuracy is stored.
 lat:=round(p_latitude::numeric,2)::double precision;
 step:=0.01/greatest(cos(radians(lat)),0.1);
 lng:=greatest(-180,least(180,round((p_longitude/step)::numeric)::double precision*step));
 expires:=least(s.share_until,public.member_map_session_expiry(p_user_id,p_session_id),p_observed_at+interval '15 minutes');
 INSERT INTO public.member_map_presence(user_id,latitude,longitude,observed_at,expires_at,revision)
 VALUES(p_user_id,lat,lng,p_observed_at,expires,p_revision)
 ON CONFLICT(user_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
  observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at,revision=EXCLUDED.revision;
 RETURN jsonb_build_object('published',true,'expiresAt',expires);
END; $$;
CREATE OR REPLACE FUNCTION public.member_map_nearby(p_user_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE viewer public.member_map_presence; viewer_id integer; result jsonb; self_member jsonb; viewer_expires timestamptz;
BEGIN
 SELECT p.* INTO viewer FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
 WHERE p.user_id=p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
  AND s.location_enabled AND s.events_map_enabled AND s.share_until>now()
  AND public.member_map_grant_live(s.user_id) AND p.revision=s.revision;
 IF viewer.user_id IS NULL OR NOT public.member_map_eligible(p_user_id) THEN
  RETURN jsonb_build_object('members','[]'::jsonb,'self',NULL,'center',NULL,'expiresAt',NULL);
 END IF;
 -- Self is the same coarse, server-published point, never a device/GPS fallback.
 -- Keep it separate so the peer cap, ordering, and block filtering remain unchanged.
 SELECT u.id, least(viewer.expires_at,s.share_until,CASE WHEN s.consent_version='events-map-session-v2' THEN public.member_map_session_expiry(s.user_id,s.consent_session_id) ELSE s.share_until END),
  jsonb_build_object('id',u.id::text,'username',u.username,
   'displayName',COALESCE(NULLIF(u.first_name,''),u.username),'avatarUrl',m.url,
   'latitude',viewer.latitude,'longitude',viewer.longitude,
   'expiresAt',least(viewer.expires_at,s.share_until,CASE WHEN s.consent_version='events-map-session-v2' THEN public.member_map_session_expiry(s.user_id,s.consent_session_id) ELSE s.share_until END))
 INTO viewer_id, viewer_expires, self_member
 FROM public.users u JOIN public.member_map_settings s ON s.user_id=u.auth_id
 LEFT JOIN public.media m ON m.id=u.avatar_id WHERE u.auth_id=p_user_id;
 SELECT COALESCE(jsonb_agg(row_data),'[]'::jsonb) INTO result FROM (
  SELECT jsonb_build_object('id',u.id::text,'username',u.username,
   'displayName',COALESCE(NULLIF(u.first_name,''),u.username),'avatarUrl',m.url,
   'latitude',p.latitude,'longitude',p.longitude,'expiresAt',least(p.expires_at,s.share_until,CASE WHEN s.consent_version='events-map-session-v2' THEN public.member_map_session_expiry(s.user_id,s.consent_session_id) ELSE s.share_until END)) row_data
  FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
  JOIN public.users u ON u.auth_id=p.user_id LEFT JOIN public.media m ON m.id=u.avatar_id
  WHERE p.user_id<>p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
   AND s.location_enabled AND s.events_map_enabled AND s.share_until>now()
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

CREATE FUNCTION public.member_map_nearby_session(p_user_id text,p_session_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF public.member_map_session_expiry(p_user_id,p_session_id) IS NULL OR EXISTS(
 SELECT 1 FROM public.member_map_settings WHERE user_id=p_user_id AND consent_version='events-map-session-v2'
 AND consent_session_id IS DISTINCT FROM p_session_id) THEN
 RETURN jsonb_build_object('members','[]'::jsonb,'self',NULL,'center',NULL,'expiresAt',NULL);
 END IF;
 RETURN public.member_map_nearby(p_user_id);
END; $$;
-- Successful sign-out / remote session revocation withdraws immediately.
-- An offline local sign-out cannot delete a server session; the last point
-- still expires within fifteen minutes and the device stops publishing.
CREATE FUNCTION public.member_map_session_deleted() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.member_map_settings SET events_map_enabled=false,consent_version=NULL,
 consent_session_id=NULL,share_until=NULL,revision=revision+1
 WHERE consent_session_id=OLD.id AND user_id=OLD."userId";
 DELETE FROM public.member_map_presence p USING public.member_map_settings s
 WHERE p.user_id=s.user_id AND s.user_id=OLD."userId" AND NOT s.events_map_enabled;
 RETURN OLD;
END; $$;
CREATE TRIGGER member_map_session_deleted BEFORE DELETE ON public."session"
FOR EACH ROW EXECUTE FUNCTION public.member_map_session_deleted();
REVOKE ALL ON FUNCTION public.member_map_session_expiry(text,text),public.member_map_grant_live(text),
 public.member_map_session_settings(text,text),public.member_map_update_session(text,text,integer,boolean,boolean,text),
 public.member_map_publish_session(text,text,integer,double precision,double precision,timestamptz),
 public.member_map_nearby_session(text,text),public.member_map_session_deleted() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_map_session_expiry(text,text),public.member_map_grant_live(text),
 public.member_map_session_settings(text,text),public.member_map_update_session(text,text,integer,boolean,boolean,text),
 public.member_map_publish_session(text,text,integer,double precision,double precision,timestamptz),
 public.member_map_nearby_session(text,text) TO service_role;
COMMIT;
NOTIFY pgrst,'reload schema';
