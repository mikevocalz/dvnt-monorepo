-- Game Night: spectator roles + the lobby list projection.
-- Applied via the Supabase MCP; the ledger version will not match this filename.

BEGIN;

-- Spectators become ROWS, not presence.
--
-- The lobby list is a projection across ALL rooms, read by someone who is in
-- none of them. Presence cannot answer "how many are watching room X" from the
-- server without joining every room's channel, so the count has to live in the
-- table. Presence still drives the live roster INSIDE a room, where the client
-- is already subscribed. The two are not redundant — they answer different
-- questions from different vantage points.
ALTER TABLE public.game_night_players
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player'
    CHECK (role IN ('player', 'watcher'));

-- Capacity is NOT a CHECK constraint or a trigger. The repo rule is no
-- constraints on the write path, and capacity here is a product decision that
-- changes behaviour rather than rejecting it: the fifth arrival is not an
-- error, they are a watcher. The edge function picks the role.
CREATE INDEX IF NOT EXISTS idx_game_night_players_room_role
  ON public.game_night_players (room_id, role) WHERE left_at IS NULL;

-- SECURITY DEFINER because game_night_rooms_select deliberately admits only
-- members — correct for the room screen, useless for a browse list. Widening
-- that policy would have leaked room membership to everyone; a definer function
-- returning a fixed projection leaks only what is listed in its signature.
CREATE OR REPLACE FUNCTION public.game_night_list_rooms()
RETURNS TABLE (
  room_code     text,
  status        text,
  host_name     text,
  host_avatar   text,
  player_count  integer,
  watcher_count integer,
  started_at    timestamptz,
  seat_avatars  jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $$
  SELECT
    r.room_code,
    r.status,
    h.name  AS host_name,
    h.image AS host_avatar,
    COALESCE(c.players, 0)::integer  AS player_count,
    COALESCE(c.watchers, 0)::integer AS watcher_count,
    r.created_at AS started_at,
    COALESCE(s.seats, '[]'::jsonb) AS seat_avatars
  FROM public.game_night_rooms r
  LEFT JOIN public."user" h ON h.id = r.host_id
  -- One lateral pass rather than a correlated subquery per column, so a long
  -- lobby stays a single scan of the partial index.
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE p.role = 'player')  AS players,
      count(*) FILTER (WHERE p.role = 'watcher') AS watchers
    FROM public.game_night_players p
    WHERE p.room_id = r.id AND p.left_at IS NULL
  ) c ON true
  -- Only the four seated players carry avatars into the list. Watchers are a
  -- number; naming everyone watching a room to strangers is not something a
  -- browse list needs to do.
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'avatar', u.image)
                     ORDER BY p2.joined_at) AS seats
    FROM public.game_night_players p2
    JOIN public."user" u ON u.id = p2.user_id
    WHERE p2.room_id = r.id AND p2.left_at IS NULL AND p2.role = 'player'
  ) s ON true
  WHERE r.status IN ('open', 'playing')
  ORDER BY r.created_at DESC
  LIMIT 100;
$$;

-- Signed-in only. An anonymous visitor has no business enumerating live rooms.
-- Verified: an anon-key POST to /rest/v1/rpc/game_night_list_rooms returns
-- 401 / 42501 permission denied.
REVOKE ALL ON FUNCTION public.game_night_list_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_night_list_rooms() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
