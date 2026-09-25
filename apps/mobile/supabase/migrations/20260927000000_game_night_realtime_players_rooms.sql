-- Game Night: publish lobby-scoped tables to realtime.
--
-- use-game-state refreshes on postgres_changes; seat/ready changes live on
-- game_night_players and room status on game_night_rooms, neither of which
-- was published. Without them a host only learns a peer is ready on the
-- 20s poll. SELECT policies already scope both tables to room members.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'game_night_players') then
      alter publication supabase_realtime add table public.game_night_players;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'game_night_rooms') then
      alter publication supabase_realtime add table public.game_night_rooms;
    end if;
  end if;
end $$;
