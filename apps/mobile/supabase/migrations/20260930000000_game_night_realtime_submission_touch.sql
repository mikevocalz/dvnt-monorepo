-- Game Night: realtime nudge for private match tables.
--
-- game_night_submissions and game_night_duel_choices are service-role only on
-- purpose — un-revealed picks must never be client-readable — so they cannot
-- join the supabase_realtime publication or take an authenticated SELECT
-- policy. Without a signal, a remote player's face-down card (submissions_in,
-- duel lock counts) only surfaced on the 20s ping poll.
--
-- Instead an AFTER INSERT trigger touches the parent round row, which IS
-- published and room-scoped, so every member's use-game-state subscription
-- refreshes the server-side projection within ~300ms. The projection alone
-- decides what is exposed; the nudge leaks nothing beyond "a row changed".

create or replace function public.game_night_touch_round()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No-op write: still emits a postgres_changes UPDATE for the round.
  update public.game_night_rounds set id = id where id = new.round_id;
  return new;
end;
$$;

drop trigger if exists game_night_submissions_touch on public.game_night_submissions;
create trigger game_night_submissions_touch
  after insert on public.game_night_submissions
  for each row execute function public.game_night_touch_round();

drop trigger if exists game_night_duel_choices_touch on public.game_night_duel_choices;
create trigger game_night_duel_choices_touch
  after insert on public.game_night_duel_choices
  for each row execute function public.game_night_touch_round();
