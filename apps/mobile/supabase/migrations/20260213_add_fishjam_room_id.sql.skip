-- Add fishjam_room_id column to video_rooms if it doesn't exist.
-- The 20260213_video_rooms_schema.sql used CREATE TABLE IF NOT EXISTS,
-- which skipped entirely because the table already existed from earlier
-- migrations — so this column was never added to production.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'video_rooms'
      AND column_name = 'fishjam_room_id'
  ) THEN
    ALTER TABLE public.video_rooms ADD COLUMN fishjam_room_id TEXT;
  END IF;
END $$;
