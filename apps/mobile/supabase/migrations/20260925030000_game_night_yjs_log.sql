-- Game Night Yjs projection persistence.
--
-- The authoritative Yjs document for a room is a SERVER-side projection of
-- public match state only (phase, prompt id, scores, seats — never hands,
-- unrevealed submissions, deck order, or duel locks). The game-night-sync
-- edge function is the only writer: it rebuilds the doc from this log +
-- snapshot, applies canonical updates, and serves state-vector diffs to
-- members. Clients never write doc content — their only input is a state
-- vector. Social traffic stays on the existing broadcast/presence channels.
--
-- Doc identity is room_id, NOT room_code — a recycled code can never alias
-- a different room's document.

create table if not exists public.game_night_yjs_snapshots (
  room_id bigint primary key references public.game_night_rooms(id) on delete cascade,
  update bytea not null,          -- merged Yjs update covering seqs <= seq
  seq bigint not null default 0,
  canonical_hash text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.game_night_yjs_log (
  room_id bigint not null references public.game_night_rooms(id) on delete cascade,
  seq bigint generated always as identity,
  update bytea not null,
  canonical_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_game_night_yjs_log_room
  on public.game_night_yjs_log (room_id, seq);

alter table public.game_night_yjs_snapshots enable row level security;
alter table public.game_night_yjs_log       enable row level security;
revoke all on public.game_night_yjs_snapshots from public, anon, authenticated;
revoke all on public.game_night_yjs_log       from public, anon, authenticated;
grant all on public.game_night_yjs_snapshots to service_role;
grant all on public.game_night_yjs_log       to service_role;

-- Canonical public projection the projector diffs against. Returns only
-- fields safe for every room member (same visibility as game_night_state's
-- public sections); callers of this are service-role only.
create or replace function public.game_night_public_projection(p_room_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_room public.game_night_rooms;
  v_match public.game_night_matches;
  v_round public.game_night_rounds;
  v_members jsonb;
  v_reveal jsonb;
  v_subs int;
begin
  select * into v_room from public.game_night_rooms where id = p_room_id;
  select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'role', p.role, 'seat_no', p.seat_no,
      'ready', p.ready, 'name', u.name, 'avatar', u.image)
    order by p.seat_no nulls last, p.joined_at)
    into v_members
    from public.game_night_players p
    left join public."user" u on u.id = p.user_id
    where p.room_id = p_room_id and p.left_at is null;

  select * into v_match from public.game_night_matches
    where room_id = p_room_id order by id desc limit 1;
  if v_match.id is not null then
    select * into v_round from public.game_night_rounds
      where match_id = v_match.id and round_no = v_match.current_round_no;
    if v_round.id is not null then
      select count(*) into v_subs from public.game_night_submissions where round_id = v_round.id;
      -- anonymous-safe reveal: texts only during judging, identities only
      -- after results — same rule the member projection uses.
      if v_round.phase = 'judging' then
        select jsonb_agg(jsonb_build_object('submission_id', s.id, 'texts', s.card_texts)
                         order by ord.n)
          into v_reveal
          from public.game_night_submissions s
          join jsonb_array_elements_text(v_round.reveal_order) with ordinality as ord(sid, n)
            on ord.sid::bigint = s.id
          where s.round_id = v_round.id;
      elsif v_round.phase in ('round_results','voided') or v_match.status <> 'active' then
        select jsonb_agg(jsonb_build_object('submission_id', s.id, 'texts', s.card_texts,
                                            'user_id', s.user_id, 'name', u.name,
                                            'is_winner', s.id = v_round.winner_submission_id)
                         order by ord.n)
          into v_reveal
          from public.game_night_submissions s
          join jsonb_array_elements_text(v_round.reveal_order) with ordinality as ord(sid, n)
            on ord.sid::bigint = s.id
          left join public."user" u on u.id = s.user_id
          where s.round_id = v_round.id;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'room', jsonb_build_object('id', v_room.id, 'code', v_room.room_code,
                               'status', v_room.status, 'host_id', v_room.host_id,
                               'is_private', v_room.is_private),
    'members', coalesce(v_members, '[]'::jsonb),
    'match', case when v_match.id is null then null else jsonb_build_object(
      'id', v_match.id, 'match_no', v_match.match_no, 'mode', v_match.mode,
      'status', v_match.status, 'scores', v_match.scores,
      'winner_user_id', v_match.winner_user_id, 'tied', v_match.tied,
      'current_round_no', v_match.current_round_no,
      'target_score', v_match.target_score,
      'duel_paired_rounds', v_match.duel_paired_rounds) end,
    'round', case when v_round.id is null then null else jsonb_build_object(
      'id', v_round.id, 'round_no', v_round.round_no, 'phase', v_round.phase,
      'judge_user_id', v_round.judge_user_id,
      'duel_subject_user_id', v_round.duel_subject_user_id,
      'prompt', jsonb_build_object('card_id', v_round.prompt_card_id,
                                   'text', v_round.prompt_text,
                                   'pick', v_round.prompt_pick),
      'deadline_at', v_round.deadline_at,
      'submissions_in', coalesce(v_subs, 0),
      'submissions_expected', v_round.submissions_expected,
      'reveal', coalesce(v_reveal, '[]'::jsonb),
      'duel_options', case when v_match.mode = 'duel' then coalesce(v_round.duel_options, '[]'::jsonb) end,
      'winner_user_id', case when v_round.phase in ('round_results','duel_results','voided')
                             then v_round.winner_user_id end) end);
end;
$$;

revoke all on function public.game_night_public_projection(bigint) from public, anon, authenticated;
grant execute on function public.game_night_public_projection(bigint) to service_role;
