-- GIF + Live Photo support: additive columns on posts_media and stories_items
-- SAFE: all new columns are nullable with defaults — no existing row breaks

-- posts_media: store MIME type so renderers know image/gif vs image/jpeg
ALTER TABLE public.posts_media
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS live_photo_video_url text;

-- media (central media table): store MIME type for stories + avatars
ALTER TABLE public.media
  ADD COLUMN IF NOT EXISTS mime_type text;

-- stories: store optional paired-video URL for Live Photo story items
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS live_photo_video_url text;

-- Index for fast "show me all GIF posts" queries (feed, profile grid)
CREATE INDEX IF NOT EXISTS idx_posts_media_mime_type
  ON public.posts_media (mime_type)
  WHERE mime_type IS NOT NULL;

-- service_role grants (required for edge functions)
GRANT ALL ON public.posts_media TO service_role;
GRANT ALL ON public.media TO service_role;
GRANT ALL ON public.stories TO service_role;

-- Verify
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts_media' AND column_name = 'mime_type'
  ), 'posts_media.mime_type not found';
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts_media' AND column_name = 'live_photo_video_url'
  ), 'posts_media.live_photo_video_url not found';
  RAISE NOTICE 'GIF + Live Photo migration verified OK';
END $$;
