-- ============================================================
-- Counter Drift Fix: Replace RPC increment/decrement with
-- COUNT(*)-based triggers for all denormalized counters.
-- Triggers recount from actual rows — idempotent & drift-proof.
-- ============================================================

-- ── 1. posts.likes_count trigger (on "likes" table) ──────────

CREATE OR REPLACE FUNCTION public.sync_post_likes_count()
RETURNS TRIGGER AS $$
DECLARE
  target_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_id := NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_id := OLD.post_id;
  ELSE
    target_id := COALESCE(NEW.post_id, OLD.post_id);
  END IF;

  UPDATE posts
  SET likes_count = (SELECT COUNT(*) FROM likes WHERE post_id = target_id)
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_sync_post_likes_count ON public.likes;
CREATE TRIGGER trigger_sync_post_likes_count
  AFTER INSERT OR DELETE ON public.likes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_post_likes_count();


-- ── 2. posts.comments_count trigger (on "comments" table) ────

CREATE OR REPLACE FUNCTION public.sync_post_comments_count()
RETURNS TRIGGER AS $$
DECLARE
  target_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_id := NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_id := OLD.post_id;
  ELSE
    target_id := COALESCE(NEW.post_id, OLD.post_id);
  END IF;

  UPDATE posts
  SET comments_count = (SELECT COUNT(*) FROM comments WHERE post_id = target_id)
  WHERE id = target_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_sync_post_comments_count ON public.comments;
CREATE TRIGGER trigger_sync_post_comments_count
  AFTER INSERT OR DELETE ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_post_comments_count();


-- ── 3. users.followers_count trigger (on "follows" table) ────

CREATE OR REPLACE FUNCTION public.sync_follow_counts()
RETURNS TRIGGER AS $$
DECLARE
  v_follower_id integer;
  v_following_id integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_follower_id  := NEW.follower_id;
    v_following_id := NEW.following_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_follower_id  := OLD.follower_id;
    v_following_id := OLD.following_id;
  ELSE
    v_follower_id  := COALESCE(NEW.follower_id, OLD.follower_id);
    v_following_id := COALESCE(NEW.following_id, OLD.following_id);
  END IF;

  -- Sync followers_count for the user being followed
  UPDATE users
  SET followers_count = (SELECT COUNT(*) FROM follows WHERE following_id = v_following_id)
  WHERE id = v_following_id;

  -- Sync following_count for the follower
  UPDATE users
  SET following_count = (SELECT COUNT(*) FROM follows WHERE follower_id = v_follower_id)
  WHERE id = v_follower_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_sync_follow_counts ON public.follows;
CREATE TRIGGER trigger_sync_follow_counts
  AFTER INSERT OR DELETE ON public.follows
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_follow_counts();


-- ── 4. users.posts_count trigger (on "posts" table) ─────────

CREATE OR REPLACE FUNCTION public.sync_user_posts_count()
RETURNS TRIGGER AS $$
DECLARE
  target_user integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_user := NEW.author_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_user := OLD.author_id;
  ELSE
    target_user := COALESCE(NEW.author_id, OLD.author_id);
  END IF;

  UPDATE users
  SET posts_count = (SELECT COUNT(*) FROM posts WHERE author_id = target_user)
  WHERE id = target_user;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_sync_user_posts_count ON public.posts;
CREATE TRIGGER trigger_sync_user_posts_count
  AFTER INSERT OR DELETE ON public.posts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_posts_count();


-- ═══════════════════════════════════════════════════════════════
-- ONE-TIME RECONCILIATION: Fix all currently drifted counts
-- ═══════════════════════════════════════════════════════════════

-- Fix posts.likes_count
UPDATE posts p
SET likes_count = sub.actual
FROM (
  SELECT post_id, COUNT(*) AS actual
  FROM likes
  GROUP BY post_id
) sub
WHERE p.id = sub.post_id
  AND p.likes_count IS DISTINCT FROM sub.actual;

-- Zero out posts with no likes rows but non-zero count
UPDATE posts
SET likes_count = 0
WHERE likes_count > 0
  AND id NOT IN (SELECT DISTINCT post_id FROM likes);

-- Fix posts.comments_count
UPDATE posts p
SET comments_count = sub.actual
FROM (
  SELECT post_id, COUNT(*) AS actual
  FROM comments
  GROUP BY post_id
) sub
WHERE p.id = sub.post_id
  AND p.comments_count IS DISTINCT FROM sub.actual;

UPDATE posts
SET comments_count = 0
WHERE comments_count > 0
  AND id NOT IN (SELECT DISTINCT post_id FROM comments);

-- Fix users.followers_count
UPDATE users u
SET followers_count = sub.actual
FROM (
  SELECT following_id, COUNT(*) AS actual
  FROM follows
  GROUP BY following_id
) sub
WHERE u.id = sub.following_id
  AND u.followers_count IS DISTINCT FROM sub.actual;

UPDATE users
SET followers_count = 0
WHERE followers_count > 0
  AND id NOT IN (SELECT DISTINCT following_id FROM follows);

-- Fix users.following_count
UPDATE users u
SET following_count = sub.actual
FROM (
  SELECT follower_id, COUNT(*) AS actual
  FROM follows
  GROUP BY follower_id
) sub
WHERE u.id = sub.follower_id
  AND u.following_count IS DISTINCT FROM sub.actual;

UPDATE users
SET following_count = 0
WHERE following_count > 0
  AND id NOT IN (SELECT DISTINCT follower_id FROM follows);

-- Fix users.posts_count
UPDATE users u
SET posts_count = sub.actual
FROM (
  SELECT author_id, COUNT(*) AS actual
  FROM posts
  GROUP BY author_id
) sub
WHERE u.id = sub.author_id
  AND u.posts_count IS DISTINCT FROM sub.actual;

UPDATE users
SET posts_count = 0
WHERE posts_count > 0
  AND id NOT IN (SELECT DISTINCT author_id FROM posts);

-- Done — all counts now match actual rows and triggers prevent future drift
