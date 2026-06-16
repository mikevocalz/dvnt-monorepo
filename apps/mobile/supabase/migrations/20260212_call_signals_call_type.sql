-- Add call_type column to call_signals table
-- Supports distinguishing audio vs video calls

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'call_signals'
      AND column_name = 'call_type'
  ) THEN
    ALTER TABLE public.call_signals ADD COLUMN call_type TEXT NOT NULL DEFAULT 'video';
  END IF;
END $$;
