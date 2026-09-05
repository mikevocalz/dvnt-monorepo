-- Server-side session limit for Sneaky Lynk rooms.
--
-- The free tier's 5-minute cap has only ever existed in the client:
-- FREE_ROOM_DURATION_MS in the RoomTimer, counted from video_rooms.created_at.
-- Both platforms agreed on the arithmetic, but nothing enforced it — a client
-- that does not run the timer runs the room indefinitely. The participant cap
-- is already enforced properly (video_create_room resolves the tier and writes
-- max_participants; video_join_room checks count_active_participants against
-- it), and this gives the duration the same treatment.
--
-- NULL means no limit. That is the paid tiers, and it is also every room that
-- already exists — this does not retroactively end live rooms, and no existing
-- row is rewritten.
ALTER TABLE public.video_rooms
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

COMMENT ON COLUMN public.video_rooms.ends_at IS
  'When a tier-limited session expires. NULL = unlimited. Written by video_create_room from the server-resolved plan; the client timer is a display of this, never the source.';

-- Joins after expiry are rejected in video_join_room; the index keeps that
-- check and any sweeper cheap on the open-room set.
CREATE INDEX IF NOT EXISTS idx_video_rooms_ends_at
  ON public.video_rooms (ends_at)
  WHERE status = 'open' AND ends_at IS NOT NULL;
