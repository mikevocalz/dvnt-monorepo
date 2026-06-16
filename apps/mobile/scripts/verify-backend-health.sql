-- ============================================================================
-- DVNT Backend Health Verification — Run anytime to check for regressions
-- Paste into Supabase SQL Editor. Returns one JSON row.
-- ALL counts should be 0 for a healthy backend.
-- ============================================================================

WITH
-- 1. Tables without RLS (should be 0)
no_rls AS (
  SELECT t.tablename FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.tablename NOT IN ('spatial_ref_sys','geometry_columns','geography_columns')
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = t.tablename AND n.nspname = 'public' AND c.relrowsecurity = true)
),
-- 2. Tables with RLS but no anon SELECT policy (should be 0)
no_anon AS (
  SELECT c.relname FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
    AND NOT EXISTS (SELECT 1 FROM pg_policies p
      WHERE p.tablename = c.relname AND p.schemaname = 'public'
        AND p.cmd = 'SELECT' AND p.roles::text LIKE '%anon%')
),
-- 3. Counter drift
likes_drift AS (
  SELECT p.id FROM posts p
  LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM likes GROUP BY post_id) a ON a.post_id = p.id
  WHERE p.likes_count != COALESCE(a.cnt, 0)
),
followers_drift AS (
  SELECT u.id FROM users u
  LEFT JOIN (SELECT following_id, COUNT(*) AS cnt FROM follows GROUP BY following_id) a ON a.following_id = u.id
  WHERE u.followers_count != COALESCE(a.cnt, 0)
),
following_drift AS (
  SELECT u.id FROM users u
  LEFT JOIN (SELECT follower_id, COUNT(*) AS cnt FROM follows GROUP BY follower_id) a ON a.follower_id = u.id
  WHERE u.following_count != COALESCE(a.cnt, 0)
),
-- 4. Duplicate auth_ids (should be 0)
dup_auth AS (
  SELECT auth_id FROM users WHERE auth_id IS NOT NULL AND auth_id != ''
  GROUP BY auth_id HAVING COUNT(*) > 1
),
-- 5. Orphaned likes
orphan_likes AS (
  SELECT l.id FROM likes l LEFT JOIN posts p ON p.id = l.post_id WHERE p.id IS NULL
)

SELECT jsonb_build_object(
  'healthy', (
    (SELECT COUNT(*) FROM no_rls) = 0
    AND (SELECT COUNT(*) FROM no_anon) = 0
    AND (SELECT COUNT(*) FROM likes_drift) = 0
    AND (SELECT COUNT(*) FROM followers_drift) = 0
    AND (SELECT COUNT(*) FROM following_drift) = 0
    AND (SELECT COUNT(*) FROM dup_auth) = 0
  ),
  'tables_without_rls', (SELECT COUNT(*) FROM no_rls),
  'tables_without_anon_select', (SELECT COUNT(*) FROM no_anon),
  'likes_count_drift', (SELECT COUNT(*) FROM likes_drift),
  'followers_count_drift', (SELECT COUNT(*) FROM followers_drift),
  'following_count_drift', (SELECT COUNT(*) FROM following_drift),
  'duplicate_auth_ids', (SELECT COUNT(*) FROM dup_auth),
  'orphaned_likes', (SELECT COUNT(*) FROM orphan_likes)
) AS health_check;
