-- "Who's going" could only ever show 20 faces.
--
-- get_event_attendee_avatars hard-caps at `limit 20` while the accordion header
-- counts events.total_attendees, so event 79 (90 active attendees) rendered 20
-- and called it everyone. Adding a scroll container over that list would have
-- looked fixed without being fixed, so the detail screen pages instead.
--
-- The 1-arg function stays exactly as it is: it is the cheap first screenful
-- that rides along with get_event_detail. This is the same projection with
-- limit/offset, under a different name so no existing call becomes ambiguous.
--
-- Ordering is byte-for-byte the one the capped function uses
-- ((avatar_id is not null) desc, uid) because pages must not reshuffle between
-- requests — an unstable sort drops and repeats rows across offsets.
--
-- Same boundary: can_view_event gates the whole projection, so a private or
-- link-only event returns [] here no matter who asks, and the client refuses to
-- call it at all for anything but a public event.

create or replace function public.get_event_attendee_page(
  p_event_id integer,
  p_limit integer default 24,
  p_offset integer default 0
)
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
    limit least(greatest(coalesce(p_limit, 24), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  ) attendees
  left join users au on au.auth_id = attendees.uid
  left join media am on am.id = au.avatar_id
  where public.can_view_event(p_event_id);
$$;

grant execute on function public.get_event_attendee_page(integer, integer, integer) to anon, authenticated, service_role;
