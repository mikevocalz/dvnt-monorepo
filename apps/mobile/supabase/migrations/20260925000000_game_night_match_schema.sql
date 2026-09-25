-- Game Night: match-engine schema.
--
-- Adds durable match/round/hand/submission/deck/ledger/chat/card tables and the
-- columns the room + membership rows need for seats, readiness, idempotent
-- create/join, and expiry cleanup. Also repairs the recursive SELECT policies
-- flagged in the 2026-09-24 audit: game_night_players_select queried
-- game_night_players inside its own USING expression, which raises 42P17
-- (infinite recursion) for every authenticated read and poisons
-- game_night_rooms_select through its EXISTS arm. Both policies now delegate
-- membership checks to SECURITY DEFINER helpers that bypass RLS in a
-- controlled, non-recursive way.
--
-- Identity: Better Auth user ids are TEXT. Every policy and RPC reads the
-- acting identity from request.jwt.claims->>'sub' (the supabase-jwt bridge
-- mints sub = Better Auth id, role = authenticated). auth.uid() is unusable —
-- it casts to uuid and aborts with 22P02 on 32-char BA ids.
--
-- Write model: tables stay write-closed to clients (grants unchanged: SELECT
-- to authenticated on public-safe tables, ALL to service_role). Every mutation
-- goes through a SECURITY DEFINER command RPC in the engine migration.

-- ---------------------------------------------------------------------------
-- Room + membership columns
-- ---------------------------------------------------------------------------

alter table public.game_night_rooms
  add column if not exists idempotency_key text,
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists is_private boolean not null default true,
  add column if not exists match_seq integer not null default 0;

-- Create-room idempotency: one live room per (host, key). Retried taps return
-- the existing room instead of minting duplicates.
create unique index if not exists uniq_game_night_rooms_idem
  on public.game_night_rooms (host_id, idempotency_key)
  where idempotency_key is not null and status <> 'ended';

-- Rooms idle past this window are ended lazily by the command RPCs.
create index if not exists idx_game_night_rooms_activity
  on public.game_night_rooms (last_activity_at) where status <> 'ended';

alter table public.game_night_players
  add column if not exists seat_no smallint,
  add column if not exists ready boolean not null default false,
  add column if not exists ready_at timestamptz,
  add column if not exists last_seen_at timestamptz not null default now();

-- At most one seated player per seat per room. The unique index is the final
-- guard for simultaneous final-seat claims; the join RPC also serializes on
-- the room row lock before picking a seat.
create unique index if not exists uniq_game_night_players_seat
  on public.game_night_players (room_id, seat_no)
  where left_at is null and role = 'player' and seat_no is not null;

-- ---------------------------------------------------------------------------
-- Non-recursive membership helpers (fix for the 42P17 policies)
-- ---------------------------------------------------------------------------

create or replace function public.game_night_is_member(p_room_id bigint, p_user_id text)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.game_night_players p
    where p.room_id = p_room_id and p.user_id = p_user_id and p.left_at is null
  );
$$;

create or replace function public.game_night_member_role(p_room_id bigint, p_user_id text)
returns text
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.role from public.game_night_players p
  where p.room_id = p_room_id and p.user_id = p_user_id and p.left_at is null
  limit 1;
$$;

-- Keep these callable only by clients through the policies and by the engine.
revoke all on function public.game_night_is_member(bigint, text) from public, anon;
revoke all on function public.game_night_member_role(bigint, text) from public, anon;
grant execute on function public.game_night_is_member(bigint, text) to authenticated, service_role;
grant execute on function public.game_night_member_role(bigint, text) to authenticated, service_role;

drop policy if exists game_night_players_select on public.game_night_players;
create policy game_night_players_select on public.game_night_players
  for select to authenticated
  using (
    user_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    or public.game_night_is_member(
         room_id,
         (select ((current_setting('request.jwt.claims', true))::json ->> 'sub')))
  );

drop policy if exists game_night_rooms_select on public.game_night_rooms;
create policy game_night_rooms_select on public.game_night_rooms
  for select to authenticated
  using (
    host_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    or public.game_night_is_member(
         id,
         (select ((current_setting('request.jwt.claims', true))::json ->> 'sub')))
  );

-- ---------------------------------------------------------------------------
-- Match tables
-- ---------------------------------------------------------------------------

create table if not exists public.game_night_matches (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.game_night_rooms(id) on delete cascade,
  match_no smallint not null,
  mode text not null check (mode in ('classic', 'duel')),
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  target_score smallint not null default 5,
  duel_paired_rounds smallint not null default 5,
  current_round_no smallint not null default 0,
  -- Denormalized scoreboard {user_id: points} for cheap reads; the ledger is
  -- game_night_rounds.winner_user_id + game_night_results.
  scores jsonb not null default '{}',
  winner_user_id text,
  tied boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (room_id, match_no)
);

-- One live match per room. Compare-and-swap guard for simultaneous starts.
create unique index if not exists uniq_game_night_active_match
  on public.game_night_matches (room_id) where status = 'active';

create table if not exists public.game_night_rounds (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.game_night_matches(id) on delete cascade,
  round_no smallint not null,
  phase text not null check (phase in (
    'dealing', 'submitting', 'judging', 'round_results',
    'duel_lock', 'duel_results', 'voided')),
  judge_user_id text,
  duel_subject_user_id text,
  prompt_card_id text,
  prompt_text text,
  prompt_pick smallint not null default 1,
  -- Duel mode: the shuffled shared option set both players see
  -- [{card_id, text}]. Secret is only which one the subject prefers.
  duel_options jsonb,
  reveal_order jsonb,          -- server-shuffled submission ids for anonymous reveal
  submissions_expected smallint not null default 0,
  deadline_at timestamptz,
  winner_user_id text,
  winner_submission_id bigint,
  created_at timestamptz not null default now(),
  unique (match_id, round_no)
);

create index if not exists idx_game_night_rounds_match
  on public.game_night_rounds (match_id, round_no desc);

-- Private hands: no client SELECT grant at all. The state RPC returns only
-- the caller's own hand. Match-scoped (not room-scoped) so a rematch re-deals.
create table if not exists public.game_night_hands (
  match_id bigint not null references public.game_night_matches(id) on delete cascade,
  user_id text not null,
  cards jsonb not null default '[]',   -- ordered array of answer card ids
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- Per-match shuffled decks. Server-only; clients never see order or contents
-- beyond their own hand and played/revealed cards.
create table if not exists public.game_night_decks (
  match_id bigint primary key references public.game_night_matches(id) on delete cascade,
  prompt_deck jsonb not null,
  answer_deck jsonb not null,
  prompt_discard jsonb not null default '[]',
  answer_discard jsonb not null default '[]'
);

create table if not exists public.game_night_submissions (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.game_night_rounds(id) on delete cascade,
  match_id bigint not null references public.game_night_matches(id) on delete cascade,
  user_id text not null,
  cards jsonb not null,          -- card ids in play order (pick=2 order matters)
  card_texts jsonb not null,     -- denormalized for the reveal projection
  locked_at timestamptz not null default now(),
  unique (round_id, user_id)
);

create index if not exists idx_game_night_submissions_round
  on public.game_night_submissions (round_id);

-- Duel-mode locks. kind is derived server-side from the caller's role in the
-- round; the client only sends the chosen option card id.
create table if not exists public.game_night_duel_choices (
  round_id bigint not null references public.game_night_rounds(id) on delete cascade,
  match_id bigint not null references public.game_night_matches(id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('subject_pick', 'prediction')),
  choice_card_id text not null,
  locked_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

-- Idempotent-command ledger: (room_id, command_id) is the dedupe anchor.
create table if not exists public.game_night_commands (
  room_id bigint not null references public.game_night_rooms(id) on delete cascade,
  command_id text not null,
  command_type text not null,
  actor_user_id text not null,
  result jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (room_id, command_id)
);

-- Audit ledger of committed transitions. Internal; not client-readable.
create table if not exists public.game_night_events (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.game_night_rooms(id) on delete cascade,
  match_id bigint,
  round_id bigint,
  event_type text not null,
  actor_user_id text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_game_night_events_room on public.game_night_events (room_id, id);

-- ---------------------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------------------

create table if not exists public.game_night_messages (
  id bigint generated always as identity primary key,
  room_id bigint not null references public.game_night_rooms(id) on delete cascade,
  user_id text not null,
  kind text not null default 'text' check (kind in ('text', 'gif', 'reaction', 'system')),
  body text check (body is null or char_length(body) between 1 and 2000),
  gif jsonb,        -- {id, url, preview_url, width, height, provider:'klipy'}
  reaction text,    -- single emoji for kind='reaction'
  created_at timestamptz not null default now()
);

create index if not exists idx_game_night_messages_room on public.game_night_messages (room_id, id desc);

-- ---------------------------------------------------------------------------
-- Results / leaderboard
-- ---------------------------------------------------------------------------

create table if not exists public.game_night_results (
  match_id bigint not null references public.game_night_matches(id) on delete cascade,
  user_id text not null,
  mode text not null check (mode in ('classic', 'duel')),
  placement smallint not null,   -- 1 = winner; ties share the placement
  points smallint not null,
  finished_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

create index if not exists idx_game_night_results_user on public.game_night_results (user_id, mode);

-- ---------------------------------------------------------------------------
-- Versioned launch deck
-- ---------------------------------------------------------------------------

create table if not exists public.game_night_cards (
  id text primary key,           -- 'v1-p-001', 'v1-a-001'
  kind text not null check (kind in ('prompt', 'answer')),
  text text not null,
  pick smallint not null default 1 check (pick between 1 and 3),
  deck_version text not null default 'v1',
  active boolean not null default true
);

alter table public.game_night_cards enable row level security;
-- Cards are reference data; readable by any authenticated client for the
-- in-product rules/deck browser. Writes stay service-role only.
create policy game_night_cards_select on public.game_night_cards
  for select to authenticated using (active = true);
revoke all on public.game_night_cards from public, anon;
grant select on public.game_night_cards to authenticated;
grant all on public.game_night_cards to service_role;

-- ---------------------------------------------------------------------------
-- Grants: public-safe tables selectable by members; private tables locked
-- ---------------------------------------------------------------------------

alter table public.game_night_matches      enable row level security;
alter table public.game_night_rounds       enable row level security;
alter table public.game_night_hands        enable row level security;
alter table public.game_night_decks        enable row level security;
alter table public.game_night_submissions  enable row level security;
alter table public.game_night_duel_choices enable row level security;
alter table public.game_night_commands     enable row level security;
alter table public.game_night_events       enable row level security;
alter table public.game_night_messages     enable row level security;
alter table public.game_night_results      enable row level security;

revoke all on public.game_night_matches      from public, anon;
revoke all on public.game_night_rounds       from public, anon;
revoke all on public.game_night_hands        from public, anon;
revoke all on public.game_night_decks        from public, anon;
revoke all on public.game_night_submissions  from public, anon;
revoke all on public.game_night_duel_choices from public, anon;
revoke all on public.game_night_commands     from public, anon;
revoke all on public.game_night_events       from public, anon;
revoke all on public.game_night_messages     from public, anon;
revoke all on public.game_night_results      from public, anon;

-- Public-safe reads: the row exists in the projection anyway, so members may
-- select these directly (also what postgres_changes realtime needs).
grant select on public.game_night_matches  to authenticated;
grant select on public.game_night_rounds   to authenticated;
grant select on public.game_night_messages to authenticated;
grant select on public.game_night_results  to authenticated;

create policy game_night_matches_select on public.game_night_matches
  for select to authenticated
  using (public.game_night_is_member(
    room_id,
    (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))));

create policy game_night_rounds_select on public.game_night_rounds
  for select to authenticated
  using (exists (
    select 1 from public.game_night_matches m
    where m.id = game_night_rounds.match_id
      and public.game_night_is_member(
        m.room_id,
        (select ((current_setting('request.jwt.claims', true))::json ->> 'sub')))));

create policy game_night_messages_select on public.game_night_messages
  for select to authenticated
  using (public.game_night_is_member(
    room_id,
    (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))));

create policy game_night_results_select on public.game_night_results
  for select to authenticated
  using (exists (
    select 1 from public.game_night_matches m
    where m.id = game_night_results.match_id
      and public.game_night_is_member(
        m.room_id,
        (select ((current_setting('request.jwt.claims', true))::json ->> 'sub')))));

-- Private tables: service_role only, plus leaderboard reads happen through
-- the definer RPC. No SELECT grant to authenticated on hands/decks/
-- submissions/duel_choices/commands/events — ever.
grant all on public.game_night_matches      to service_role;
grant all on public.game_night_rounds       to service_role;
grant all on public.game_night_hands        to service_role;
grant all on public.game_night_decks        to service_role;
grant all on public.game_night_submissions  to service_role;
grant all on public.game_night_duel_choices to service_role;
grant all on public.game_night_commands     to service_role;
grant all on public.game_night_events       to service_role;
grant all on public.game_night_messages     to service_role;
grant all on public.game_night_results      to service_role;

-- Realtime: postgres_changes subscribers must satisfy the SELECT policies
-- above, so secret-bearing tables are deliberately NOT published.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'game_night_matches') then
      alter publication supabase_realtime add table public.game_night_matches;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'game_night_rounds') then
      alter publication supabase_realtime add table public.game_night_rounds;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'game_night_messages') then
      alter publication supabase_realtime add table public.game_night_messages;
    end if;
  end if;
end $$;
