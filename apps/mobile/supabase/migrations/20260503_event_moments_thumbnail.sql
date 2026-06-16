-- Add thumbnail_url column to event_moments for pre-generated video poster frames
ALTER TABLE public.event_moments ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
