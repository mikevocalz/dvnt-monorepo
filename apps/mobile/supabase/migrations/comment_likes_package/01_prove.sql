-- Prove: Baseline verification before migration
-- Run as service_role or superuser. These are READ-ONLY checks.

-- 1. Trigger exists
SELECT tgname, tgenabled
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'comment_likes' AND tgname = 'trigger_update_comment_likes_count';
-- Expected: 1 row, tgenabled = 'O'

-- 2. Unique constraint on (comment_id, user_id)
SELECT conname, contype
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
WHERE t.relname = 'comment_likes' AND contype IN ('p', 'u');
-- Expected: 1 row with contype = 'p' (primary key)

-- 3. comments.likes_count column exists
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'likes_count';
-- Expected: 1 row

-- 4. Current grants on comment_likes
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'comment_likes'
ORDER BY grantee, privilege_type;
-- Baseline for comparison

-- 5. Sample: any negative likes_count (trigger bug)
SELECT id, likes_count FROM public.comments WHERE likes_count < 0;
-- Expected: 0 rows
