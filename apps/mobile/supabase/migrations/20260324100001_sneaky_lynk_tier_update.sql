/**
 * Sneaky Lynk Tier Update Migration
 * - Update free tier from 5 to 7 participants
 * - Add pronouns column to users table
 * - Create usage tracking table for daily limits
 */

-- 1. Update free plan max_participants from 5 to 7
UPDATE sneaky_subscription_plans 
SET max_participants = 7
WHERE id = 'free';

-- 2. Add pronouns column to users table (if not exists)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS pronouns TEXT;

-- 3. Create usage tracking table for daily session limits
CREATE TABLE IF NOT EXISTS sneaky_usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  room_id INTEGER NOT NULL REFERENCES video_rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

-- Index for fast daily usage queries
CREATE INDEX IF NOT EXISTS idx_sneaky_usage_user_created 
ON sneaky_usage_tracking(user_id, created_at DESC);

-- 4. Verify migration success
DO $$
BEGIN
  -- Verify free tier has 7 participants
  IF (SELECT max_participants FROM sneaky_subscription_plans WHERE id = 'free') != 7 THEN
    RAISE EXCEPTION 'Free tier max_participants should be 7';
  END IF;
  
  -- Verify pronouns column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'pronouns'
  ) THEN
    RAISE EXCEPTION 'Pronouns column should exist on users table';
  END IF;
  
  -- Verify usage tracking table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'sneaky_usage_tracking'
  ) THEN
    RAISE EXCEPTION 'sneaky_usage_tracking table should exist';
  END IF;
  
  RAISE NOTICE 'Sneaky Lynk tier update migration completed successfully';
END $$;
