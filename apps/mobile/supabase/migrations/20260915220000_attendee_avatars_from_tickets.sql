-- get_event_attendee_avatars fed "Who's going" from event_rsvps only.
-- RSVP usage is effectively zero now (attendees buy tickets instead), so
-- the section rendered an empty face pile for every current event.
-- Re-source it from the same union get_event_detail uses — active ticket
-- holders + going RSVPs, avatar-bearing users first — and return the
-- same object shape ({id, username, avatar, image, initials}) so both
-- the native (a.avatar) and web (a.image || a.avatar || a.url) readers
-- pick the URL up.

create or replace function public.get_event_attendee_avatars(p_event_id integer)
returns json
language sql
stable
security definer
set search_path = public
as $$
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
      where t.event_id = p_event_id and t.status = 'active' and t.user_id is not null
      union
      select distinct r.user_id as uid from event_rsvps r
      where r.event_id = p_event_id and r.status = 'going' and r.user_id is not null
    ) merged
    left join users ua on ua.auth_id = merged.uid
    order by (ua.avatar_id is not null) desc, merged.uid
    limit 20
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id;
$$;

grant execute on function public.get_event_attendee_avatars(integer) to anon, authenticated, service_role;
