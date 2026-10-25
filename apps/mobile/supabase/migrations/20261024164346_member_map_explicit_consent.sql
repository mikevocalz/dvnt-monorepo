-- New independent consent; legacy city/proximity grants never enable avatar pins.
-- Service-only RPCs: the edge verifies Better Auth and expectedAuthId.
-- Only the narrow moderation boolean helper is SECURITY DEFINER.
-- Requires the existing member_proximity_presence migration first.
BEGIN;
CREATE TABLE public.member_map_settings (
 user_id text PRIMARY KEY REFERENCES public."user"(id) ON DELETE CASCADE,
 location_enabled boolean NOT NULL DEFAULT false,
 events_map_enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0,
 consent_version text,
 share_until timestamptz,
 CHECK (NOT events_map_enabled OR (location_enabled AND consent_version='events-map-v1' AND share_until IS NOT NULL))
);
CREATE TABLE public.member_map_presence (
 user_id text PRIMARY KEY REFERENCES public.member_map_settings(user_id) ON DELETE CASCADE,
 latitude double precision NOT NULL CHECK (latitude BETWEEN -85 AND 85),
 longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revision integer NOT NULL,
 CHECK (expires_at <= observed_at + interval '15 minutes')
);
CREATE INDEX member_map_presence_expiry_idx ON public.member_map_presence(expires_at);
ALTER TABLE public.member_map_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_map_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_map_settings,public.member_map_presence FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.member_map_settings TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.member_map_presence TO service_role;

-- Serialize legacy writes with master-off, so old clients cannot resurrect GPS.
CREATE FUNCTION public.member_map_guard_legacy_presence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE enabled boolean;
BEGIN
 SELECT location_enabled INTO enabled FROM public.member_map_settings WHERE user_id=NEW.user_id FOR UPDATE;
 IF enabled IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Overall location is disabled' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER member_map_guard_legacy_presence BEFORE INSERT OR UPDATE
 ON public.member_proximity_presence FOR EACH ROW EXECUTE FUNCTION public.member_map_guard_legacy_presence();
REVOKE ALL ON FUNCTION public.member_map_guard_legacy_presence() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_map_guard_legacy_presence() TO service_role;

-- The service role intentionally has no access to the private payload schema.
-- Expose only a boolean moderation decision, never its rows or status values.
CREATE FUNCTION public.member_map_moderation_clear(p_profile_id integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_profile_id) AND NOT EXISTS (
  SELECT 1 FROM payload.members m WHERE m.app_user_id=p_profile_id::text
   AND m.status IN ('suspended','banned','shadow_banned')
 );
$$;
REVOKE ALL ON FUNCTION public.member_map_moderation_clear(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_map_moderation_clear(integer) TO service_role;

CREATE FUNCTION public.member_map_eligible(p_user_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.users u JOIN public."user" a ON a.id=u.auth_id
  JOIN public.identity_verifications v ON v.user_id=u.auth_id
  JOIN public.verified_admission_policy policy ON policy.id=1
  LEFT JOIN public.user_settings us ON us.auth_id=u.auth_id
  WHERE u.auth_id=p_user_id AND u.is_private IS FALSE
   AND COALESCE(to_jsonb(u)->>'private_account','false')='false'
   AND COALESCE(us.settings #>> '{privacy,privateAccount}','false')='false'
   AND u.banned_at IS NULL AND a.banned IS NOT TRUE
   AND public.member_map_moderation_clear(u.id)
   AND v.status='passed' AND v.date_of_birth IS NOT NULL
   AND v.date_of_birth <= (CURRENT_DATE - interval '18 years')::date
   AND v.date_of_birth > (CURRENT_DATE - interval '121 years')::date
   AND COALESCE(v.failure_code,'') NOT IN ('underage','duplicate_identity')
   AND NOT(p_user_id=ANY(policy.denylist))
 );
$$;
CREATE FUNCTION public.member_map_get_settings(p_user_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((SELECT jsonb_build_object(
  'locationEnabled',s.location_enabled,
  'eventsMapEnabled',s.location_enabled AND s.events_map_enabled AND s.share_until>now(),
  'revision',s.revision,'shareUntil',CASE WHEN s.events_map_enabled AND s.share_until>now() THEN s.share_until END
 ) FROM public.member_map_settings s WHERE s.user_id=p_user_id),
 '{"locationEnabled":false,"eventsMapEnabled":false,"revision":0,"shareUntil":null}'::jsonb);
$$;
CREATE FUNCTION public.member_map_update_settings(p_user_id text,p_expected_revision integer,
 p_location_enabled boolean,p_events_map_enabled boolean,p_consent_version text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.member_map_settings;
BEGIN
 INSERT INTO public.member_map_settings(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.member_map_settings WHERE user_id=p_user_id FOR UPDATE;
 IF p_expected_revision IS NULL OR s.revision<>p_expected_revision THEN
  RAISE EXCEPTION 'Settings changed. Refresh and retry.' USING ERRCODE='40001';
 END IF;
 IF p_location_enabled IS NULL OR p_events_map_enabled IS NULL THEN
  RAISE EXCEPTION 'Boolean settings required' USING ERRCODE='22023';
 END IF;
 IF p_events_map_enabled AND (NOT p_location_enabled OR p_consent_version IS DISTINCT FROM 'events-map-v1'
  OR NOT public.member_map_eligible(p_user_id)) THEN
  RAISE EXCEPTION 'Explicit map consent and verified public adult profile required' USING ERRCODE='42501';
 END IF;
 UPDATE public.member_map_settings SET location_enabled=p_location_enabled,
  events_map_enabled=p_events_map_enabled AND p_location_enabled,revision=revision+1,
  consent_version=CASE WHEN p_events_map_enabled THEN p_consent_version END,
  share_until=CASE WHEN p_events_map_enabled AND p_location_enabled THEN now()+interval '1 hour' END
 WHERE user_id=p_user_id;
 DELETE FROM public.member_map_presence WHERE user_id=p_user_id;
 IF NOT p_location_enabled THEN DELETE FROM public.member_proximity_presence WHERE user_id=p_user_id; END IF;
 RETURN public.member_map_get_settings(p_user_id);
END; $$;
CREATE FUNCTION public.member_map_revoke(p_user_id text,p_disable_overall boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.member_map_settings(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.member_map_settings WHERE user_id=p_user_id FOR UPDATE;
 UPDATE public.member_map_settings SET
  location_enabled=CASE WHEN p_disable_overall THEN false ELSE location_enabled END,
  events_map_enabled=false,consent_version=NULL,share_until=NULL,revision=revision+1 WHERE user_id=p_user_id;
 DELETE FROM public.member_map_presence WHERE user_id=p_user_id;
 IF p_disable_overall THEN DELETE FROM public.member_proximity_presence WHERE user_id=p_user_id; END IF;
 RETURN public.member_map_get_settings(p_user_id);
END; $$;
CREATE FUNCTION public.member_map_publish(p_user_id text,p_revision integer,p_latitude double precision,
 p_longitude double precision,p_observed_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE s public.member_map_settings; lat double precision; lng double precision; step double precision; expires timestamptz;
BEGIN
 SELECT * INTO s FROM public.member_map_settings WHERE user_id=p_user_id FOR UPDATE;
 IF s.user_id IS NULL OR NOT s.location_enabled OR NOT s.events_map_enabled
  OR s.consent_version IS DISTINCT FROM 'events-map-v1' OR s.share_until<=now()
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
 expires:=least(s.share_until,p_observed_at+interval '15 minutes');
 INSERT INTO public.member_map_presence(user_id,latitude,longitude,observed_at,expires_at,revision)
 VALUES(p_user_id,lat,lng,p_observed_at,expires,p_revision)
 ON CONFLICT(user_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
  observed_at=EXCLUDED.observed_at,expires_at=EXCLUDED.expires_at,revision=EXCLUDED.revision;
 RETURN jsonb_build_object('published',true,'expiresAt',expires);
END; $$;
CREATE FUNCTION public.member_map_nearby(p_user_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE viewer public.member_map_presence; viewer_id integer; result jsonb;
BEGIN
 SELECT p.* INTO viewer FROM public.member_map_presence p JOIN public.member_map_settings s USING(user_id)
 WHERE p.user_id=p_user_id AND p.expires_at>now() AND p.observed_at>now()-interval '15 minutes'
  AND s.location_enabled AND s.events_map_enabled AND s.share_until>now()
  AND s.consent_version='events-map-v1' AND p.revision=s.revision;
 IF viewer.user_id IS NULL OR NOT public.member_map_eligible(p_user_id) THEN
  RETURN jsonb_build_object('members','[]'::jsonb,'center',NULL,'expiresAt',NULL);
 END IF;
 SELECT id INTO viewer_id FROM public.users WHERE auth_id=p_user_id;
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
 RETURN jsonb_build_object('members',result,
  'center',jsonb_build_object('latitude',viewer.latitude,'longitude',viewer.longitude),'expiresAt',viewer.expires_at);
END; $$;
REVOKE ALL ON FUNCTION public.member_map_eligible(text),public.member_map_get_settings(text),
 public.member_map_update_settings(text,integer,boolean,boolean,text),public.member_map_revoke(text,boolean),
 public.member_map_publish(text,integer,double precision,double precision,timestamptz),public.member_map_nearby(text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.member_map_eligible(text),public.member_map_get_settings(text),
 public.member_map_update_settings(text,integer,boolean,boolean,text),public.member_map_revoke(text,boolean),
 public.member_map_publish(text,integer,double precision,double precision,timestamptz),public.member_map_nearby(text)
 TO service_role;
COMMENT ON TABLE public.member_map_presence IS 'Explicit avatar-map consent only; roughly 1km cells, never attendance, expire within15 minutes of observation.';
DO $cron$ BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
  EXECUTE $$SELECT cron.schedule('member-map-presence-purge','*/15 * * * *',
   'DELETE FROM public.member_map_presence WHERE expires_at<=now();')$$;
 END IF;
END $cron$;
COMMIT;
NOTIFY pgrst,'reload schema';
