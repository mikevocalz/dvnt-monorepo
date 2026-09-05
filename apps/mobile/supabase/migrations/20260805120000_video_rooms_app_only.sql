-- Sneaky Lynk — app-only rooms.
--
-- `app_only` marks a room that web clients may not join. It is the ONLY
-- enforced tier of capture protection: everything in packages/app/lib/
-- secure-capture is deterrence + attribution, whereas an app-only room simply
-- never mints a Fishjam peer token for a browser (see the edge function
-- video_join_room). Native clients then run under FLAG_SECURE (Android) /
-- the iOS capture blackout, which the browser has no equivalent for.
--
-- Table verified against 20260213100001_video_rooms_schema.sql:
--   public.video_rooms (id SERIAL PK, uuid UUID, created_by TEXT, ...)
-- Rooms are addressed externally by `uuid`; `id` is the internal FK target.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'video_rooms'
      AND column_name = 'app_only'
  ) THEN
    ALTER TABLE public.video_rooms
      ADD COLUMN app_only BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Partial index: app-only rooms are the rare case, and the join gate reads the
-- flag on a single-row uuid lookup, so this exists for admin/moderation
-- listings rather than the hot path.
CREATE INDEX IF NOT EXISTS video_rooms_app_only_idx
  ON public.video_rooms (app_only)
  WHERE app_only;

COMMENT ON COLUMN public.video_rooms.app_only IS
  'When true, video_join_room rejects web clients with detail.reason = ROOM_APP_ONLY before minting a peer token. Client-declared platform, so honest-browser scoped.';
