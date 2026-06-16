/**
 * Rollback: Sneaky Lynk Tier Update
 * Reverts changes from 20260324_sneaky_lynk_tier_update.sql
 */

-- 1. Revert free plan to 5 participants
UPDATE sneaky_subscription_plans 
SET max_participants = 5, updated_at = NOW()
WHERE id = 'free';

-- 2. Drop usage tracking table (DESTRUCTIVE - only use if no data needed)
DROP TABLE IF EXISTS sneaky_usage_tracking;

-- 3. Remove pronouns column (DESTRUCTIVE - only use if data not needed)
-- ALTER TABLE users DROP COLUMN IF EXISTS pronouns;
-- NOTE: Commented out by default to preserve user data

-- Verify rollback
DO $$
BEGIN
  IF (SELECT max_participants FROM sneaky_subscription_plans WHERE id = 'free') != 5 THEN
    RAISE EXCEPTION 'Free tier should be rolled back to 5 participants';
  END IF;
  
  RAISE NOTICE 'Sneaky Lynk tier rollback completed';
END $$;
