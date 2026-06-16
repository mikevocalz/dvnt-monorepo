-- ============================================================
-- 04_rollback.sql — Safe rollback
-- Restores previous state if 02_apply.sql causes issues.
-- ============================================================

-- 1. Drop the unique constraint we added (if it was new)
ALTER TABLE follows DROP CONSTRAINT IF EXISTS uq_follows_pair;

-- 2. Drop indexes we added
DROP INDEX IF EXISTS idx_follows_follower_date;
DROP INDEX IF EXISTS idx_follows_following_date;
DROP INDEX IF EXISTS idx_follows_pair;

-- 3. Restore INSERT/DELETE grants for authenticated (previous state)
GRANT SELECT, INSERT, DELETE ON follows TO authenticated;

-- 4. Drop our restrictive policy
DROP POLICY IF EXISTS follows_select_auth ON follows;

-- Note: RLS stays enabled — disabling it would be a security regression.
-- The restored grants allow authenticated to write again (previous behavior).
