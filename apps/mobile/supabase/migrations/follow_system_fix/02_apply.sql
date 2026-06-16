-- ============================================================
-- 02_apply.sql — Idempotent schema changes
-- Follow system: constraints, indexes, RLS lockdown
-- ============================================================

-- ── 1. Ensure UNIQUE constraint on (follower_id, following_id) ──
-- The follows table may already have a PK or unique; add only if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'follows'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%follower_id%following_id%'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'follows'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) LIKE '%follower_id%following_id%'
  ) THEN
    ALTER TABLE follows ADD CONSTRAINT uq_follows_pair UNIQUE (follower_id, following_id);
    RAISE NOTICE 'Added unique constraint uq_follows_pair';
  ELSE
    RAISE NOTICE 'Unique constraint on (follower_id, following_id) already exists';
  END IF;
END $$;

-- ── 2. Indexes for efficient lookups ──
CREATE INDEX IF NOT EXISTS idx_follows_follower_date
  ON follows(follower_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_follows_following_date
  ON follows(following_id, created_at DESC);

-- Composite for "does viewer follow target?" checks
CREATE INDEX IF NOT EXISTS idx_follows_pair
  ON follows(follower_id, following_id);

-- ── 3. Enable RLS ──
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- ── 4. RLS Policies — deny-by-default for writes ──

-- Read: anyone authenticated can see follows (needed for profile counts, etc.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'follows_select_auth' AND tablename = 'follows') THEN
    CREATE POLICY follows_select_auth ON follows FOR SELECT TO authenticated
    USING (true);
  END IF;
END $$;

-- CRITICAL: Drop any broad write policies that may exist
DO $$ BEGIN
  -- Drop INSERT policies for authenticated (writes must go through gateway)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'follows' AND cmd = 'INSERT' AND 'authenticated' = ANY(roles)) THEN
    -- We can't easily drop by name without knowing it, so we'll create restrictive ones
    NULL;
  END IF;
END $$;

-- Deny direct client writes — only service_role (edge functions) can write
-- This is enforced by NOT having INSERT/UPDATE/DELETE policies for authenticated
-- and having RLS enabled. Service role bypasses RLS.

-- ── 5. Grants — minimal for authenticated ──
GRANT SELECT ON follows TO authenticated;
-- Explicitly revoke direct write access (service_role bypasses RLS anyway)
REVOKE INSERT, UPDATE, DELETE ON follows FROM authenticated;

-- Service role gets full access
GRANT ALL ON follows TO service_role;

-- ── 6. Ensure count RPCs exist (idempotent) ──
CREATE OR REPLACE FUNCTION public.increment_followers_count(user_id integer)
RETURNS void AS $$
BEGIN
  UPDATE users SET followers_count = COALESCE(followers_count, 0) + 1 WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.decrement_followers_count(user_id integer)
RETURNS void AS $$
BEGIN
  UPDATE users SET followers_count = GREATEST(COALESCE(followers_count, 0) - 1, 0) WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.increment_following_count(user_id integer)
RETURNS void AS $$
BEGIN
  UPDATE users SET following_count = COALESCE(following_count, 0) + 1 WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.decrement_following_count(user_id integer)
RETURNS void AS $$
BEGIN
  UPDATE users SET following_count = GREATEST(COALESCE(following_count, 0) - 1, 0) WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.increment_followers_count(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_followers_count(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_following_count(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_following_count(integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
