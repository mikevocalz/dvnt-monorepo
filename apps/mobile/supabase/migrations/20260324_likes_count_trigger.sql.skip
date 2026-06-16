-- Migration: Add trigger-maintained likes_count + unique constraint on likes table
-- This ensures posts.likes_count is ALWAYS in sync with actual likes rows.
-- The get-post-likers reconciliation is kept as a safety net but should never drift.

-- 1. Add unique constraint on (user_id, post_id) to prevent duplicate likes
-- Use IF NOT EXISTS pattern for idempotency
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'likes_user_post_unique'
  ) THEN
    -- Remove any existing duplicates first (keep earliest)
    DELETE FROM likes a USING likes b
    WHERE a.user_id = b.user_id
      AND a.post_id = b.post_id
      AND a.id > b.id;

    ALTER TABLE likes ADD CONSTRAINT likes_user_post_unique UNIQUE (user_id, post_id);
  END IF;
END $$;

-- 2. Create the trigger function for likes_count maintenance
CREATE OR REPLACE FUNCTION maintain_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_maintain_likes_count ON likes;
CREATE TRIGGER trg_maintain_likes_count
  AFTER INSERT OR DELETE ON likes
  FOR EACH ROW EXECUTE FUNCTION maintain_likes_count();

-- 4. Reconcile all existing counts to ensure they match reality
UPDATE posts p
SET likes_count = sub.actual_count
FROM (
  SELECT post_id, COUNT(*) AS actual_count
  FROM likes
  GROUP BY post_id
) sub
WHERE p.id = sub.post_id
  AND p.likes_count IS DISTINCT FROM sub.actual_count;

-- Also zero out posts with no likes rows but non-zero count
UPDATE posts
SET likes_count = 0
WHERE likes_count > 0
  AND id NOT IN (SELECT DISTINCT post_id FROM likes);

-- 5. Verify: should return 0 rows if everything is correct
-- SELECT p.id, p.likes_count, COUNT(l.id) AS actual
-- FROM posts p LEFT JOIN likes l ON l.post_id = p.id
-- GROUP BY p.id, p.likes_count
-- HAVING p.likes_count IS DISTINCT FROM COUNT(l.id)
-- LIMIT 10;
