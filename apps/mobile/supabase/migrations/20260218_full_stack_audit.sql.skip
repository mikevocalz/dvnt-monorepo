-- ============================================================
-- Migration: Full-Stack Audit Hardening
-- Date: 2026-02-18
-- Phases: 1 (indexes, policies, grants), 2 (counters, triggers, orphans), 3 (dedup indexes)
-- Idempotent: safe to run multiple times
-- Rollback: see docs/FULL_STACK_AUDIT.md §5.5
-- ============================================================

-- ============================================================
-- PHASE 1: Additive schema hardening
-- ============================================================

-- 1.1: Missing composite indexes on hot-path queries
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON public.messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conv_unread
  ON public.messages (conversation_id, sender_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conv_rels_user_parent
  ON public.conversations_rels (users_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_stories_author_created
  ON public.stories (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_post_created
  ON public.comments (post_id, created_at DESC);


-- 1.2: Fix locked-out tables (RLS enabled, zero policies)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_rate_limits' AND policyname = 'vrl_select_all') THEN
    CREATE POLICY vrl_select_all ON public.video_rate_limits FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_rate_limits' AND policyname = 'vrl_insert_all') THEN
    CREATE POLICY vrl_insert_all ON public.video_rate_limits FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_room_bans' AND policyname = 'vrb_select_all') THEN
    CREATE POLICY vrb_select_all ON public.video_room_bans FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_room_bans' AND policyname = 'vrb_insert_all') THEN
    CREATE POLICY vrb_insert_all ON public.video_room_bans FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'video_room_bans' AND policyname = 'vrb_delete_all') THEN
    CREATE POLICY vrb_delete_all ON public.video_room_bans FOR DELETE USING (true);
  END IF;
END $$;


-- 1.3: Revoke dangerous anon grants on auth tables
-- session, account, verification contain auth secrets
-- Edge Functions use service_role, so anon access is never needed
REVOKE SELECT ON public.session FROM anon;
REVOKE SELECT ON public.account FROM anon;
REVOKE SELECT ON public.verification FROM anon;


-- ============================================================
-- PHASE 2: Counter drift fix + triggers + orphan cleanup
-- ============================================================

-- 2.1: Fix posts.likes_count drift
UPDATE public.posts p
SET likes_count = sub.actual
FROM (
  SELECT l.post_id, count(*) as actual
  FROM public.likes l
  WHERE l.post_id IS NOT NULL
  GROUP BY l.post_id
) sub
WHERE p.id = sub.post_id AND p.likes_count != sub.actual;

UPDATE public.posts
SET likes_count = 0
WHERE likes_count != 0
  AND id NOT IN (SELECT DISTINCT post_id FROM public.likes WHERE post_id IS NOT NULL);


-- 2.2: Fix posts.comments_count drift
UPDATE public.posts p
SET comments_count = sub.actual
FROM (
  SELECT c.post_id, count(*) as actual
  FROM public.comments c
  WHERE c.post_id IS NOT NULL
  GROUP BY c.post_id
) sub
WHERE p.id = sub.post_id AND p.comments_count != sub.actual;

UPDATE public.posts
SET comments_count = 0
WHERE comments_count != 0
  AND id NOT IN (SELECT DISTINCT post_id FROM public.comments WHERE post_id IS NOT NULL);


-- 2.3: Fix users.posts_count drift
UPDATE public.users u
SET posts_count = sub.actual
FROM (
  SELECT p.author_id, count(*) as actual
  FROM public.posts p
  WHERE p.author_id IS NOT NULL
  GROUP BY p.author_id
) sub
WHERE u.id = sub.author_id AND u.posts_count != sub.actual;


-- 2.4: Add trigger for posts.likes_count (idempotent)
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL THEN
    UPDATE public.posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL THEN
    UPDATE public.posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_likes_update_post_count ON public.likes;
CREATE TRIGGER trg_likes_update_post_count
  AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_post_likes_count();


-- 2.5: Add trigger for posts.comments_count (idempotent)
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.post_id IS NOT NULL THEN
    UPDATE public.posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' AND OLD.post_id IS NOT NULL THEN
    UPDATE public.posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_comments_update_post_count ON public.comments;
CREATE TRIGGER trg_comments_update_post_count
  AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_post_comments_count();


-- 2.6: Clean orphan bookmarks (user_id not in user table)
DELETE FROM public.bookmarks
WHERE user_id NOT IN (SELECT id FROM public."user");

-- 2.7: Clean orphan conversations_rels
DELETE FROM public.conversations_rels
WHERE users_id IS NOT NULL
  AND users_id NOT IN (SELECT id FROM public."user");


-- ============================================================
-- PHASE 3: Remove duplicate indexes
-- ============================================================

-- video_room_members: keep idx_vrm_* variants
DROP INDEX IF EXISTS public.video_room_members_room_user_idx;
DROP INDEX IF EXISTS public.video_room_members_user_idx;

-- video_room_tokens: keep idx_vrt_* variants
DROP INDEX IF EXISTS public.video_room_tokens_jti_idx;
DROP INDEX IF EXISTS public.video_room_tokens_room_user_idx;

-- video_rooms: keep idx_video_rooms_* variants
DROP INDEX IF EXISTS public.video_rooms_created_by_idx;
DROP INDEX IF EXISTS public.video_rooms_status_idx;
DROP INDEX IF EXISTS public.video_rooms_uuid_idx;
