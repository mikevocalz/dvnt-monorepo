-- ============================================================
-- CLEANUP: Orphaned likes + investigate missing auth_id users
--
-- STEP 1: Run the INSPECT queries first (read-only).
-- STEP 2: If results look correct, run the DELETE block.
-- Requires: SQL Editor in "Destructive mode" (toggle in Supabase dashboard)
-- ============================================================

-- ── INSPECT: Show the 2 orphaned likes (post no longer exists) ──
SELECT
  l.id          AS like_id,
  l.post_id,
  l.user_id,
  l.created_at,
  u.username    AS liker_username
FROM likes l
LEFT JOIN posts p ON p.id = l.post_id
LEFT JOIN users u ON u.id = l.user_id
WHERE p.id IS NULL
ORDER BY l.created_at;

-- ── INSPECT: Show the 11 users missing auth_id ──
SELECT
  u.id,
  u.username,
  u.created_at,
  u.auth_id,
  -- Check if a Better Auth user row exists with matching email
  ba.id   AS better_auth_id,
  ba.name AS better_auth_name,
  ba.email
FROM users u
LEFT JOIN "user" ba ON ba.email = u.email
WHERE u.auth_id IS NULL OR u.auth_id = ''
ORDER BY u.created_at;

-- ── INSPECT: Count summary before cleanup ──
SELECT
  (SELECT COUNT(*) FROM likes l LEFT JOIN posts p ON p.id = l.post_id WHERE p.id IS NULL)
    AS orphaned_likes,
  (SELECT COUNT(*) FROM users WHERE auth_id IS NULL OR auth_id = '')
    AS users_missing_auth_id;


-- ============================================================
-- DESTRUCTIVE: Delete orphaned likes
-- Only run after confirming the INSPECT results above look correct.
-- The sync_post_likes_count trigger will auto-fix likes_count.
-- ============================================================

DELETE FROM likes
WHERE post_id NOT IN (SELECT id FROM posts);

-- Verify: should return 0
SELECT COUNT(*) AS remaining_orphaned_likes
FROM likes l
LEFT JOIN posts p ON p.id = l.post_id
WHERE p.id IS NULL;


-- ============================================================
-- REPAIR: Backfill auth_id for users that have a matching
-- Better Auth row (matched by email).
-- Safe to run — only updates rows where auth_id IS NULL/empty
-- AND a matching Better Auth user exists.
-- ============================================================

UPDATE users u
SET auth_id = ba.id
FROM "user" ba
WHERE (u.auth_id IS NULL OR u.auth_id = '')
  AND ba.email IS NOT NULL
  AND u.email IS NOT NULL
  AND ba.email = u.email;

-- Show remaining users still missing auth_id after repair
-- (these are truly orphaned — no matching Better Auth row)
SELECT
  u.id,
  u.username,
  u.created_at,
  u.email
FROM users u
WHERE u.auth_id IS NULL OR u.auth_id = ''
ORDER BY u.created_at;
