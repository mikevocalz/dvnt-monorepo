-- ============================================================
-- 01_prove.sql — Read-only baseline queries
-- Run BEFORE applying 02_apply.sql to capture current state.
-- ============================================================

-- 1. Confirm follows table exists and check row count
SELECT 'follows' AS table_name, count(*) AS row_count FROM follows;

-- 2. Check follows column types
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'follows'
ORDER BY ordinal_position;

-- 3. Check existing constraints on follows
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'follows'::regclass;

-- 4. Check existing indexes on follows
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'follows';

-- 5. Check existing RLS status
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'follows';

-- 6. Check existing policies on follows
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'follows';

-- 7. Check existing grants on follows
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'follows';

-- 8. Check users table has followers_count / following_count
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('followers_count', 'following_count');

-- 9. Check existing increment/decrement RPCs
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'increment_followers_count', 'decrement_followers_count',
    'increment_following_count', 'decrement_following_count'
  );
