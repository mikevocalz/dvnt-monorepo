-- Presence heartbeat freshness for live rooms.
-- video_heartbeat refreshes this every ~30s while a client is connected; the
-- list function applies a tight window to it so abandoned rooms (host closed the
-- tab without a clean leave) stop reading as LIVE within ~90s instead of hours.
-- Nullable so clients that don't heartbeat yet fall back to the lenient joined_at.
ALTER TABLE public.video_room_members
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS video_room_members_last_seen_idx
  ON public.video_room_members (room_id, last_seen_at);
