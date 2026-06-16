-- ════════════════════════════════════════════════════════════════════════
-- Flyer media (Pillar D) — the columns the <EventFlyer> precedence resolves:
--   video_flyer_url → video_poster_url/static (flyer_image_url|cover_image_url|
--   image) → generated fallback (gradient from dominant_color + title).
-- Builds on existing events.flyer_image_url + flyer_image_meta (which already
-- carries {width,height,aspectRatio,blurhash}); only adds what's missing.
-- Additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS video_flyer_url text,    -- hero video flyer (autoplay muted in feed)
  ADD COLUMN IF NOT EXISTS video_poster_url text,   -- first-frame poster (static contexts: wallet/share/.ics/OG)
  ADD COLUMN IF NOT EXISTS dominant_color text;     -- skeleton bg + generated-fallback gradient seed

COMMENT ON COLUMN public.events.video_flyer_url IS 'Hero video flyer. Static contexts use video_poster_url, never the video.';
COMMENT ON COLUMN public.events.video_poster_url IS 'First-frame poster; generated server-side when a video flyer is uploaded.';
COMMENT ON COLUMN public.events.dominant_color IS 'Hex dominant color for skeletons + the generated-fallback gradient. flyer_image_meta.aspectRatio holds flyer_aspect.';

-- Backfill dominant_color from the blurhash-adjacent meta where a hex was stored.
UPDATE public.events
SET dominant_color = flyer_image_meta->>'dominantColor'
WHERE dominant_color IS NULL
  AND flyer_image_meta ? 'dominantColor';
