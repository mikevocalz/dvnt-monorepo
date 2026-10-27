-- Repair missing/stale Lynk chat author privacy without leaking historical IDs.
-- Apply after 20261003150200_video_room_members_user_id_private.sql.
-- Supersedes 20261003150300 for databases where that migration was never applied,
-- and safely repairs it where it was. Does not edit the older migration/ledger.
-- Existing messages keep IDs/body/threading. Unmatched historical authors get
-- per-comment opaque handles, not raw auth IDs. New writes without a membership
-- fail closed; the authenticated edge already verifies active membership.
-- No deployments, message sends, deletion, or membership data updates here.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.room_comments add column if not exists author_handle text;

-- Only a real membership determines whether an author may be named. An absent
-- row is NOT evidence that a historical author never joined anonymously.
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
  select case when m.is_anonymous then 'member:' || m.id::text else m.user_id end
      from public.video_rooms r
      join public.video_room_members m
        on m.room_id = r.id and m.user_id = p_author_id
      where r.uuid = case
        when p_room_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then p_room_uuid::uuid
      end
      limit 1;
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
  if new.author_handle is null then
    raise exception 'Room membership required to attribute a chat message'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function public.room_comments_set_author_handle() from public, anon, authenticated;

drop trigger if exists room_comments_set_author_handle on public.room_comments;
create trigger room_comments_set_author_handle
  before insert or update of author_id, room_id on public.room_comments
  for each row execute function public.room_comments_set_author_handle();

update public.room_comments
set author_handle = coalesce(
  public.room_comment_author_handle(room_id, author_id),
  'legacy-comment:' || id::text
)
-- Preserve existing opaque historical attribution even if that member later
-- switched to a named identity. Current membership cannot retroactively unmask it.
where (author_handle is null or author_handle !~ '^(member|legacy-comment):[0-9]+$')
  and author_handle is distinct from coalesce(
  public.room_comment_author_handle(room_id, author_id),
  'legacy-comment:' || id::text
);

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
