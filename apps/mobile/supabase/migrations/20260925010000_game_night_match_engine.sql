-- Game Night: server-authoritative match engine.
--
-- Every mutation is a SECURITY DEFINER function here. Each function is one
-- statement scope = one transaction, and every command first takes
-- SELECT ... FOR UPDATE on the room row, which serializes all conflicting
-- transitions per room. Clients call these over PostgREST with the bridged
-- Better Auth JWT; the acting identity is always
--   (current_setting('request.jwt.claims', true))::json ->> 'sub'
-- never a request-supplied user id.
--
-- Rule defaults (implementation decisions, recorded in docs/game-night):
--   * classic (3-4 players): rotating judge, first to 5 points wins.
--   * duel (2 players): alternating subject/predictor paired rounds, 5 pairs
--     default; tied after 5 pairs continues alternating until untied.
--   * deadlines: submitting 45s, judging 60s, duel_lock 30s, results 10s.
--   * no-submission round -> judge still decides among what arrived;
--     zero submissions voids the round (no point).
--   * no judge pick before deadline -> round voided, no point.
--   * duel subject never picks -> round voided; predictor never picks ->
--     counts as a wrong prediction (subject gets nothing, predictor loses
--     the exchange is not scored).
--   * fewer than 2 seated players -> match abandoned, room returns to open.
--   * rooms idle > 6h -> ended lazily; ended rooms release their code.
--
-- Spectators: watchers can join/read/chat. Only the state projection exposes
-- private data, and only ever the caller's own hand.

create or replace function public.game_night_actor()
returns text
language plpgsql stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_sub text;
begin
  v_sub := (current_setting('request.jwt.claims', true))::json ->> 'sub';
  if v_sub is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  return v_sub;
end;
$$;

create or replace function public.game_night_log_event(
  p_room_id bigint, p_match_id bigint, p_round_id bigint,
  p_type text, p_actor text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into public.game_night_events (room_id, match_id, round_id, event_type, actor_user_id, payload)
  values (p_room_id, p_match_id, p_round_id, p_type, p_actor, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- Internal: resolve + lock the room row by code. Every command starts here.
create or replace function public.game_night_lock_room(p_code text)
returns public.game_night_rooms
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_room public.game_night_rooms;
begin
  select * into v_room from public.game_night_rooms r
  where upper(r.room_code) = upper(p_code)
    and r.status <> 'ended'
  order by r.id desc limit 1 for update;
  if not found then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  return v_room;
end;
$$;

-- Internal: mark activity so expiry cleanup doesn't reap live rooms.
create or replace function public.game_night_touch(p_room_id bigint)
returns void
language sql security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.game_night_rooms set last_activity_at = now(), updated_at = now()
  where id = p_room_id;
$$;

-- Internal: draw N elements off the front of a jsonb deck. Returns remaining.
create or replace function public.game_night_jsonb_shift(p_arr jsonb, p_n int)
returns jsonb
language sql immutable
as $$
  select case
    when jsonb_array_length(coalesce(p_arr, '[]'::jsonb)) <= p_n then '[]'::jsonb
    else jsonb_path_query_array(p_arr, ('$[' || p_n || ' to last]')::jsonpath)
  end;
$$;

create or replace function public.game_night_jsonb_head(p_arr jsonb, p_n int)
returns jsonb
language sql immutable
as $$
  select jsonb_path_query_array(p_arr, ('$[0 to ' || (p_n - 1) || ']')::jsonpath);
$$;

-- Internal: refill one hand to 7 cards, recycling the answer discard pile.
create or replace function public.game_night_refill_hand(p_match_id bigint, p_user_id text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_deck public.game_night_decks;
  v_have int;
  v_need int;
  v_draw jsonb;
begin
  select * into v_deck from public.game_night_decks where match_id = p_match_id for update;
  select jsonb_array_length(cards) into v_have
    from public.game_night_hands where match_id = p_match_id and user_id = p_user_id;
  v_have := coalesce(v_have, 0);
  v_need := 7 - v_have;
  while v_need > 0 loop
    if jsonb_array_length(v_deck.answer_deck) = 0 then
      if jsonb_array_length(v_deck.answer_discard) = 0 then
        exit; -- whole deck in play
      end if;
      -- Recycle: deterministic exhaustion behavior, fresh shuffle each pass.
      v_deck.answer_deck := (select jsonb_agg(x order by random())
                             from jsonb_array_elements_text(v_deck.answer_discard) x);
      v_deck.answer_discard := '[]'::jsonb;
    end if;
    v_draw := public.game_night_jsonb_head(v_deck.answer_deck, v_need);
    exit when jsonb_array_length(v_draw) = 0;
    v_deck.answer_deck := public.game_night_jsonb_shift(v_deck.answer_deck, jsonb_array_length(v_draw));
    insert into public.game_night_hands (match_id, user_id, cards)
    values (p_match_id, p_user_id, v_draw)
    on conflict (match_id, user_id)
    do update set cards = public.game_night_hands.cards || excluded.cards,
                  updated_at = now();
    v_need := v_need - jsonb_array_length(v_draw);
  end loop;
  update public.game_night_decks set
    answer_deck = v_deck.answer_deck,
    answer_discard = v_deck.answer_discard
  where match_id = p_match_id;
end;
$$;

-- Internal: pop the next prompt card, recycling prompt discards.
create or replace function public.game_night_draw_prompt(p_match_id bigint)
returns table(card_id text, card_text text, card_pick smallint)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_deck public.game_night_decks;
  v_id text;
begin
  select * into v_deck from public.game_night_decks where match_id = p_match_id for update;
  if jsonb_array_length(v_deck.prompt_deck) = 0 then
    v_deck.prompt_deck := (select jsonb_agg(x order by random())
                           from jsonb_array_elements_text(v_deck.prompt_discard) x);
    v_deck.prompt_discard := '[]'::jsonb;
  end if;
  v_id := v_deck.prompt_deck ->> 0;
  if v_id is null then
    raise exception 'deck_exhausted' using errcode = 'P0001';
  end if;
  return query select c.id, c.text, c.pick
    from public.game_night_cards c where c.id = v_id and c.kind = 'prompt';
  if not found then
    raise exception 'deck_card_missing' using errcode = 'P0001';
  end if;
  update public.game_night_decks set
    prompt_deck = public.game_night_jsonb_shift(v_deck.prompt_deck, 1),
    prompt_discard = v_deck.prompt_discard || to_jsonb(v_id)
  where match_id = p_match_id;
end;
$$;

-- Internal: seated players, deterministic seat order.
create or replace function public.game_night_seated(p_room_id bigint)
returns table(user_id text, seat_no smallint)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.user_id, p.seat_no from public.game_night_players p
  where p.room_id = p_room_id and p.left_at is null and p.role = 'player' and p.seat_no is not null
  order by p.seat_no;
$$;

-- Internal: complete a match — results rows, room back to open.
create or replace function public.game_night_finish_match(p_match_id bigint, p_status text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_match public.game_night_matches;
  v_top int;
  v_row record;
begin
  select * into v_match from public.game_night_matches where id = p_match_id for update;
  if v_match.status <> 'active' then
    return;
  end if;
  if p_status = 'completed' then
    -- winner = max score; tie flag when the top score is shared
    select max((v_match.scores ->> k)::int) into v_top
      from jsonb_object_keys(v_match.scores) k;
    select k into v_match.winner_user_id
      from jsonb_object_keys(v_match.scores) k
      where (v_match.scores ->> k)::int = v_top
      limit 1;
    v_match.tied := (select count(*) > 1 from jsonb_object_keys(v_match.scores) k
                     where (v_match.scores ->> k)::int = v_top);
    -- placements by score rank (ties share a placement)
    for v_row in
      select k as uid, (v_match.scores ->> k)::int as pts
      from jsonb_object_keys(v_match.scores) k
    loop
      insert into public.game_night_results (match_id, user_id, mode, placement, points)
      values (p_match_id, v_row.uid, v_match.mode,
        (select count(*) + 1 from jsonb_object_keys(v_match.scores) k2
         where (v_match.scores ->> k2)::int > v_row.pts)::smallint,
        v_row.pts::smallint)
      on conflict (match_id, user_id) do nothing;
    end loop;
  end if;
  update public.game_night_matches set
    status = p_status,
    winner_user_id = v_match.winner_user_id,
    tied = v_match.tied,
    ended_at = now()
  where id = p_match_id;
  update public.game_night_rooms set status = 'open', updated_at = now()
  where id = v_match.room_id and status = 'playing';
  perform public.game_night_log_event(v_match.room_id, p_match_id, null,
    'match_' || p_status, null,
    jsonb_build_object('winner', v_match.winner_user_id, 'tied', v_match.tied, 'scores', v_match.scores));
end;
$$;

-- Internal: open the next round for a match (classic or duel).
create or replace function public.game_night_open_round(p_match_id bigint)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_match public.game_night_matches;
  v_room_id bigint;
  v_next smallint;
  v_seated text[];
  v_judge text;
  v_subject text;
  v_prompt record;
  v_options jsonb;
  v_round_id bigint;
begin
  select * into v_match from public.game_night_matches where id = p_match_id for update;
  v_room_id := v_match.room_id;
  v_next := v_match.current_round_no + 1;
  select array_agg(user_id order by seat_no) into v_seated
    from public.game_night_seated(v_room_id);
  if coalesce(array_length(v_seated, 1), 0) < 2 then
    perform public.game_night_finish_match(p_match_id, 'abandoned');
    return null;
  end if;

  if v_match.mode = 'classic' then
    v_judge := v_seated[((v_next - 1) % array_length(v_seated, 1)) + 1];
    select p.card_id, p.card_text, p.card_pick into v_prompt
      from public.game_night_draw_prompt(p_match_id) p;
    -- refill every hand before submissions open
    perform public.game_night_refill_hand(p_match_id, s.user_id)
      from public.game_night_seated(v_room_id) s;
    insert into public.game_night_rounds
      (match_id, round_no, phase, judge_user_id, prompt_card_id, prompt_text, prompt_pick,
       submissions_expected, deadline_at)
    values (p_match_id, v_next, 'submitting', v_judge,
            v_prompt.card_id, v_prompt.card_text, v_prompt.card_pick,
            array_length(v_seated, 1) - 1, now() + interval '45 seconds')
    returning id into v_round_id;
  else
    -- duel: subject alternates by round parity over seat order
    v_subject := v_seated[((v_next - 1) % 2) + 1];
    -- shared option set: 6 answer cards off the top of the deck
    select jsonb_agg(jsonb_build_object('card_id', c.id, 'text', c.text))
      into v_options
      from (
        select jsonb_array_elements_text(
          public.game_night_jsonb_head(d.answer_deck, 6)) as cid
        from public.game_night_decks d where d.match_id = p_match_id
      ) drawn
      join public.game_night_cards c on c.id = drawn.cid;
    update public.game_night_decks set
      answer_deck = public.game_night_jsonb_shift(answer_deck, 6)
    where match_id = p_match_id;
    select p.card_id, p.card_text, p.card_pick into v_prompt
      from public.game_night_draw_prompt(p_match_id) p;
    insert into public.game_night_rounds
      (match_id, round_no, phase, duel_subject_user_id, prompt_card_id, prompt_text, prompt_pick,
       duel_options, submissions_expected, deadline_at)
    values (p_match_id, v_next, 'duel_lock', v_subject,
            v_prompt.card_id, v_prompt.card_text, v_prompt.card_pick,
            v_options, 2, now() + interval '30 seconds')
    returning id into v_round_id;
  end if;

  update public.game_night_matches set current_round_no = v_next where id = p_match_id;
  perform public.game_night_log_event(v_room_id, p_match_id, v_round_id, 'round_open', null,
    jsonb_build_object('round_no', v_next, 'mode', v_match.mode));
  return v_round_id;
end;
$$;

-- Internal: settle a duel round once both choices exist.
create or replace function public.game_night_resolve_duel(p_round_id bigint)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_round public.game_night_rounds;
  v_match public.game_night_matches;
  v_subject_pick text;
  v_prediction text;
  v_predictor text;
  v_scores jsonb;
  v_pts int;
begin
  select * into v_round from public.game_night_rounds where id = p_round_id for update;
  select * into v_match from public.game_night_matches where id = v_round.match_id;
  select choice_card_id into v_subject_pick from public.game_night_duel_choices
    where round_id = p_round_id and kind = 'subject_pick';
  select choice_card_id into v_prediction from public.game_night_duel_choices
    where round_id = p_round_id and kind = 'prediction';
  if v_subject_pick is null then
    update public.game_night_rounds set phase = 'voided', deadline_at = now() + interval '10 seconds'
      where id = p_round_id;
    perform public.game_night_log_event(v_match.room_id, v_match.id, p_round_id, 'round_voided', null, '{}');
    return;
  end if;
  v_predictor := (select s.user_id from public.game_night_seated(v_match.room_id) s
                  where s.user_id <> v_round.duel_subject_user_id limit 1);
  -- score: correct prediction earns the predictor one point
  if v_prediction is not null and v_prediction = v_subject_pick then
    v_scores := jsonb_set(v_match.scores, array[v_predictor],
      to_jsonb(coalesce((v_match.scores ->> v_predictor)::int, 0) + 1));
    update public.game_night_matches set scores = v_scores where id = v_match.id;
  end if;
  update public.game_night_rounds set
    phase = 'duel_results',
    winner_user_id = case when v_prediction is not null and v_prediction = v_subject_pick then v_predictor end,
    deadline_at = now() + interval '10 seconds'
  where id = p_round_id;
  perform public.game_night_log_event(v_match.room_id, v_match.id, p_round_id, 'duel_resolved', null,
    jsonb_build_object('correct', v_prediction is not null and v_prediction = v_subject_pick));
end;
$$;

-- Internal: is this duel match over? 2 * paired rounds, then sudden death
-- until untied.
create or replace function public.game_night_duel_over(p_match public.game_night_matches)
returns boolean
language plpgsql stable
as $$
declare
  v_vals int[];
begin
  if p_match.current_round_no < p_match.duel_paired_rounds * 2 then
    return false;
  end if;
  select array_agg((p_match.scores ->> k)::int) into v_vals
    from jsonb_object_keys(p_match.scores) k;
  return not (v_vals[1] = v_vals[2]);
end;
$$;

-- Internal: deadline + abandonment advancement. Called inside every command
-- and by the state RPC so a stalled/backgrounded client can never freeze a
-- round — whoever calls next drives the machine forward.
create or replace function public.game_night_advance(p_room_id bigint)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_room public.game_night_rooms;
  v_match public.game_night_matches;
  v_round public.game_night_rounds;
  v_seated int;
  v_subs int;
  v_target_hit boolean;
begin
  select * into v_room from public.game_night_rooms where id = p_room_id for update;

  -- Expiry: idle rooms end and release the join code.
  if v_room.status <> 'ended' and v_room.last_activity_at < now() - interval '6 hours' then
    update public.game_night_rooms set status = 'ended', updated_at = now() where id = p_room_id;
    update public.game_night_players set left_at = now()
      where room_id = p_room_id and left_at is null;
    update public.game_night_matches set status = 'abandoned', ended_at = now()
      where room_id = p_room_id and status = 'active';
    perform public.game_night_log_event(p_room_id, null, null, 'room_expired', null, '{}');
    return;
  end if;

  select * into v_match from public.game_night_matches
    where room_id = p_room_id and status = 'active'
    order by id desc limit 1;
  if not found then
    return;
  end if;

  -- Abandonment: fewer than two seated players.
  select count(*) into v_seated from public.game_night_seated(p_room_id);
  if v_seated < 2 then
    perform public.game_night_finish_match(v_match.id, 'abandoned');
    return;
  end if;

  select * into v_round from public.game_night_rounds
    where match_id = v_match.id and round_no = v_match.current_round_no;
  if not found or v_round.deadline_at is null or v_round.deadline_at > now() then
    return;
  end if;

  -- Deadline passed. Advance exactly one step per call chain; the new phase
  -- carries a fresh deadline so subsequent calls keep moving.
  if v_round.phase = 'submitting' then
    select count(*) into v_subs from public.game_night_submissions where round_id = v_round.id;
    if v_subs = 0 then
      update public.game_night_rounds set phase = 'voided', deadline_at = now() + interval '10 seconds'
        where id = v_round.id;
      perform public.game_night_log_event(p_room_id, v_match.id, v_round.id, 'round_voided', null,
        jsonb_build_object('reason', 'no_submissions'));
    else
      update public.game_night_rounds set
        phase = 'judging',
        reveal_order = (select jsonb_agg(id order by random())
                        from public.game_night_submissions where round_id = v_round.id),
        deadline_at = now() + interval '60 seconds'
      where id = v_round.id;
    end if;
  elsif v_round.phase = 'judging' then
    update public.game_night_rounds set phase = 'voided', deadline_at = now() + interval '10 seconds'
      where id = v_round.id;
    perform public.game_night_log_event(p_room_id, v_match.id, v_round.id, 'round_voided', null,
      jsonb_build_object('reason', 'judge_timeout'));
  elsif v_round.phase = 'duel_lock' then
    perform public.game_night_resolve_duel(v_round.id);
  elsif v_round.phase in ('round_results', 'duel_results', 'voided') then
    -- Match end conditions.
    if v_match.mode = 'classic' then
      select exists (
        select 1 from jsonb_object_keys(v_match.scores) k
        where (v_match.scores ->> k)::int >= v_match.target_score
      ) into v_target_hit;
      if v_target_hit then
        perform public.game_night_finish_match(v_match.id, 'completed');
        return;
      end if;
    else
      if public.game_night_duel_over(v_match) then
        perform public.game_night_finish_match(v_match.id, 'completed');
        return;
      end if;
    end if;
    perform public.game_night_open_round(v_match.id);
  end if;
end;
$$;

-- ===========================================================================
-- Public commands
-- ===========================================================================

-- Create a room + host membership atomically. Idempotent per (host, key):
-- retries return the existing room.
create or replace function public.game_night_create_room(
  p_idempotency_key text default null,
  p_private boolean default true)
returns table(room_id bigint, room_code text, created boolean)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_code text;
  v_attempt int := 0;
  v_created boolean := false;
begin
  if p_idempotency_key is not null then
    select * into v_room from public.game_night_rooms r
      where r.host_id = v_uid and r.idempotency_key = p_idempotency_key and r.status <> 'ended';
    if found then
      return query select v_room.id, v_room.room_code, false;
      return;
    end if;
  end if;

  loop
    v_attempt := v_attempt + 1;
    -- same alphabet the client uses: 29 chars, no 0/O/1/I/5/S
    select string_agg(substr('ABCDEFGHJKLMNPRTUVWXYZ2346789', (floor(random() * 29) + 1)::int, 1), '')
      into v_code from generate_series(1, 6);
    begin
      insert into public.game_night_rooms (room_code, host_id, idempotency_key, is_private)
      values (v_code, v_uid, p_idempotency_key, p_private)
      returning * into v_room;
      v_created := true;
      exit;
    exception when unique_violation then
      if v_attempt >= 8 then
        raise exception 'room_code_collisions' using errcode = 'P0001';
      end if;
    end;
  end loop;

  insert into public.game_night_players (room_id, user_id, role, seat_no, ready)
  values (v_room.id, v_uid, 'player', 0, true);
  perform public.game_night_log_event(v_room.id, null, null, 'room_created', v_uid,
    jsonb_build_object('code', v_room.room_code, 'private', p_private));
  return query select v_room.id, v_room.room_code, v_created;
end;
$$;

-- Resolve a code for the join screen WITHOUT joining. Truthful minimal data;
-- never creates a phantom room.
create or replace function public.game_night_resolve_room(p_code text)
returns table(room_id bigint, room_code text, status text, host_name text,
              player_count int, watcher_count int, my_role text)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
begin
  select * into v_room from public.game_night_rooms r
    where upper(r.room_code) = upper(p_code) and r.status <> 'ended'
    order by r.id desc limit 1;
  if not found then
    return;
  end if;
  return query
    select v_room.id, v_room.room_code, v_room.status,
           (select u.name from public."user" u where u.id = v_room.host_id),
           (select count(*)::int from public.game_night_players p
             where p.room_id = v_room.id and p.left_at is null and p.role = 'player'),
           (select count(*)::int from public.game_night_players p
             where p.room_id = v_room.id and p.left_at is null and p.role = 'watcher'),
           public.game_night_member_role(v_room.id, v_uid);
end;
$$;

-- Join (or rejoin) a room. Seat claim is serialized by the room row lock;
-- the partial unique seat index is the final guard.
create or replace function public.game_night_join_room(p_code text)
returns table(room_id bigint, room_code text, role text, seat_no smallint)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_role text;
  v_seat smallint;
  v_player_count int;
begin
  v_room := public.game_night_lock_room(p_code);
  perform public.game_night_advance(v_room.id);
  v_room := public.game_night_lock_room(p_code);
  if v_room.status = 'ended' then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;

  -- Already a member? Rejoin path — restore seat/role if still valid.
  select p.role, p.seat_no into v_role, v_seat
    from public.game_night_players p
    where p.room_id = v_room.id and p.user_id = v_uid and p.left_at is null;
  if found then
    update public.game_night_players set last_seen_at = now()
      where room_id = v_room.id and user_id = v_uid;
    perform public.game_night_touch(v_room.id);
    return query select v_room.id, v_room.room_code, v_role, v_seat;
    return;
  end if;

  -- Reactivate a lapsed membership row (unique room_id+user_id) if present.
  select count(*) into v_player_count from public.game_night_players p
    where p.room_id = v_room.id and p.left_at is null and p.role = 'player';
  if v_player_count < 4 and v_room.status = 'open' then
    select s.n into v_seat from generate_series(0, 3) s(n)
      where not exists (
        select 1 from public.game_night_players p
        where p.room_id = v_room.id and p.seat_no = s.n and p.left_at is null and p.role = 'player')
      order by s.n limit 1;
    v_role := 'player';
  else
    v_seat := null;
    v_role := 'watcher';
  end if;

  insert into public.game_night_players (room_id, user_id, role, seat_no)
  values (v_room.id, v_uid, v_role, v_seat)
  on conflict (room_id, user_id)
  do update set left_at = null, role = excluded.role, seat_no = excluded.seat_no,
                joined_at = now(), last_seen_at = now(), ready = false;

  perform public.game_night_touch(v_room.id);
  perform public.game_night_log_event(v_room.id, null, null, 'member_joined', v_uid,
    jsonb_build_object('role', v_role, 'seat', v_seat));
  return query select v_room.id, v_room.room_code, v_role, v_seat;
end;
$$;

-- Leave. Host handoff goes to the earliest-joined remaining member; an empty
-- room ends and releases the code.
create or replace function public.game_night_leave_room(p_code text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_member public.game_night_players;
  v_heir record;
  v_remaining int;
begin
  v_room := public.game_night_lock_room(p_code);
  select * into v_member from public.game_night_players p
    where p.room_id = v_room.id and p.user_id = v_uid and p.left_at is null;
  if not found then
    return; -- leaving a room you're not in is a no-op
  end if;

  update public.game_night_players set left_at = now(), seat_no = null, ready = false
    where id = v_member.id;
  perform public.game_night_touch(v_room.id);
  perform public.game_night_log_event(v_room.id, null, null, 'member_left', v_uid, '{}');

  select count(*) into v_remaining from public.game_night_players p
    where p.room_id = v_room.id and p.left_at is null;
  if v_remaining = 0 then
    update public.game_night_rooms set status = 'ended', updated_at = now() where id = v_room.id;
    update public.game_night_matches set status = 'abandoned', ended_at = now()
      where room_id = v_room.id and status = 'active';
    return;
  end if;

  if v_room.host_id = v_uid then
    select p.user_id into v_heir from public.game_night_players p
      where p.room_id = v_room.id and p.left_at is null
      order by (p.role = 'player') desc, p.joined_at asc limit 1;
    update public.game_night_rooms set host_id = v_heir.user_id, updated_at = now()
      where id = v_room.id;
    perform public.game_night_log_event(v_room.id, null, null, 'host_handoff', v_heir.user_id, '{}');
  end if;

  -- Judge leaving mid-round voids the round; abandonment handled by advance.
  update public.game_night_rounds r set phase = 'voided', deadline_at = now() + interval '10 seconds'
    from public.game_night_matches m
    where r.match_id = m.id and m.room_id = v_room.id and m.status = 'active'
      and r.round_no = m.current_round_no and r.phase in ('submitting', 'judging')
      and r.judge_user_id = v_uid;
  perform public.game_night_advance(v_room.id);
end;
$$;

create or replace function public.game_night_set_ready(p_code text, p_ready boolean)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
begin
  v_room := public.game_night_lock_room(p_code);
  update public.game_night_players set ready = p_ready, ready_at = now()
    where room_id = v_room.id and user_id = v_uid and left_at is null and role = 'player';
  if not found then
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;
  perform public.game_night_touch(v_room.id);
end;
$$;

-- Watcher -> player promotion, only while the room is open and a seat is free.
create or replace function public.game_night_take_seat(p_code text)
returns table(role text, seat_no smallint)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_role text;
  v_seat smallint;
  v_count int;
begin
  v_room := public.game_night_lock_room(p_code);
  select p.role into v_role from public.game_night_players p
    where p.room_id = v_room.id and p.user_id = v_uid and p.left_at is null;
  if v_role is null then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;
  if v_role = 'player' then
    select p.seat_no into v_seat from public.game_night_players p
      where p.room_id = v_room.id and p.user_id = v_uid and p.left_at is null;
    return query select 'player'::text, v_seat;
    return;
  end if;
  if v_room.status <> 'open' then
    raise exception 'room_not_open' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.game_night_players p
    where p.room_id = v_room.id and p.left_at is null and p.role = 'player';
  if v_count >= 4 then
    raise exception 'room_full' using errcode = 'P0001';
  end if;
  select s.n into v_seat from generate_series(0, 3) s(n)
    where not exists (
      select 1 from public.game_night_players p
      where p.room_id = v_room.id and p.seat_no = s.n and p.left_at is null and p.role = 'player')
    order by s.n limit 1;
  update public.game_night_players set role = 'player', seat_no = v_seat, ready = false, last_seen_at = now()
    where room_id = v_room.id and user_id = v_uid and left_at is null;
  perform public.game_night_touch(v_room.id);
  perform public.game_night_log_event(v_room.id, null, null, 'seat_taken', v_uid,
    jsonb_build_object('seat', v_seat));
  return query select 'player'::text, v_seat;
end;
$$;

-- Host kick. Authorized members only; the kicked player's seat frees and any
-- judge duties on the current round are voided via the leave path.
create or replace function public.game_night_kick(p_code text, p_user_id text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
begin
  v_room := public.game_night_lock_room(p_code);
  if v_room.host_id <> v_uid then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_kick_self' using errcode = 'P0001';
  end if;
  update public.game_night_players set left_at = now(), seat_no = null, ready = false
    where room_id = v_room.id and user_id = p_user_id and left_at is null;
  perform public.game_night_log_event(v_room.id, null, null, 'member_kicked', v_uid,
    jsonb_build_object('target', p_user_id));
  update public.game_night_rounds r set phase = 'voided', deadline_at = now() + interval '10 seconds'
    from public.game_night_matches m
    where r.match_id = m.id and m.room_id = v_room.id and m.status = 'active'
      and r.round_no = m.current_round_no and r.phase in ('submitting', 'judging')
      and r.judge_user_id = p_user_id;
  perform public.game_night_advance(v_room.id);
end;
$$;

-- Heartbeat: keeps membership warm + pushes the machine forward. Cheap call
-- the room screen makes on a timer; it is also how deadlines advance without
-- any server scheduler.
create or replace function public.game_night_ping(p_code text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
begin
  select * into v_room from public.game_night_rooms r
    where upper(r.room_code) = upper(p_code) and r.status <> 'ended'
    order by r.id desc limit 1;
  if not found then
    return;
  end if;
  update public.game_night_players set last_seen_at = now()
    where room_id = v_room.id and user_id = v_uid and left_at is null;
  perform public.game_night_advance(v_room.id);
end;
$$;

-- ===========================================================================
-- Match commands
-- ===========================================================================

create or replace function public.game_night_start_match(p_code text, p_command_id text default null)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_match_id bigint;
  v_players text[];
  v_mode text;
  v_prompt_deck jsonb;
  v_answer_deck jsonb;
  v_unready int;
  v_match_no smallint;
begin
  v_room := public.game_night_lock_room(p_code);
  if v_room.host_id <> v_uid then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.game_night_matches m
             where m.room_id = v_room.id and m.status = 'active') then
    select m.id into v_match_id from public.game_night_matches m
      where m.room_id = v_room.id and m.status = 'active';
    return v_match_id; -- idempotent: a live match already exists
  end if;

  select array_agg(user_id order by seat_no) into v_players
    from public.game_night_seated(v_room.id);
  if coalesce(array_length(v_players, 1), 0) < 2 then
    raise exception 'need_two_players' using errcode = 'P0001';
  end if;
  -- everyone seated must be ready (host is auto-ready on create/promote)
  select count(*) into v_unready from public.game_night_players p
    where p.room_id = v_room.id and p.left_at is null and p.role = 'player'
      and p.ready = false and p.user_id <> v_uid;
  if v_unready > 0 then
    raise exception 'players_not_ready' using errcode = 'P0001';
  end if;

  v_mode := case when array_length(v_players, 1) = 2 then 'duel' else 'classic' end;
  v_match_no := v_room.match_seq + 1;

  select jsonb_agg(id order by random()) into v_prompt_deck
    from public.game_night_cards where kind = 'prompt' and active;
  select jsonb_agg(id order by random()) into v_answer_deck
    from public.game_night_cards where kind = 'answer' and active;
  if v_prompt_deck is null or v_answer_deck is null then
    raise exception 'deck_not_seeded' using errcode = 'P0001';
  end if;

  update public.game_night_rooms set status = 'playing', match_seq = v_match_no,
      updated_at = now(), last_activity_at = now()
    where id = v_room.id;

  insert into public.game_night_matches (room_id, match_no, mode, scores)
  values (v_room.id, v_match_no, v_mode,
          (select jsonb_object_agg(u, 0) from unnest(v_players) u))
  returning id into v_match_id;

  insert into public.game_night_decks (match_id, prompt_deck, answer_deck)
  values (v_match_id, v_prompt_deck, v_answer_deck);

  -- deal 7-card hands for classic; duel hands unused (options are per-round)
  if v_mode = 'classic' then
    insert into public.game_night_hands (match_id, user_id, cards)
      select v_match_id, u, '[]'::jsonb from unnest(v_players) u;
    perform public.game_night_refill_hand(v_match_id, u) from unnest(v_players) u;
  end if;

  perform public.game_night_log_event(v_room.id, v_match_id, null, 'match_started', v_uid,
    jsonb_build_object('mode', v_mode, 'players', v_players));
  perform public.game_night_open_round(v_match_id);
  return v_match_id;
end;
$$;

-- Submit answer cards for the current classic round.
create or replace function public.game_night_submit(
  p_code text, p_card_ids text[], p_command_id text default null)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_match public.game_night_matches;
  v_round public.game_night_rounds;
  v_hand jsonb;
  v_card text;
  v_texts jsonb;
  v_sub_id bigint;
  v_subs int;
begin
  if p_command_id is not null then
    select (result ->> 'submission_id')::bigint into v_sub_id
      from public.game_night_commands
      where room_id = (select id from public.game_night_rooms r
                       where upper(r.room_code) = upper(p_code) order by id desc limit 1)
        and command_id = p_command_id;
    if v_sub_id is not null then
      return v_sub_id;
    end if;
  end if;

  v_room := public.game_night_lock_room(p_code);
  perform public.game_night_advance(v_room.id);
  select * into v_match from public.game_night_matches
    where room_id = v_room.id and status = 'active' order by id desc limit 1;
  if not found then
    raise exception 'no_active_match' using errcode = 'P0001';
  end if;
  select * into v_round from public.game_night_rounds
    where match_id = v_match.id and round_no = v_match.current_round_no;
  if v_round.phase <> 'submitting' then
    raise exception 'phase_not_submitting' using errcode = 'P0001';
  end if;
  if v_round.judge_user_id = v_uid then
    raise exception 'judge_cannot_submit' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.game_night_seated(v_room.id) s where s.user_id = v_uid) then
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;
  if array_length(p_card_ids, 1) is distinct from v_round.prompt_pick then
    raise exception 'wrong_card_count' using errcode = 'P0001';
  end if;

  select cards into v_hand from public.game_night_hands
    where match_id = v_match.id and user_id = v_uid for update;
  foreach v_card in array p_card_ids loop
    if not (v_hand ? v_card) then
      raise exception 'card_not_in_hand' using errcode = 'P0001';
    end if;
  end loop;

  select jsonb_agg(c.text order by ord) into v_texts
    from unnest(p_card_ids) with ordinality as u(cid, ord)
    join public.game_night_cards c on c.id = u.cid;

  insert into public.game_night_submissions (round_id, match_id, user_id, cards, card_texts)
  values (v_round.id, v_match.id, v_uid, to_jsonb(p_card_ids), v_texts)
  on conflict (round_id, user_id) do nothing
  returning id into v_sub_id;
  if v_sub_id is null then
    select id into v_sub_id from public.game_night_submissions
      where round_id = v_round.id and user_id = v_uid;
    return v_sub_id; -- duplicate submit replays the existing row
  end if;

  -- Remove the played cards; they go to discard at round end, not immediately
  -- (keeps a cheat path from re-dealing a just-played card mid-round).
  update public.game_night_hands set cards = coalesce((
      select jsonb_agg(x) from jsonb_array_elements_text(v_hand) x
      where not (x = any (p_card_ids))), '[]'::jsonb),
    updated_at = now()
  where match_id = v_match.id and user_id = v_uid;

  if p_command_id is not null then
    insert into public.game_night_commands (room_id, command_id, command_type, actor_user_id, result)
    values (v_room.id, p_command_id, 'submit', v_uid,
            jsonb_build_object('submission_id', v_sub_id))
    on conflict (room_id, command_id) do nothing;
  end if;

  perform public.game_night_touch(v_room.id);
  perform public.game_night_log_event(v_room.id, v_match.id, v_round.id, 'submission', v_uid,
    jsonb_build_object('submission_id', v_sub_id));

  -- All in? Close submissions early.
  select count(*) into v_subs from public.game_night_submissions where round_id = v_round.id;
  if v_subs >= v_round.submissions_expected then
    update public.game_night_rounds set
      phase = 'judging',
      reveal_order = (select jsonb_agg(id order by random())
                      from public.game_night_submissions where round_id = v_round.id),
      deadline_at = now() + interval '60 seconds'
    where id = v_round.id;
    -- played cards now go to discard
    update public.game_night_decks d set answer_discard = answer_discard || coalesce((
      select jsonb_agg(x) from public.game_night_submissions s,
        jsonb_array_elements_text(s.cards) x where s.round_id = v_round.id), '[]'::jsonb)
    where d.match_id = v_match.id;
  end if;
  return v_sub_id;
end;
$$;

-- Judge picks a winner among revealed submissions.
create or replace function public.game_night_judge_pick(
  p_code text, p_submission_id bigint, p_command_id text default null)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_match public.game_night_matches;
  v_round public.game_night_rounds;
  v_sub public.game_night_submissions;
  v_scores jsonb;
begin
  v_room := public.game_night_lock_room(p_code);
  perform public.game_night_advance(v_room.id);
  select * into v_match from public.game_night_matches
    where room_id = v_room.id and status = 'active';
  select * into v_round from public.game_night_rounds
    where match_id = v_match.id and round_no = v_match.current_round_no;
  if v_round.phase <> 'judging' then
    if v_round.phase = 'round_results' and v_round.winner_submission_id = p_submission_id then
      return; -- idempotent replay of an accepted pick
    end if;
    raise exception 'phase_not_judging' using errcode = 'P0001';
  end if;
  if v_round.judge_user_id <> v_uid then
    raise exception 'not_judge' using errcode = 'P0001';
  end if;
  select * into v_sub from public.game_night_submissions
    where id = p_submission_id and round_id = v_round.id;
  if not found then
    raise exception 'invalid_submission' using errcode = 'P0001';
  end if;

  update public.game_night_rounds set
    phase = 'round_results',
    winner_user_id = v_sub.user_id,
    winner_submission_id = v_sub.id,
    deadline_at = now() + interval '10 seconds'
  where id = v_round.id;
  v_scores := jsonb_set(v_match.scores, array[v_sub.user_id],
    to_jsonb(coalesce((v_match.scores ->> v_sub.user_id)::int, 0) + 1));
  update public.game_night_matches set scores = v_scores where id = v_match.id;

  if p_command_id is not null then
    insert into public.game_night_commands (room_id, command_id, command_type, actor_user_id, result)
    values (v_room.id, p_command_id, 'judge_pick', v_uid,
            jsonb_build_object('winner', v_sub.user_id))
    on conflict (room_id, command_id) do nothing;
  end if;
  perform public.game_night_touch(v_room.id);
  perform public.game_night_log_event(v_room.id, v_match.id, v_round.id, 'round_winner', v_uid,
    jsonb_build_object('winner', v_sub.user_id, 'submission', v_sub.id));
end;
$$;

-- Duel pick: server derives subject vs predictor from the round, never the
-- request. The chosen card must come from the shared option set.
create or replace function public.game_night_duel_pick(
  p_code text, p_card_id text, p_command_id text default null)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_match public.game_night_matches;
  v_round public.game_night_rounds;
  v_kind text;
  v_valid boolean;
begin
  v_room := public.game_night_lock_room(p_code);
  perform public.game_night_advance(v_room.id);
  select * into v_match from public.game_night_matches
    where room_id = v_room.id and status = 'active';
  if not found or v_match.mode <> 'duel' then
    raise exception 'not_duel' using errcode = 'P0001';
  end if;
  select * into v_round from public.game_night_rounds
    where match_id = v_match.id and round_no = v_match.current_round_no;
  if v_round.phase <> 'duel_lock' then
    raise exception 'phase_not_duel_lock' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.game_night_seated(v_room.id) s where s.user_id = v_uid) then
    raise exception 'not_a_player' using errcode = 'P0001';
  end if;
  v_kind := case when v_round.duel_subject_user_id = v_uid then 'subject_pick' else 'prediction' end;
  select exists (
    select 1 from jsonb_array_elements(v_round.duel_options) o
    where o ->> 'card_id' = p_card_id
  ) into v_valid;
  if not v_valid then
    raise exception 'card_not_offered' using errcode = 'P0001';
  end if;

  insert into public.game_night_duel_choices (round_id, match_id, user_id, kind, choice_card_id)
  values (v_round.id, v_match.id, v_uid, v_kind, p_card_id)
  on conflict (round_id, user_id) do nothing;

  if p_command_id is not null then
    insert into public.game_night_commands (room_id, command_id, command_type, actor_user_id, result)
    values (v_room.id, p_command_id, 'duel_pick', v_uid, jsonb_build_object('kind', v_kind))
    on conflict (room_id, command_id) do nothing;
  end if;
  perform public.game_night_touch(v_room.id);

  -- resolve as soon as both locks exist
  if exists (select 1 from public.game_night_duel_choices where round_id = v_round.id and kind = 'subject_pick')
     and exists (select 1 from public.game_night_duel_choices where round_id = v_round.id and kind = 'prediction') then
    perform public.game_night_resolve_duel(v_round.id);
  end if;
end;
$$;

-- Host ends the room outright.
create or replace function public.game_night_end_room(p_code text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
begin
  v_room := public.game_night_lock_room(p_code);
  if v_room.host_id <> v_uid then
    raise exception 'not_host' using errcode = 'P0001';
  end if;
  update public.game_night_rooms set status = 'ended', updated_at = now() where id = v_room.id;
  update public.game_night_players set left_at = now(), seat_no = null
    where room_id = v_room.id and left_at is null;
  update public.game_night_matches set status = 'abandoned', ended_at = now()
    where room_id = v_room.id and status = 'active';
  perform public.game_night_log_event(v_room.id, null, null, 'room_ended', v_uid, '{}');
end;
$$;

-- ===========================================================================
-- State projection — the ONLY private-data surface
-- ===========================================================================
create or replace function public.game_night_state(p_code text)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_match public.game_night_matches;
  v_round public.game_night_rounds;
  v_role text;
  v_members jsonb;
  v_me jsonb;
  v_match_json jsonb;
  v_round_json jsonb;
  v_reveal jsonb;
  v_hand jsonb;
  v_subs_in int;
  v_my_sub jsonb;
  v_my_choice jsonb;
begin
  select * into v_room from public.game_night_rooms r
    where upper(r.room_code) = upper(p_code) and r.status <> 'ended'
    order by r.id desc limit 1;
  if not found then
    return jsonb_build_object('error', 'room_not_found');
  end if;
  perform public.game_night_advance(v_room.id);
  select * into v_room from public.game_night_rooms where id = v_room.id;
  v_role := public.game_night_member_role(v_room.id, v_uid);
  if v_role is null then
    -- strangers see only that the code resolves to something private
    return jsonb_build_object('room', jsonb_build_object(
      'code', v_room.room_code, 'status', v_room.status, 'is_private', v_room.is_private),
      'me', jsonb_build_object('role', null, 'member', false));
  end if;

  select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'role', p.role, 'seat_no', p.seat_no,
      'ready', p.ready, 'joined_at', p.joined_at,
      'name', u.name, 'avatar', u.image)
    order by p.seat_no nulls last, p.joined_at)
    into v_members
    from public.game_night_players p
    left join public."user" u on u.id = p.user_id
    where p.room_id = v_room.id and p.left_at is null;

  select * into v_match from public.game_night_matches
    where room_id = v_room.id order by id desc limit 1;

  if v_match.id is not null then
    select * into v_round from public.game_night_rounds
      where match_id = v_match.id and round_no = v_match.current_round_no;

    if v_round.id is not null then
      select count(*) into v_subs_in from public.game_night_submissions where round_id = v_round.id;

      -- reveal list: anonymous during judging; identities only after results
      if v_round.phase = 'judging' then
        select jsonb_agg(jsonb_build_object(
            'submission_id', s.id, 'texts', s.card_texts)
          order by ord.n)
          into v_reveal
          from public.game_night_submissions s
          join jsonb_array_elements_text(v_round.reveal_order) with ordinality
            as ord(sid, n) on ord.sid::bigint = s.id
          where s.round_id = v_round.id;
      elsif v_round.phase in ('round_results', 'voided')
            or (v_match.status <> 'active' and v_round.phase = 'round_results') then
        select jsonb_agg(jsonb_build_object(
            'submission_id', s.id, 'texts', s.card_texts,
            'user_id', s.user_id, 'name', u.name,
            'is_winner', s.id = v_round.winner_submission_id)
          order by ord.n)
          into v_reveal
          from public.game_night_submissions s
          join jsonb_array_elements_text(v_round.reveal_order) with ordinality
            as ord(sid, n) on ord.sid::bigint = s.id
          left join public."user" u on u.id = s.user_id
          where s.round_id = v_round.id;
      end if;

      select jsonb_build_object('cards', s.cards, 'texts', s.card_texts) into v_my_sub
        from public.game_night_submissions s
        where s.round_id = v_round.id and s.user_id = v_uid;

      -- duel: caller sees own lock always; both locks only after results
      if v_round.phase = 'duel_results' or v_round.phase = 'voided' then
        select jsonb_build_object('subject', sp.choice_card_id, 'prediction', pr.choice_card_id,
                'subject_user_id', sp.user_id, 'predictor_user_id', pr.user_id)
          into v_my_choice
          from (select 1) dummy
          left join public.game_night_duel_choices sp
            on sp.round_id = v_round.id and sp.kind = 'subject_pick'
          left join public.game_night_duel_choices pr
            on pr.round_id = v_round.id and pr.kind = 'prediction';
      else
        select jsonb_build_object('mine', c.choice_card_id, 'kind', c.kind)
          into v_my_choice
          from public.game_night_duel_choices c
          where c.round_id = v_round.id and c.user_id = v_uid;
      end if;

      v_round_json := jsonb_build_object(
        'id', v_round.id,
        'round_no', v_round.round_no,
        'phase', v_round.phase,
        'judge_user_id', v_round.judge_user_id,
        'duel_subject_user_id', v_round.duel_subject_user_id,
        'prompt', jsonb_build_object('card_id', v_round.prompt_card_id,
                                     'text', v_round.prompt_text,
                                     'pick', v_round.prompt_pick),
        'deadline_at', v_round.deadline_at,
        'submissions_in', v_subs_in,
        'submissions_expected', v_round.submissions_expected,
        'reveal', coalesce(v_reveal, '[]'::jsonb),
        'duel_options', case when v_match.mode = 'duel' then coalesce(v_round.duel_options, '[]'::jsonb) end,
        'duel_choices', v_my_choice,
        'my_submission', v_my_sub,
        'winner_user_id', case when v_round.phase in ('round_results','duel_results','voided')
                               then v_round.winner_user_id end);
    end if;

    v_match_json := jsonb_build_object(
      'id', v_match.id, 'match_no', v_match.match_no, 'mode', v_match.mode,
      'status', v_match.status, 'target_score', v_match.target_score,
      'scores', v_match.scores, 'winner_user_id', v_match.winner_user_id,
      'tied', v_match.tied, 'current_round_no', v_match.current_round_no,
      'duel_paired_rounds', v_match.duel_paired_rounds);
  end if;

  -- private: caller's hand only
  select jsonb_agg(jsonb_build_object('card_id', c.id, 'text', c.text)
                   order by e.n)
    into v_hand
    from public.game_night_hands h,
         jsonb_array_elements_text(h.cards) with ordinality as e(cid, n)
    join public.game_night_cards c on c.id = e.cid
    where h.match_id = v_match.id and h.user_id = v_uid;

  select jsonb_build_object(
      'user_id', v_uid, 'role', v_role, 'member', true,
      'seat_no', p.seat_no, 'ready', p.ready,
      'is_host', v_room.host_id = v_uid,
      'hand', coalesce(v_hand, '[]'::jsonb))
    into v_me
    from public.game_night_players p
    where p.room_id = v_room.id and p.user_id = v_uid and p.left_at is null;

  return jsonb_build_object(
    'room', jsonb_build_object(
      'id', v_room.id, 'code', v_room.room_code, 'status', v_room.status,
      'is_private', v_room.is_private, 'host_id', v_room.host_id,
      'created_at', v_room.created_at),
    'members', coalesce(v_members, '[]'::jsonb),
    'match', v_match_json,
    'round', v_round_json,
    'me', v_me,
    'server_time', now());
end;
$$;

-- ===========================================================================
-- Chat
-- ===========================================================================
create or replace function public.game_night_send_message(
  p_code text, p_kind text, p_body text default null,
  p_gif jsonb default null, p_reaction text default null)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room_id bigint;
  v_recent int;
  v_id bigint;
begin
  select r.id into v_room_id from public.game_night_rooms r
    where upper(r.room_code) = upper(p_code) and r.status <> 'ended'
    order by r.id desc limit 1;
  if v_room_id is null then
    raise exception 'room_not_found' using errcode = 'P0002';
  end if;
  if not public.game_night_is_member(v_room_id, v_uid) then
    raise exception 'not_a_member' using errcode = 'P0001';
  end if;
  if p_kind not in ('text', 'gif', 'reaction') then
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
  if p_kind = 'text' and (p_body is null or char_length(trim(p_body)) = 0) then
    raise exception 'empty_body' using errcode = 'P0001';
  end if;
  if p_kind = 'gif' and p_gif is null then
    raise exception 'empty_gif' using errcode = 'P0001';
  end if;

  -- rate limit: social traffic is capped separately from gameplay — 10
  -- messages / 10s, reactions 30 / 60s, evaluated on the messages table.
  select count(*) into v_recent from public.game_night_messages m
    where m.room_id = v_room_id and m.user_id = v_uid
      and m.created_at > now() - case when p_kind = 'reaction'
                                      then interval '60 seconds'
                                      else interval '10 seconds' end
      and (p_kind <> 'reaction' or m.kind = 'reaction');
  if (p_kind = 'reaction' and v_recent >= 30) or
     (p_kind <> 'reaction' and v_recent >= 10) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.game_night_messages (room_id, user_id, kind, body, gif, reaction)
  values (v_room_id, v_uid, p_kind, left(p_body, 2000), p_gif, p_reaction)
  returning id into v_id;
  perform public.game_night_touch(v_room_id);
  return v_id;
end;
$$;

-- ===========================================================================
-- Leaderboard
-- ===========================================================================
create or replace function public.game_night_leaderboard(p_mode text default 'classic')
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_top jsonb;
  v_me jsonb;
begin
  with agg as (
    select r.user_id,
           count(*) filter (where r.placement = 1) as wins,
           count(*) as matches,
           sum(r.points) as points
    from public.game_night_results r
    where r.mode = p_mode
    group by r.user_id
  ),
  ranked as (
    select a.*, row_number() over (order by wins desc, points desc, matches desc) as rank
    from agg a
  )
  select jsonb_agg(jsonb_build_object(
      'user_id', ranked.user_id, 'name', u.name, 'avatar', u.image,
      'wins', ranked.wins, 'matches', ranked.matches, 'points', ranked.points,
      'rank', ranked.rank) order by ranked.rank)
    into v_top
    from ranked left join public."user" u on u.id = ranked.user_id
    where ranked.rank <= 10;

  select jsonb_build_object(
      'user_id', ranked.user_id, 'wins', ranked.wins, 'matches', ranked.matches,
      'points', ranked.points, 'rank', ranked.rank)
    into v_me
    from (with agg as (
            select r.user_id,
                   count(*) filter (where r.placement = 1) as wins,
                   count(*) as matches,
                   sum(r.points) as points
            from public.game_night_results r
            where r.mode = p_mode group by r.user_id),
          ranked as (
            select a.*, row_number() over (order by wins desc, points desc, matches desc) as rank
            from agg a)
          select * from ranked) ranked
    where ranked.user_id = v_uid;

  return jsonb_build_object('mode', p_mode,
                            'top10', coalesce(v_top, '[]'::jsonb),
                            'me', v_me);
end;
$$;

-- ===========================================================================
-- Grants: EXECUTE to authenticated only — anon gets nothing.
-- ===========================================================================
revoke all on function public.game_night_actor() from public, anon, authenticated;
revoke all on function public.game_night_log_event(bigint, bigint, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_night_lock_room(text) from public, anon, authenticated;
revoke all on function public.game_night_touch(bigint) from public, anon, authenticated;
revoke all on function public.game_night_jsonb_shift(jsonb, int) from public, anon, authenticated;
revoke all on function public.game_night_jsonb_head(jsonb, int) from public, anon, authenticated;
revoke all on function public.game_night_refill_hand(bigint, text) from public, anon, authenticated;
revoke all on function public.game_night_draw_prompt(bigint) from public, anon, authenticated;
revoke all on function public.game_night_seated(bigint) from public, anon, authenticated;
revoke all on function public.game_night_finish_match(bigint, text) from public, anon, authenticated;
revoke all on function public.game_night_open_round(bigint) from public, anon, authenticated;
revoke all on function public.game_night_resolve_duel(bigint) from public, anon, authenticated;
revoke all on function public.game_night_duel_over(public.game_night_matches) from public, anon, authenticated;
revoke all on function public.game_night_advance(bigint) from public, anon, authenticated;

grant execute on function public.game_night_create_room(text, boolean) to authenticated, service_role;
grant execute on function public.game_night_resolve_room(text) to authenticated, service_role;
grant execute on function public.game_night_join_room(text) to authenticated, service_role;
grant execute on function public.game_night_leave_room(text) to authenticated, service_role;
grant execute on function public.game_night_set_ready(text, boolean) to authenticated, service_role;
grant execute on function public.game_night_take_seat(text) to authenticated, service_role;
grant execute on function public.game_night_kick(text, text) to authenticated, service_role;
grant execute on function public.game_night_ping(text) to authenticated, service_role;
grant execute on function public.game_night_start_match(text, text) to authenticated, service_role;
grant execute on function public.game_night_submit(text, text[], text) to authenticated, service_role;
grant execute on function public.game_night_judge_pick(text, bigint, text) to authenticated, service_role;
grant execute on function public.game_night_duel_pick(text, text, text) to authenticated, service_role;
grant execute on function public.game_night_end_room(text) to authenticated, service_role;
grant execute on function public.game_night_state(text) to authenticated, service_role;
grant execute on function public.game_night_send_message(text, text, text, jsonb, text) to authenticated, service_role;
grant execute on function public.game_night_leaderboard(text) to authenticated, service_role;
