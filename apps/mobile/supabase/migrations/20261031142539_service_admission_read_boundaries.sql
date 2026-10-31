-- Source-only companion to repeat_purchase_tier_limits. No historical tickets,
-- RSVP rows, counts or event visibility settings are rewritten on application.
-- Services/products remain redeemable credentials, not admission/attendance.
-- Keep explicit RSVP, host/staff privileges and sensitive-event privacy guards.
BEGIN;

CREATE OR REPLACE FUNCTION public.viewer_is_attending(p_event_id integer)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN true
    WHEN auth.jwt() ->> 'sub' IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = p_event_id AND e.host_id = auth.jwt() ->> 'sub'
    ) OR EXISTS (
      SELECT 1 FROM public.event_co_organizers c
      WHERE c.event_id = p_event_id AND c.user_id = auth.jwt() ->> 'sub'
    ) OR EXISTS (
      SELECT 1 FROM public.event_rsvps r
      WHERE r.event_id = p_event_id AND r.user_id = auth.jwt() ->> 'sub'
        AND r.status = 'going'
    ) OR EXISTS (
      SELECT 1 FROM public.tickets t
      WHERE t.event_id = p_event_id AND t.user_id = auth.jwt() ->> 'sub'
        AND t.category = 'admission' AND t.status IN ('active', 'scanned')
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.event_attendees_visible(p_event_id integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
    AND (NOT (COALESCE(NULLIF(e.event_type,''),e.category::text,'')='sex_party' OR e.lynk_room_id IS NOT NULL)
      OR (e.show_attendees IS TRUE AND public.can_view_event(e.id) AND public.viewer_is_attending(e.id)
        AND (COALESCE(auth.jwt()->>'role','')='service_role' OR (
          COALESCE(auth.jwt()->>'role','')='authenticated' AND NULLIF(auth.jwt()->>'sub','') IS NOT NULL AND (
            e.host_id=auth.jwt()->>'sub'
            OR EXISTS (SELECT 1 FROM public.event_co_organizers c WHERE c.event_id=e.id
              AND c.user_id=auth.jwt()->>'sub' AND c.accepted IS TRUE)
            OR EXISTS (SELECT 1 FROM public.event_rsvps r WHERE r.event_id=e.id
              AND r.user_id=auth.jwt()->>'sub' AND r.status='going')
            OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.event_id=e.id
              AND t.user_id=auth.jwt()->>'sub' AND t.category='admission' AND t.status IN ('active','scanned'))
          )
        )))));
$$;

CREATE OR REPLACE FUNCTION public.get_event_attendee_avatars(p_event_id integer)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
    'id', au.id::text, 'username', au.username,
    'avatar', coalesce(am.url, ''), 'image', coalesce(am.url, ''),
    'initials', coalesce(upper(left(au.username, 2)), '??')
  ) order by (am.url is not null) desc), '[]'::json)
  from (
    select merged.uid from (
      select distinct t.user_id as uid from tickets t
      where t.event_id = p_event_id and t.category = 'admission' and t.status in ('active', 'scanned') and t.user_id is not null
      union
      select distinct r.user_id as uid from event_rsvps r
      where r.event_id = p_event_id and r.status = 'going' and r.user_id is not null
    ) merged
    left join users ua on ua.auth_id = merged.uid
    order by (ua.avatar_id is not null) desc, merged.uid
    limit 20
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id
  where public.can_view_event(p_event_id)
    and public.viewer_is_attending(p_event_id)
    and public.event_attendees_visible(p_event_id);
$function$;

CREATE OR REPLACE FUNCTION public.get_event_attendee_page(p_event_id integer, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(json_agg(json_build_object(
    'id', au.id::text,
    'username', au.username,
    'avatar', coalesce(am.url, ''),
    'image', coalesce(am.url, ''),
    'initials', coalesce(upper(left(au.username, 2)), '??')
  ) order by (am.url is not null) desc), '[]'::json)
  from (
    select merged.uid
    from (
      select distinct t.user_id as uid from tickets t
      where t.event_id = p_event_id and t.category = 'admission' and t.status in ('active', 'scanned') and t.user_id is not null
      union
      select distinct r.user_id as uid from event_rsvps r
      where r.event_id = p_event_id and r.status = 'going' and r.user_id is not null
    ) merged
    left join users ua on ua.auth_id = merged.uid
    order by (ua.avatar_id is not null) desc, merged.uid
    limit least(greatest(coalesce(p_limit, 24), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id
  where public.can_view_event(p_event_id)
    and public.viewer_is_attending(p_event_id)
    and public.event_attendees_visible(p_event_id);
$function$;

CREATE OR REPLACE FUNCTION public.watch_door_summary(p_event_id bigint, p_auth_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
WITH event AS (
  SELECT e.id, e.title, e.status, e.perk_config,
    e.host_id = p_auth_id OR EXISTS (
      SELECT 1 FROM public.event_co_organizers c WHERE c.event_id = e.id
        AND c.user_id = p_auth_id AND c.accepted = true AND c.role IN ('admin','editor','scanner')
    ) AS allowed
  FROM public.events e WHERE e.id = p_event_id
), authorized AS (
  SELECT *, CASE
    WHEN jsonb_typeof(perk_config->'skip_line') = 'null' THEN NULL
    WHEN jsonb_typeof(perk_config->'skip_line') = 'number' THEN (perk_config->>'skip_line')::numeric
    ELSE 4 END AS priority_min
  FROM event WHERE allowed AND status = 'active'
), roster AS (
  SELECT t.id, t.user_id, t.event_id,
    (t.status = 'scanned' OR t.checked_in_at IS NOT NULL) AS admitted,
    EXISTS (
      SELECT 1 FROM public.membership_subscriptions s
      WHERE s.user_id = t.user_id
        AND (s.status = 'active'
          OR (s.status = 'past_due' AND s.grace_period_ends_at > now())
          OR (s.status = 'canceled' AND s.cancel_at_period_end AND s.current_period_end > now()))
        AND CASE s.plan_key
          WHEN 'free' THEN 0 WHEN 'sneaky_tier_1' THEN 1 WHEN 'sneaky_tier_2' THEN 2
          WHEN 'dvnt_core' THEN 3 WHEN 'dvnt_insider' THEN 4 WHEN 'dvnt_vip' THEN 5
          WHEN 'dvnt_founders_circle' THEN 6 ELSE NULL END >= a.priority_min
    ) AS priority,
    EXISTS (
      SELECT 1 FROM public.event_presence p
      WHERE p.event_id = t.event_id AND p.ticket_id = t.id AND p.user_id = t.user_id
        AND p.state = 'approaching' AND p.expires_at > now()
    ) AS approaching
  FROM public.tickets t JOIN authorized a ON a.id = t.event_id
  WHERE t.category = 'admission' AND t.status IN ('active','scanned','transfer_pending')
), counts AS (
  SELECT count(*) AS expected, count(*) FILTER (WHERE admitted) AS arrived,
    count(*) FILTER (WHERE NOT admitted AND priority) AS priority_lane,
    count(*) FILTER (WHERE NOT admitted AND approaching) AS approaching
  FROM roster
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM event) THEN jsonb_build_object('ok',false,'code','not_found')
  WHEN NOT EXISTS (SELECT 1 FROM event WHERE allowed) THEN jsonb_build_object('ok',false,'code','forbidden')
  WHEN NOT EXISTS (SELECT 1 FROM authorized) THEN jsonb_build_object('ok',false,'code','not_active')
  ELSE (SELECT jsonb_build_object('ok',true,'summary',jsonb_build_object(
    'eventId',a.id::text,'eventTitle',a.title,'expected',c.expected,'arrived',c.arrived,
    'remaining',c.expected-c.arrived,'priorityLane',c.priority_lane,'approaching',c.approaching))
    FROM authorized a CROSS JOIN counts c)
END;
$$;

-- Preserve existing caller surfaces; viewer identity still comes from auth.jwt().
REVOKE ALL ON FUNCTION public.viewer_is_attending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_attending(integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.event_attendees_visible(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_attendees_visible(integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.watch_door_summary(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.watch_door_summary(bigint,text) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
