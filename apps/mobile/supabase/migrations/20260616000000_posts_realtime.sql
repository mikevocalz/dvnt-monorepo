-- Enable Supabase realtime for the posts feed.
--
-- The web feed has no pull-to-refresh, so without this the feed only updates on
-- tab-focus. Adding `posts` to the supabase_realtime publication lets the web
-- feed subscribe to INSERT/DELETE and refresh live (see use-feed-realtime.ts).
-- Idempotent: safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.posts;
  END IF;
END $$;
