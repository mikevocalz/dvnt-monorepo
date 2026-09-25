-- Game Night: remove deck recycling.
--
-- Product rule (owner decision, 2026-09-26): no card or question may repeat
-- within a match. When the prompt deck is spent — or the answer deck can no
-- longer supply a round — the match ends as 'completed' and placements are
-- recorded. A fresh deck exists only by starting a new match (rematch).
--
-- Replaces three internals from 20260925010000; forward-only, no data change.

-- Refill one hand toward 7 cards WITHOUT recycling the discard pile.
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
  v_need := 7 - coalesce(v_have, 0);
  if v_need <= 0 then
    return;
  end if;
  v_draw := public.game_night_jsonb_head(v_deck.answer_deck, v_need);
  if jsonb_array_length(coalesce(v_draw, '[]'::jsonb)) = 0 then
    return; -- deck spent; hand stays short
  end if;
  insert into public.game_night_hands (match_id, user_id, cards)
  values (p_match_id, p_user_id, v_draw)
  on conflict (match_id, user_id)
  do update set cards = public.game_night_hands.cards || excluded.cards,
                updated_at = now();
  update public.game_night_decks set
    answer_deck = public.game_night_jsonb_shift(v_deck.answer_deck, jsonb_array_length(v_draw))
  where match_id = p_match_id;
end;
$$;

-- Pop the next prompt card WITHOUT recycling prompt discards.
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

-- Open the next round, or COMPLETE the match when the decks can't supply one.
create or replace function public.game_night_open_round(p_match_id bigint)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_match public.game_night_matches;
  v_deck public.game_night_decks;
  v_room_id bigint;
  v_next smallint;
  v_seated text[];
  v_judge text;
  v_subject text;
  v_prompt record;
  v_options jsonb;
  v_round_id bigint;
  v_min_hand int;
  v_answer_left int;
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

  select * into v_deck from public.game_night_decks where match_id = p_match_id;

  -- No recycling: a spent prompt deck ends the match.
  if jsonb_array_length(v_deck.prompt_deck) = 0 then
    perform public.game_night_finish_match(p_match_id, 'completed');
    return null;
  end if;

  select p.card_id, p.card_text, p.card_pick into v_prompt
    from public.game_night_draw_prompt(p_match_id) p;

  v_answer_left := jsonb_array_length(v_deck.answer_deck);

  if v_match.mode = 'classic' then
    -- End the match if the answer deck + weakest hand can't reach the pick.
    select min(coalesce(jsonb_array_length(h.cards), 0)) into v_min_hand
      from public.game_night_seated(v_room_id) s
      left join public.game_night_hands h
        on h.match_id = p_match_id and h.user_id = s.user_id;
    if coalesce(v_min_hand, 0) + v_answer_left < v_prompt.card_pick then
      perform public.game_night_finish_match(p_match_id, 'completed');
      return null;
    end if;

    v_judge := v_seated[((v_next - 1) % array_length(v_seated, 1)) + 1];
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
    -- Duel needs a fresh 6-card option set; fewer means the match is done.
    if v_answer_left < 6 then
      perform public.game_night_finish_match(p_match_id, 'completed');
      return null;
    end if;
    v_subject := v_seated[((v_next - 1) % 2) + 1];
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
