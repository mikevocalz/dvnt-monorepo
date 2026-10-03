-- Stop co-members from unmasking anonymous Sneaky Lynk members (S08).
--
-- Before this migration, on production (read 2026-10-03):
--   relacl: authenticated=r (table-wide SELECT, so every column)
--   video_room_members_select_participant  FOR SELECT TO authenticated
--     USING (user_id = auth.jwt()->>'sub'
--            OR viewer_in_lynk_room(room_id) OR viewer_hosts_lynk_room(room_id))
--
-- Anyone with a row in a room could read every member row of that room,
-- including user_id. For an anonymous member (is_anonymous, shown as
-- anon_label) user_id is their Better Auth id, and users.auth_id is publicly
-- readable, so one join gave their username and avatar. Realtime leaked the
-- same column: postgres_changes on this table ships whole rows to every
-- subscriber who passes the policy.
--
-- After this migration:
--   * authenticated keeps SELECT on every column EXCEPT user_id. The policy
--     is unchanged. Filtering or ordering on user_id is a 42501, so it cannot
--     be probed either. realtime.apply_rls drops columns the subscriber has no
--     SELECT privilege on, so change events stop carrying user_id.
--   * public.lynk_room_roster(room_id [, member_id]) returns the roster with
--     user_id set to the real auth id for non-anonymous members and for the caller's own row,
--     and to the opaque handle 'member:<row id>' for every other anonymous
--     member. The host gets the handle too. Moderation edge functions
--     (video_kick_user, video_ban_user, video_mute_peer, video_change_role)
--     resolve that handle with service_role (_shared/room-member-handle.ts).
--   * anon never had a grant here and still has none.
--
-- service_role (every video_* and lynk-* edge function) is untouched.

begin;

revoke all on table public.video_room_members from anon, authenticated;

do $$
declare
  col text;
begin
  for col in
    select quote_ident(attname)
    from pg_attribute
    where attrelid = 'public.video_room_members'::regclass
      and attnum > 0
      and not attisdropped
  loop
    execute format(
      'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) on public.video_room_members from anon, authenticated',
      col
    );
  end loop;
end
$$;

grant select (
  id, room_id, role, status, joined_at, left_at, created_at,
  hand_raised, is_anonymous, anon_label, last_seen_at
) on public.video_room_members to authenticated;

create or replace function public.lynk_room_roster(
  p_room_id integer,
  p_member_id integer default null
)
returns table (
  member_id integer,
  room_id integer,
  user_id text,
  role varchar,
  status varchar,
  hand_raised boolean,
  joined_at timestamptz,
  left_at timestamptz,
  is_anonymous boolean,
  anon_label text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    m.id,
    m.room_id,
    case
      when not m.is_anonymous then m.user_id
      when m.user_id = (select auth.jwt() ->> 'sub') then m.user_id
      else 'member:' || m.id::text
    end,
    m.role,
    m.status,
    m.hand_raised,
    m.joined_at,
    m.left_at,
    m.is_anonymous,
    m.anon_label
  from public.video_room_members m
  where m.room_id = p_room_id
    and (p_member_id is null or m.id = p_member_id)
    -- Same audience as video_room_members_select_participant.
    and (public.viewer_in_lynk_room(p_room_id)
         or public.viewer_hosts_lynk_room(p_room_id))
  order by m.id;
$$;

revoke all on function public.lynk_room_roster(integer, integer) from public, anon;
grant execute on function public.lynk_room_roster(integer, integer) to authenticated, service_role;

commit;
