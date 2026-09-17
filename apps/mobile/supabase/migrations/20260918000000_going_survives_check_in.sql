-- A guest who has been scanned in is still going.
--
-- redeem_ticket (20260806100200) flips a ticket active -> scanned at the door.
-- trg_maintain_event_total_attendees fires on that status change and calls
-- recompute_event_total_attendees, which counted tickets WHERE status = 'active'
-- only. So every check-in DECREMENTED events.total_attendees, and the two
-- attendee-list projections (same predicate) dropped the guest from "Who's
-- going" the moment they walked in. Replayed against the real trigger + CAS with
-- a 120-ticket test event: going = 100 before doors, 0 after the last scan. On
-- the night, the event page empties out exactly while the room fills up.
--
-- The platform already defines a held ticket as ('active','scanned') —
-- viewer_is_attending (20260916203000) and the add-on gate (20260806400100) both
-- do. This brings the counter and the two list projections in line with that.
-- Nothing else changes: bodies below are the 20260916203000 definitions with
-- that one predicate widened.
BEGIN;

CREATE OR REPLACE FUNCTION public.recompute_event_total_attendees(
  p_event_id integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE events
  SET total_attendees = (
    SELECT count(DISTINCT u)
    FROM (
      SELECT user_id::text AS u FROM tickets
        WHERE event_id = p_event_id AND status IN ('active', 'scanned')
      UNION
      SELECT user_id::text AS u FROM event_rsvps
        WHERE event_id = p_event_id AND status = 'going'
    ) merged
  )
  WHERE id = p_event_id;
END;
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
      where t.event_id = p_event_id and t.status in ('active', 'scanned') and t.user_id is not null
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
    and public.viewer_is_attending(p_event_id);
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
      where t.event_id = p_event_id and t.status in ('active', 'scanned') and t.user_id is not null
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
    and public.viewer_is_attending(p_event_id);
$function$;

-- Backfill only the rows that are actually wrong (events that have already had
-- a door), so this does not touch — or re-broadcast — every event on the platform.
UPDATE events e
SET total_attendees = fixed.n
FROM (
  SELECT ev.id,
         (SELECT count(DISTINCT u) FROM (
            SELECT t.user_id::text AS u FROM tickets t
              WHERE t.event_id = ev.id AND t.status IN ('active', 'scanned')
            UNION
            SELECT r.user_id::text AS u FROM event_rsvps r
              WHERE r.event_id = ev.id AND r.status = 'going'
          ) merged) AS n
  FROM events ev
  WHERE EXISTS (SELECT 1 FROM tickets t WHERE t.event_id = ev.id AND t.status = 'scanned')
) fixed
WHERE e.id = fixed.id AND e.total_attendees IS DISTINCT FROM fixed.n;

COMMIT;

NOTIFY pgrst, 'reload schema';
