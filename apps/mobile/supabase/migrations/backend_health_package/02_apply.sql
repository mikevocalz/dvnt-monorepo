-- ============================================================================
-- DVNT Backend Health — APPLY (Idempotent, Non-Destructive)
-- Run in Supabase SQL Editor. All statements are guarded with IF NOT EXISTS.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 0: INDEXES — Add missing indexes for hot query paths
-- ═══════════════════════════════════════════════════════════════════════════

-- Messages: conversation_id + created_at (getConversations last-message query)
CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages (conversation_id, created_at DESC);

-- Messages: sender_id (unread count per sender)
CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON messages (sender_id);

-- Messages: read_at for unread queries
CREATE INDEX IF NOT EXISTS idx_messages_read_at
  ON messages (conversation_id, read_at) WHERE read_at IS NULL;

-- Likes: post_id (count queries, orphan checks)
CREATE INDEX IF NOT EXISTS idx_likes_post_id
  ON likes (post_id);

-- Likes: user_id (my liked posts)
CREATE INDEX IF NOT EXISTS idx_likes_user_id
  ON likes (user_id);

-- Likes: unique constraint to prevent double-likes
CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_post_unique
  ON likes (user_id, post_id);

-- Comments: post_id + created_at (comment threads)
CREATE INDEX IF NOT EXISTS idx_comments_post_created
  ON comments (post_id, created_at DESC);

-- Comment likes: unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_likes_user_comment_unique
  ON comment_likes (user_id, comment_id);

-- Follows: follower_id (who am I following?)
CREATE INDEX IF NOT EXISTS idx_follows_follower
  ON follows (follower_id);

-- Follows: following_id (who follows me?)
CREATE INDEX IF NOT EXISTS idx_follows_following
  ON follows (following_id);

-- Bookmarks: user_id (my bookmarks)
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id
  ON bookmarks (user_id);

-- Bookmarks: unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_user_post_unique
  ON bookmarks (user_id, post_id);

-- Notifications: recipient_id + created_at (activity feed)
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON notifications (recipient_id, created_at DESC);

-- Notifications: unread filter
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (recipient_id, read) WHERE read = false;

-- Posts: author_id (profile posts)
CREATE INDEX IF NOT EXISTS idx_posts_author
  ON posts (author_id, created_at DESC);

-- Stories: author_id + expires_at (active stories)
CREATE INDEX IF NOT EXISTS idx_stories_author_active
  ON public.stories (author_id, expires_at);

-- Story views: unique per user per story
CREATE UNIQUE INDEX IF NOT EXISTS idx_story_views_unique
  ON public.story_views (story_id, user_id);

-- Events: start_date for upcoming/past queries
CREATE INDEX IF NOT EXISTS idx_events_start_date
  ON events (start_date) WHERE start_date IS NOT NULL;

-- Event RSVPs: event_id + user_id unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_rsvps_unique
  ON event_rsvps (event_id, user_id);

-- Event likes: event_id + user_id unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_likes_unique
  ON event_likes (event_id, user_id);

-- Tickets: event_id + user_id for lookup
CREATE INDEX IF NOT EXISTS idx_tickets_event_user
  ON tickets (event_id, user_id);

-- Tickets: qr_token for scan lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_qr_token
  ON tickets (qr_token) WHERE qr_token IS NOT NULL;

-- Conversations rels: users_id for inbox queries
CREATE INDEX IF NOT EXISTS idx_conv_rels_user
  ON conversations_rels (users_id);

-- Users: auth_id (identity resolution — most critical index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_id_unique
  ON users (auth_id) WHERE auth_id IS NOT NULL AND auth_id != '';

-- Users: username for profile lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
  ON users (username) WHERE username IS NOT NULL AND username != '';


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: COUNTER RECONCILIATION FUNCTION
-- Callable on-demand or via cron to fix drifted counters
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reconcile_counters()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}'::jsonb;
  fixed_likes int := 0;
  fixed_comments int := 0;
  fixed_followers int := 0;
  fixed_following int := 0;
  fixed_posts int := 0;
  fixed_comment_likes int := 0;
BEGIN
  -- Fix posts.likes_count
  WITH drifted AS (
    SELECT p.id, COALESCE(a.cnt, 0) AS actual
    FROM posts p
    LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM likes GROUP BY post_id) a ON a.post_id = p.id
    WHERE p.likes_count != COALESCE(a.cnt, 0)
  )
  UPDATE posts SET likes_count = d.actual
  FROM drifted d WHERE posts.id = d.id;
  GET DIAGNOSTICS fixed_likes = ROW_COUNT;

  -- Fix posts.comments_count
  WITH drifted AS (
    SELECT p.id, COALESCE(a.cnt, 0) AS actual
    FROM posts p
    LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM comments GROUP BY post_id) a ON a.post_id = p.id
    WHERE p.comments_count != COALESCE(a.cnt, 0)
  )
  UPDATE posts SET comments_count = d.actual
  FROM drifted d WHERE posts.id = d.id;
  GET DIAGNOSTICS fixed_comments = ROW_COUNT;

  -- Fix users.followers_count
  WITH drifted AS (
    SELECT u.id, COALESCE(a.cnt, 0) AS actual
    FROM users u
    LEFT JOIN (SELECT following_id, COUNT(*) AS cnt FROM follows GROUP BY following_id) a ON a.following_id = u.id
    WHERE u.followers_count != COALESCE(a.cnt, 0)
  )
  UPDATE users SET followers_count = d.actual
  FROM drifted d WHERE users.id = d.id;
  GET DIAGNOSTICS fixed_followers = ROW_COUNT;

  -- Fix users.following_count
  WITH drifted AS (
    SELECT u.id, COALESCE(a.cnt, 0) AS actual
    FROM users u
    LEFT JOIN (SELECT follower_id, COUNT(*) AS cnt FROM follows GROUP BY follower_id) a ON a.follower_id = u.id
    WHERE u.following_count != COALESCE(a.cnt, 0)
  )
  UPDATE users SET following_count = d.actual
  FROM drifted d WHERE users.id = d.id;
  GET DIAGNOSTICS fixed_following = ROW_COUNT;

  -- Fix users.posts_count
  WITH drifted AS (
    SELECT u.id, COALESCE(a.cnt, 0) AS actual
    FROM users u
    LEFT JOIN (SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id) a ON a.author_id = u.id
    WHERE COALESCE(u.posts_count, 0) != COALESCE(a.cnt, 0)
  )
  UPDATE users SET posts_count = d.actual
  FROM drifted d WHERE users.id = d.id;
  GET DIAGNOSTICS fixed_posts = ROW_COUNT;

  -- Fix comments.likes_count
  WITH drifted AS (
    SELECT c.id, COALESCE(a.cnt, 0) AS actual
    FROM comments c
    LEFT JOIN (SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id) a ON a.comment_id = c.id
    WHERE c.likes_count != COALESCE(a.cnt, 0)
  )
  UPDATE comments SET likes_count = d.actual
  FROM drifted d WHERE comments.id = d.id;
  GET DIAGNOSTICS fixed_comment_likes = ROW_COUNT;

  result := jsonb_build_object(
    'fixed_post_likes', fixed_likes,
    'fixed_post_comments', fixed_comments,
    'fixed_user_followers', fixed_followers,
    'fixed_user_following', fixed_following,
    'fixed_user_posts', fixed_posts,
    'fixed_comment_likes', fixed_comment_likes,
    'reconciled_at', NOW()
  );

  RAISE NOTICE 'Counter reconciliation complete: %', result;
  RETURN result;
END;
$$;

-- Grant execute to service_role only
REVOKE ALL ON FUNCTION public.reconcile_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_counters() FROM authenticated;
REVOKE ALL ON FUNCTION public.reconcile_counters() FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_counters() TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2: LOCK DOWN DIRECT WRITES — Gateway-only enforcement
-- Tables that should only be writable via Edge Functions (service_role)
-- ═══════════════════════════════════════════════════════════════════════════

-- Likes: revoke direct writes (toggle-like Edge Function handles this)
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.likes FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on likes from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'likes grant revoke skipped: %', SQLERRM;
END $$;

-- Bookmarks: revoke direct writes (toggle-bookmark Edge Function handles this)
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.bookmarks FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on bookmarks from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'bookmarks grant revoke skipped: %', SQLERRM;
END $$;

-- Event likes: revoke direct writes
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.event_likes FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on event_likes from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'event_likes grant revoke skipped: %', SQLERRM;
END $$;

-- Event RSVPs: revoke direct writes
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.event_rsvps FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on event_rsvps from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'event_rsvps grant revoke skipped: %', SQLERRM;
END $$;

-- Notifications: revoke writes (only Edge Functions should create)
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on notifications from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'notifications grant revoke skipped: %', SQLERRM;
END $$;

-- Posts: revoke direct writes (create-post, update-post, delete-post EFs)
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.posts FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on posts from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'posts grant revoke skipped: %', SQLERRM;
END $$;

-- Posts media: revoke direct writes
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.posts_media FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on posts_media from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'posts_media grant revoke skipped: %', SQLERRM;
END $$;

-- Comments: revoke direct writes (add-comment, delete-comment EFs)
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.comments FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on comments from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'comments grant revoke skipped: %', SQLERRM;
END $$;

-- Stories: revoke direct writes (create-story, delete-story EFs)
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.stories FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on stories from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'stories grant revoke skipped: %', SQLERRM;
END $$;

-- Events: revoke direct writes
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.events FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on events from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'events grant revoke skipped: %', SQLERRM;
END $$;

-- Tickets: revoke direct writes
DO $$ BEGIN
  REVOKE INSERT, UPDATE, DELETE ON public.tickets FROM authenticated;
  RAISE NOTICE 'Revoked direct writes on tickets from authenticated';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'tickets grant revoke skipped: %', SQLERRM;
END $$;

-- Ensure service_role can still write to ALL tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: ENSURE RLS IS ENABLED ON ALL CORE TABLES
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE IF EXISTS public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_rsvps ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.posts_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.conversations_rels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.story_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_types ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4: SAFE SELECT POLICIES (deny-by-default + minimal read access)
-- Only add if policy doesn't already exist
-- ═══════════════════════════════════════════════════════════════════════════

-- Posts: anyone authenticated can read public posts
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'posts' AND policyname = 'posts_select_public') THEN
    CREATE POLICY posts_select_public ON public.posts FOR SELECT TO authenticated
      USING (visibility = 'public' OR author_id = (SELECT id FROM users WHERE auth_id = auth.uid()::text LIMIT 1));
  END IF;
END $$;

-- Events: anyone can read events
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'events_select_all') THEN
    CREATE POLICY events_select_all ON public.events FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Users: public profile data readable
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_select_public') THEN
    CREATE POLICY users_select_public ON public.users FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Ticket types: readable for event browsing
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ticket_types' AND policyname = 'ticket_types_select_all') THEN
    CREATE POLICY ticket_types_select_all ON public.ticket_types FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
