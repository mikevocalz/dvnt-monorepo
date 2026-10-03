-- Keep anonymous Sneaky Lynk members anonymous in room chat.
--
-- Before this migration, on production (read 2026-10-03):
--   relacl: anon=ar, authenticated=ar (table-wide SELECT and INSERT)
--   room_comments_select  FOR SELECT TO public USING (true)
--   room_comments_insert  FOR INSERT TO public WITH CHECK (true)
--   room_comments_id_seq: anon=rU, authenticated=rU
--
-- author_id is the author's Better Auth id. users.auth_id is public, so any
-- reader of a room's chat could turn an anonymous member's message into their
-- username and avatar. Every reader means everyone: the SELECT policy is
-- USING (true) for anon too, and realtime shipped author_id in every INSERT
-- event. The INSERT policy let any client post as any author_id.
--
-- After this migration:
--   * Clients cannot write room_comments at all. The lynk-room-comment edge
--     function (service_role) posts and deletes messages.
--   * author_handle is set by a trigger on every insert: the author's auth id
--     when they are a named member of the room, and 'member:<row id>' when
--     their video_room_members row is anonymous. That is the same handle
--     lynk_room_roster returns, and the one video_kick_user / video_ban_user /
--     video_mute_peer / video_change_role resolve inside the room.
--   * authenticated may SELECT every column except author_id, and only rows of
--     rooms where they have a membership row or which they host (the
--     lynk_room_roster audience). anon has no access. realtime.apply_rls drops
--     columns without SELECT privilege, so change events lose author_id too.
--   * service_role is untouched.

begin;

alter table public.room_comments add column if not exists author_handle text;

-- Handle for an author in a room addressed by video_rooms.uuid. Falls back to
-- the auth id when there is no membership row: anonymity only exists on a
-- membership row, so without one the author was never anonymous there.
create or replace function public.room_comment_author_handle(
  p_room_uuid text,
  p_author_id text
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select case when m.is_anonymous then 'member:' || m.id::text else m.user_id end
      from public.video_rooms r
      join public.video_room_members m
        on m.room_id = r.id and m.user_id = p_author_id
      where r.uuid = case
        when p_room_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then p_room_uuid::uuid
      end
      limit 1
    ),
    p_author_id
  );
$$;

revoke all on function public.room_comment_author_handle(text, text) from public, anon, authenticated;
grant execute on function public.room_comment_author_handle(text, text) to service_role;

create or replace function public.room_comments_set_author_handle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.author_handle := public.room_comment_author_handle(new.room_id, new.author_id);
  return new;
end
$$;

revoke all on function public.room_comments_set_author_handle() from public, anon, authenticated;

drop trigger if exists room_comments_set_author_handle on public.room_comments;
create trigger room_comments_set_author_handle
  before insert or update of author_id, room_id on public.room_comments
  for each row execute function public.room_comments_set_author_handle();

update public.room_comments
set author_handle = public.room_comment_author_handle(room_id, author_id)
where author_handle is null;

alter table public.room_comments alter column author_handle set not null;

-- Who may read a room's chat: the same audience as lynk_room_roster.
create or replace function public.viewer_reads_lynk_chat(p_room_uuid text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.video_rooms r
    where r.uuid = case
      when p_room_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then p_room_uuid::uuid
    end
      and (public.viewer_in_lynk_room(r.id) or public.viewer_hosts_lynk_room(r.id))
  );
$$;

revoke all on function public.viewer_reads_lynk_chat(text) from public, anon;
grant execute on function public.viewer_reads_lynk_chat(text) to authenticated, service_role;

revoke all on table public.room_comments from anon, authenticated;

do $$
declare
  col text;
begin
  for col in
    select quote_ident(attname)
    from pg_attribute
    where attrelid = 'public.room_comments'::regclass
      and attnum > 0
      and not attisdropped
  loop
    execute format(
      'revoke select (%1$s), insert (%1$s), update (%1$s), references (%1$s) on public.room_comments from anon, authenticated',
      col
    );
  end loop;
end
$$;

grant select (
  id, room_id, author_handle, body, parent_id, root_id, depth, mentions, created_at
) on public.room_comments to authenticated;

revoke all on sequence public.room_comments_id_seq from anon, authenticated;

drop policy if exists room_comments_insert on public.room_comments;
drop policy if exists room_comments_select on public.room_comments;
drop policy if exists room_comments_select_room_audience on public.room_comments;
create policy room_comments_select_room_audience on public.room_comments
  for select to authenticated
  using (public.viewer_reads_lynk_chat(room_id));

commit;
