-- Add youtube_video_url column to events table
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS youtube_video_url TEXT DEFAULT NULL;
