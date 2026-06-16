-- ═══════════════════════════════════════════════════════════════════════
-- 1. STORY_VIEWS — Fix column mismatch and ensure RLS/grants for anon key
-- The table has: id, story_id, user_id, created_at, updated_at
-- The app code was referencing "viewed_at" which doesn't exist.
-- We add viewed_at as an alias (computed column won't work, so we add the actual column)
-- ═══════════════════════════════════════════════════════════════════════

-- Add viewed_at column if it doesn't exist (mirrors created_at for backward compat)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'story_views' AND column_name = 'viewed_at' AND table_schema = 'public'
  ) THEN
    ALTER TABLE public.story_views ADD COLUMN viewed_at TIMESTAMPTZ DEFAULT now();
    -- Backfill from created_at
    UPDATE public.story_views SET viewed_at = created_at WHERE viewed_at IS NULL;
  END IF;
END $$;

-- Ensure unique constraint exists for upsert
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'story_views_story_id_user_id_key'
  ) THEN
    ALTER TABLE public.story_views
      ADD CONSTRAINT story_views_story_id_user_id_key
      UNIQUE (story_id, user_id);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_story_views_story_id ON public.story_views(story_id);
CREATE INDEX IF NOT EXISTS idx_story_views_user_id ON public.story_views(user_id);

-- RLS: Enable but allow all operations for anon/authenticated
-- The app uses anon key (Better Auth, not Supabase Auth), so auth.uid() is always null.
-- We use permissive policies instead.
ALTER TABLE public.story_views ENABLE ROW LEVEL SECURITY;

-- Drop old restrictive policies that use auth.uid() (they silently block everything)
DROP POLICY IF EXISTS "story_views_select_story_owner" ON public.story_views;
DROP POLICY IF EXISTS "story_views_insert_own" ON public.story_views;
DROP POLICY IF EXISTS "story_views_update_own" ON public.story_views;
DROP POLICY IF EXISTS "story_views_select" ON public.story_views;

-- Create permissive policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'story_views' AND policyname = 'story_views_select_all') THEN
    CREATE POLICY "story_views_select_all" ON public.story_views FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'story_views' AND policyname = 'story_views_insert_all') THEN
    CREATE POLICY "story_views_insert_all" ON public.story_views FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'story_views' AND policyname = 'story_views_update_all') THEN
    CREATE POLICY "story_views_update_all" ON public.story_views FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'story_views' AND policyname = 'story_views_delete_all') THEN
    CREATE POLICY "story_views_delete_all" ON public.story_views FOR DELETE USING (true);
  END IF;
END $$;

-- Grants for anon, authenticated, service_role
GRANT ALL ON public.story_views TO anon;
GRANT ALL ON public.story_views TO authenticated;
GRANT ALL ON public.story_views TO service_role;
GRANT USAGE, SELECT ON SEQUENCE story_views_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE story_views_id_seq TO authenticated;
GRANT ALL ON SEQUENCE story_views_id_seq TO service_role;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. USER_PRESENCE — New table for online/offline status
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_presence (
  user_id INTEGER PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_is_online ON public.user_presence(is_online) WHERE is_online = true;
CREATE INDEX IF NOT EXISTS idx_user_presence_last_seen ON public.user_presence(last_seen_at DESC);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_presence' AND policyname = 'user_presence_select_all') THEN
    CREATE POLICY "user_presence_select_all" ON public.user_presence FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_presence' AND policyname = 'user_presence_insert_all') THEN
    CREATE POLICY "user_presence_insert_all" ON public.user_presence FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_presence' AND policyname = 'user_presence_update_all') THEN
    CREATE POLICY "user_presence_update_all" ON public.user_presence FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_presence' AND policyname = 'user_presence_delete_all') THEN
    CREATE POLICY "user_presence_delete_all" ON public.user_presence FOR DELETE USING (true);
  END IF;
END $$;

GRANT ALL ON public.user_presence TO anon;
GRANT ALL ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. EVENT_COMMENT_TAGS — New table for @ mentions in event comments
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.event_comment_tags (
  id SERIAL PRIMARY KEY,
  comment_id INTEGER NOT NULL,
  tagged_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_comment_tags_comment ON public.event_comment_tags(comment_id);
CREATE INDEX IF NOT EXISTS idx_event_comment_tags_user ON public.event_comment_tags(tagged_user_id);

ALTER TABLE public.event_comment_tags ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_comment_tags' AND policyname = 'event_comment_tags_select_all') THEN
    CREATE POLICY "event_comment_tags_select_all" ON public.event_comment_tags FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_comment_tags' AND policyname = 'event_comment_tags_insert_all') THEN
    CREATE POLICY "event_comment_tags_insert_all" ON public.event_comment_tags FOR INSERT WITH CHECK (true);
  END IF;
END $$;

GRANT ALL ON public.event_comment_tags TO anon;
GRANT ALL ON public.event_comment_tags TO authenticated;
GRANT ALL ON public.event_comment_tags TO service_role;
GRANT USAGE, SELECT ON SEQUENCE event_comment_tags_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE event_comment_tags_id_seq TO authenticated;
GRANT ALL ON SEQUENCE event_comment_tags_id_seq TO service_role;
