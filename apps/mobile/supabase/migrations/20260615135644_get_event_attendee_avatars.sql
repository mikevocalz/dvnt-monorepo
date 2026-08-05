-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260615135644 :: get_event_attendee_avatars). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

create or replace function public.get_event_attendee_avatars(p_event_id integer)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object(
    'image', coalesce(am.url, ''),
    'initials', coalesce(upper(left(au.username, 2)), '??')
  )), '[]'::json)
  from (
    select er.user_id as rsvp_auth_id, er.created_at
    from event_rsvps er
    where er.event_id = p_event_id and er.status = 'going'
    order by er.created_at desc
    limit 5
  ) top_rsvps
  left join users au on au.auth_id = top_rsvps.rsvp_auth_id
  left join media am on am.id = au.avatar_id;
$$;

grant execute on function public.get_event_attendee_avatars(integer) to anon, authenticated, service_role;;
