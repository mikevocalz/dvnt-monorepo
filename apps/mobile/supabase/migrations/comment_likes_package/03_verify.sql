-- Verify: Assert migration success
-- Run after 02_apply.sql

-- 1. authenticated can no longer INSERT/DELETE
SELECT privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'comment_likes'
  AND grantee = 'authenticated';
-- Expected: SELECT only (no INSERT, no DELETE)

-- 2. service_role has full access
SELECT COUNT(*) AS service_role_privs
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'comment_likes'
  AND grantee = 'service_role';
-- Expected: >= 3 (SELECT, INSERT, DELETE at minimum)

-- 3. Trigger still present
SELECT 1 FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
WHERE c.relname = 'comment_likes' AND tgname = 'trigger_update_comment_likes_count';
-- Expected: 1 row
