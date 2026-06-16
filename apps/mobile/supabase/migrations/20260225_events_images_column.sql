-- Add images JSONB column to events table for additional event photos
-- Stores array of objects like [{"type": "image", "url": "https://..."}]
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
