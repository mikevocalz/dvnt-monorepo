-- game-night hardening — security review follow-ups on the shipped engine.
--
-- 1. Private rooms stop leaking into the public browse list (is_private was
--    stored but never enforced; join-by-code remains the invite mechanism).
-- 2. Kick becomes a real ban: a kicked member can no longer clear left_at via
--    the join upsert.
-- 3. Per-host live-room cap so create_room(null key) cannot mint unbounded rooms.
-- 4. Membership helpers clamp p_user_id to the caller's JWT sub for
--    authenticated callers — the membership oracle is closed while internal
--    (policy/engine) and service-role use keeps working.
-- 5. send_message validates gif payload size/shape and caps reaction length.
-- 6. ping is throttled per member so a looping client cannot serialize the
--    room row lock.
-- 7. submit command-replay no longer resolves against an ended recycled room.
-- 8. game_night_duel_over gains the search_path pin every other function has.

begin;

-- ---------------------------------------------------------------------------
-- 1. Public browse list shows public rooms only.
-- ---------------------------------------------------------------------------

create or replace function public.game_night_list_rooms()
returns table (
  room_code     text,
  status        text,
  host_name     text,
  host_avatar   text,
  player_count  integer,
  watcher_count integer,
  started_at    timestamptz,
  seat_avatars  jsonb
)
language sql
stable
security definer
set search_path to public, pg_temp
as $$
  select
    r.room_code,
    r.status,
    h.name  as host_name,
    h.image as host_avatar,
    coalesce(c.players, 0)::integer  as player_count,
    coalesce(c.watchers, 0)::integer as watcher_count,
    r.created_at as started_at,
    coalesce(s.seats, '[]'::jsonb) as seat_avatars
  from public.game_night_rooms r
  left join public."user" h on h.id = r.host_id
  left join lateral (
    select
      count(*) filter (where p.role = 'player')  as players,
      count(*) filter (where p.role = 'watcher') as watchers
    from public.game_night_players p
    where p.room_id = r.id and p.left_at is null
  ) c on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'avatar', u.image)
                     order by p2.joined_at) as seats
    from public.game_night_players p2
    join public."user" u on u.id = p2.user_id
    where p2.room_id = r.id and p2.left_at is null and p2.role = 'player'
  ) s on true
  where r.status in ('open', 'playing')
    and not r.is_private
  order by r.created_at desc
  limit 100;
$$;

revoke all on function public.game_night_list_rooms() from public, anon;
grant execute on function public.game_night_list_rooms() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Kick is a ban.
-- ---------------------------------------------------------------------------

alter table public.game_night_players
  add column if not exists banned_at timestamptz;

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
  update public.game_night_players
    set left_at = now(), seat_no = null, ready = false, banned_at = now()
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
  v_banned boolean;
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

  -- A kicked member stays out for the life of the room.
  select (p.banned_at is not null) into v_banned
    from public.game_night_players p
    where p.room_id = v_room.id and p.user_id = v_uid;
  if v_banned then
    raise exception 'banned_from_room' using errcode = 'P0001';
  end if;

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

-- ---------------------------------------------------------------------------
-- 3. Per-host live-room cap (8 concurrent non-ended rooms).
-- ---------------------------------------------------------------------------

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
  v_live int;
begin
  if p_idempotency_key is not null then
    select * into v_room from public.game_night_rooms r
      where r.host_id = v_uid and r.idempotency_key = p_idempotency_key and r.status <> 'ended';
    if found then
      return query select v_room.id, v_room.room_code, false;
      return;
    end if;
  end if;

  select count(*) into v_live from public.game_night_rooms r
    where r.host_id = v_uid and r.status <> 'ended';
  if v_live >= 8 then
    raise exception 'room_limit' using errcode = 'P0001';
  end if;

  loop
    v_attempt := v_attempt + 1;
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

-- ---------------------------------------------------------------------------
-- 4. Membership helpers: a different user_id can only be queried by callers
--    whose JWT carries no sub (service role / internal definer calls).
-- ---------------------------------------------------------------------------

create or replace function public.game_night_is_member(p_room_id bigint, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from public.game_night_players p
    where p.room_id = p_room_id
      and p.user_id = coalesce(
            nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
            p_user_id)
      and p.left_at is null);
$$;

create or replace function public.game_night_member_role(p_room_id bigint, p_user_id text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.role from public.game_night_players p
  where p.room_id = p_room_id
    and p.user_id = coalesce(
          nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
          p_user_id)
    and p.left_at is null
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. gif/reaction payload validation in send_message.
-- ---------------------------------------------------------------------------

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
  if p_kind = 'gif' then
    if p_gif is null then
      raise exception 'empty_gif' using errcode = 'P0001';
    end if;
    if octet_length(p_gif::text) > 4096 or jsonb_typeof(p_gif) <> 'object' then
      raise exception 'bad_gif' using errcode = 'P0001';
    end if;
  end if;
  if p_kind = 'reaction' and
     (p_reaction is null or char_length(p_reaction) > 32) then
    raise exception 'bad_reaction' using errcode = 'P0001';
  end if;

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

-- ---------------------------------------------------------------------------
-- 6. ping throttle: one heartbeat per member per 1.5s is enough to advance
--    deadlines; tighter loops only serialize the room row lock.
-- ---------------------------------------------------------------------------

create or replace function public.game_night_ping(p_code text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid text := public.game_night_actor();
  v_room public.game_night_rooms;
  v_seen timestamptz;
begin
  select * into v_room from public.game_night_rooms r
    where upper(r.room_code) = upper(p_code) and r.status <> 'ended'
    order by r.id desc limit 1;
  if not found then
    return;
  end if;
  select p.last_seen_at into v_seen from public.game_night_players p
    where p.room_id = v_room.id and p.user_id = v_uid and p.left_at is null;
  if v_seen is not null and v_seen > now() - interval '1500 milliseconds' then
    return;
  end if;
  update public.game_night_players set last_seen_at = now()
    where room_id = v_room.id and user_id = v_uid and left_at is null;
  perform public.game_night_advance(v_room.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. submit replay lookup must not resolve an ended room on a recycled code.
-- ---------------------------------------------------------------------------

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
                       where upper(r.room_code) = upper(p_code)
                         and r.status <> 'ended'
                       order by id desc limit 1)
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

-- ---------------------------------------------------------------------------
-- 8. search_path pin on duel_over (was the only function missing it).
-- ---------------------------------------------------------------------------

create or replace function public.game_night_duel_over(p_match public.game_night_matches)
returns boolean
language plpgsql stable
set search_path to 'public', 'pg_temp'
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

commit;

notify pgrst, 'reload schema';
