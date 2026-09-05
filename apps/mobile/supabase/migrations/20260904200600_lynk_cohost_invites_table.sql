create table if not exists public.lynk_cohost_invites (
  id            serial primary key,
  room_id       integer not null references public.video_rooms(id) on delete cascade,
  -- TEXT to match video_room_members.user_id: Better-Auth ids, not users.id.
  inviter_id    text    not null,
  invitee_id    text    not null,
  status        text    not null default 'pending'
                        check (status in ('pending','accepted','declined')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);

create index if not exists lynk_cohost_invites_invitee_idx
  on public.lynk_cohost_invites (invitee_id, status);
create index if not exists lynk_cohost_invites_room_idx
  on public.lynk_cohost_invites (room_id);

-- One OPEN invite per person per room. Partial, not a plain unique constraint:
-- re-inviting after a decline is legitimate, a host may reasonably ask twice.
create unique index if not exists lynk_cohost_invites_one_pending
  on public.lynk_cohost_invites (room_id, invitee_id)
  where status = 'pending';

-- The client never writes this table. Who may invite and who may answer is
-- authorization the Edge Function performs with the service role — Better-Auth
-- means auth.uid() is null in Postgres, so a policy cannot say "the invitee".
-- SELECT is granted so a client can read its own pending invites for the
-- notification list; a client that could INSERT here could make itself co-host.
alter table public.lynk_cohost_invites enable row level security;

grant select on public.lynk_cohost_invites to anon, authenticated;
grant all    on public.lynk_cohost_invites to service_role;
grant usage, select on sequence public.lynk_cohost_invites_id_seq to service_role;

drop policy if exists lynk_cohost_invites_select on public.lynk_cohost_invites;
create policy lynk_cohost_invites_select
  on public.lynk_cohost_invites for select to public using (true);
