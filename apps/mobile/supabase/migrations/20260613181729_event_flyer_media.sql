-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260613181729 :: event_flyer_media). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS video_flyer_url text,
  ADD COLUMN IF NOT EXISTS video_poster_url text,
  ADD COLUMN IF NOT EXISTS dominant_color text;

COMMENT ON COLUMN public.events.video_flyer_url IS 'Hero video flyer. Static contexts use video_poster_url, never the video.';
COMMENT ON COLUMN public.events.video_poster_url IS 'First-frame poster; generated server-side when a video flyer is uploaded.';
COMMENT ON COLUMN public.events.dominant_color IS 'Hex dominant color for skeletons + the generated-fallback gradient. flyer_image_meta.aspectRatio holds flyer_aspect.';

UPDATE public.events
SET dominant_color = flyer_image_meta->>'dominantColor'
WHERE dominant_color IS NULL
  AND flyer_image_meta ? 'dominantColor';;
