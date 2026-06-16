-- Ensure video_rooms has a uuid column with default gen_random_uuid()
-- This column is used by all video edge functions to look up rooms

-- Add uuid column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'video_rooms'
      AND column_name = 'uuid'
  ) THEN
    ALTER TABLE public.video_rooms ADD COLUMN uuid UUID DEFAULT gen_random_uuid();
  END IF;
END $$;

-- Backfill any existing rows that have NULL uuid
UPDATE public.video_rooms SET uuid = gen_random_uuid() WHERE uuid IS NULL;

-- Make uuid NOT NULL and UNIQUE
ALTER TABLE public.video_rooms ALTER COLUMN uuid SET NOT NULL;
ALTER TABLE public.video_rooms ALTER COLUMN uuid SET DEFAULT gen_random_uuid();

-- Add unique index if not exists
CREATE UNIQUE INDEX IF NOT EXISTS video_rooms_uuid_idx ON public.video_rooms (uuid);
