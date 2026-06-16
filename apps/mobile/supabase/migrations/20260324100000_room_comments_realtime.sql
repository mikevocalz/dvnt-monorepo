-- Enable realtime broadcasting for Sneaky Lynk room comments

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'room_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.room_comments;
  END IF;
END $$;
