DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'video_rooms'
  ) THEN
    ALTER TABLE public.video_rooms
      ADD COLUMN IF NOT EXISTS sweet_spicy_mode text DEFAULT 'sweet';

    ALTER TABLE public.video_rooms
      DROP CONSTRAINT IF EXISTS video_rooms_sweet_spicy_mode_check;

    ALTER TABLE public.video_rooms
      ADD CONSTRAINT video_rooms_sweet_spicy_mode_check
      CHECK (sweet_spicy_mode IN ('sweet', 'spicy'));

    UPDATE public.video_rooms
    SET sweet_spicy_mode = 'sweet'
    WHERE sweet_spicy_mode IS NULL
       OR sweet_spicy_mode NOT IN ('sweet', 'spicy');

    ALTER TABLE public.video_rooms
      ALTER COLUMN sweet_spicy_mode SET DEFAULT 'sweet';
  END IF;
END $$;
