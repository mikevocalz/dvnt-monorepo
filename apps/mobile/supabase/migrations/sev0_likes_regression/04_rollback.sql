-- SEV-0 Likes Regression — Rollback
-- Only run if the trigger is causing issues

-- 1. Drop the trigger (stops auto-maintenance of likes_count)
DROP TRIGGER IF EXISTS trg_maintain_likes_count ON likes;

-- 2. Drop the trigger function
DROP FUNCTION IF EXISTS fn_maintain_likes_count();

-- NOTE: The unique constraint on likes(user_id, post_id) should NOT be rolled back
-- as it prevents duplicate likes which is always desired.

-- After rollback, likes_count must be maintained manually or via reconciliation:
-- UPDATE posts p SET likes_count = (SELECT COUNT(*) FROM likes WHERE post_id = p.id);
