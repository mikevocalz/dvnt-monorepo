-- ============================================================================
-- ROLLBACK: Event Spotlight Campaigns
--
-- Run this to fully revert the 20260302 migration.
-- Safe to run multiple times (idempotent).
--
-- WARNING: This drops the campaigns table and all associated data.
--          Only use in emergencies or if the feature is being pulled.
-- ============================================================================

-- 1. Drop functions (CASCADE drops dependent triggers/grants)
DROP FUNCTION IF EXISTS get_spotlight_feed(bigint) CASCADE;
DROP FUNCTION IF EXISTS get_promoted_event_ids(bigint) CASCADE;
DROP FUNCTION IF EXISTS get_event_campaigns(bigint, text) CASCADE;
DROP FUNCTION IF EXISTS expire_spotlight_campaigns() CASCADE;
DROP FUNCTION IF EXISTS update_spotlight_campaign_timestamp() CASCADE;

-- 2. Drop table (CASCADE drops indexes, constraints, policies, triggers)
DROP TABLE IF EXISTS event_spotlight_campaigns CASCADE;

-- 3. Remove flyer columns from events (safe — nullable, no dependents)
ALTER TABLE events DROP COLUMN IF EXISTS flyer_image_url;
ALTER TABLE events DROP COLUMN IF EXISTS flyer_image_meta;

-- 4. Verification: confirm clean state
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_name = 'event_spotlight_campaigns';
-- Expect: 0
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name IN ('flyer_image_url', 'flyer_image_meta');
-- Expect: 0 rows
