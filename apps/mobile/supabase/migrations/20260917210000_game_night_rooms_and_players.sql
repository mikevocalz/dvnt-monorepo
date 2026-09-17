-- Game Night: persistent room + player state.
--
-- Applied via the Supabase MCP `apply_migration` (the repo convention per
-- NEXT-SESSION.md), so the ledger version will not match this filename. That is
-- normal here — apply_migration generates its own timestamp and takes the name
-- separately. This file is the repo's record of what was applied.
--
-- GRANTS ARE THE BOUNDARY, not policies. Clients read; every write is an edge
-- function on the service role, which authorizes host-or-player itself. Copied
-- from brand_message_outbox / lynk_cohost_invites, and deliberately NOT from
-- video_rooms: that family has RLS enabled with every policy `true` for public,
-- so anyone holding the anon key can insert a room or join any room.
--
-- The write path also sidesteps the accessToken bridge. It fails OPEN to the
-- anon key by design (packages/supabase/src/client.web.ts:116-131), so a
-- client-direct INSERT gated on `authenticated` would 401 whenever minting is
-- cold, offline, or blocked by a privacy extension.

BEGIN;

CREATE TABLE IF NOT EXISTS public.game_night_rooms (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Six characters, supplied by the edge function, NOT defaulted to a uuid.
  -- This code is read ALOUD across a room, which is the whole reason it is
  -- short and omits the lookalike pairs O/0, I/1 and S/5. See
  -- packages/app/features/game-night/room-code.ts.
  room_code   text NOT NULL CHECK (char_length(room_code) = 6),
  -- text, not integer: a Better Auth id. public.users.id is the integer
  -- social-graph identity, a different domain, so no FK to it. Matches
  -- events.host_id, video_room_members.user_id, lynk_cohost_invites.inviter_id.
  host_id     text NOT NULL,
  status      text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'playing', 'ended')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One LIVE room per code, case-insensitive, matching the event_promoters house
-- pattern (unique index on UPPER(code), lookups compare the same way). Partial
-- so an ended room releases its code for reuse, which keeps six characters
-- viable indefinitely instead of exhausting the space.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_night_rooms_active_code
  ON public.game_night_rooms (UPPER(room_code))
  WHERE status <> 'ended';

CREATE TABLE IF NOT EXISTS public.game_night_players (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id    bigint NOT NULL REFERENCES public.game_night_rooms(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz
);

-- A person is in a room once. Rejoining after leaving updates the existing row
-- rather than stacking duplicates that would double them in the roster.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_game_night_players_room_user
  ON public.game_night_players (room_id, user_id);

CREATE INDEX IF NOT EXISTS idx_game_night_players_room
  ON public.game_night_players (room_id) WHERE left_at IS NULL;

ALTER TABLE public.game_night_rooms   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_night_players ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.game_night_rooms   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.game_night_players FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.game_night_rooms   TO authenticated;
GRANT SELECT ON public.game_night_players TO authenticated;
GRANT ALL ON public.game_night_rooms   TO service_role;
GRANT ALL ON public.game_night_players TO service_role;

-- The claim idiom is this repo's canonical one: a TEXT column compared against
-- ->>'sub' with no cast.
--
-- auth.uid() is never used here, and not because it returns null. It casts to
-- uuid, and a Better Auth id is 32 chars that do not parse as one, so it raises
-- 22P02 and ABORTS THE STATEMENT rather than denying a row. onboarding_state
-- and comment_likes still carry auth.uid() policies and are broken live;
-- onboarding-v2-store.ts:70-82 swallows it in a console.warn, which is why
-- nobody noticed.
--
-- The (select ...) wrapper is the repo-wide initplan optimization from
-- 20260519201757 — it evaluates the claim once per statement, not per row.
CREATE POLICY game_night_rooms_select ON public.game_night_rooms
  FOR SELECT TO authenticated
  USING (
    host_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    OR EXISTS (
      SELECT 1 FROM public.game_night_players p
      WHERE p.room_id = game_night_rooms.id
        AND p.left_at IS NULL
        AND p.user_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    )
  );

-- You can see the roster of a room you are in. Not every roster.
CREATE POLICY game_night_players_select ON public.game_night_players
  FOR SELECT TO authenticated
  USING (
    user_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    OR EXISTS (
      SELECT 1 FROM public.game_night_players me
      WHERE me.room_id = game_night_players.room_id
        AND me.left_at IS NULL
        AND me.user_id = (select ((current_setting('request.jwt.claims', true))::json ->> 'sub'))
    )
  );

-- No INSERT/UPDATE/DELETE policy and no write grant, on purpose. A client that
-- could INSERT here could put itself in someone else's room, or name itself host.

COMMIT;

NOTIFY pgrst, 'reload schema';
