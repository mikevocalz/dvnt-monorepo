-- SEV-0 Likes Regression — Verification Queries
-- Run these in Supabase SQL Editor to verify the fix

-- 1. Verify trigger exists
SELECT tgname, tgrelid::regclass, tgenabled
FROM pg_trigger
WHERE tgname = 'trg_maintain_likes_count';

-- 2. Verify unique constraint exists
SELECT conname, conrelid::regclass
FROM pg_constraint
WHERE conname LIKE '%likes%unique%' OR conname LIKE '%likes%user_id%post_id%';

-- 3. Check for count drift (should return 0 rows)
SELECT p.id, p.likes_count AS stored, COALESCE(sub.actual, 0) AS actual
FROM posts p
LEFT JOIN (
  SELECT post_id, COUNT(*) AS actual FROM likes GROUP BY post_id
) sub ON p.id = sub.post_id
WHERE p.likes_count IS DISTINCT FROM COALESCE(sub.actual, 0)
LIMIT 20;

-- 4. Check for duplicate likes (should return 0 rows)
SELECT user_id, post_id, COUNT(*) AS dupes
FROM likes
GROUP BY user_id, post_id
HAVING COUNT(*) > 1;

-- 5. Check posts with likes_count = 0 but actual likes exist
SELECT p.id, p.likes_count, sub.actual
FROM posts p
JOIN (
  SELECT post_id, COUNT(*) AS actual FROM likes GROUP BY post_id
) sub ON p.id = sub.post_id
WHERE p.likes_count = 0 AND sub.actual > 0;
