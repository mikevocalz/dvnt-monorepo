-- Rollback for 20260312_ticketing_v3_holds_checkins_coorg.sql
-- SAFE: Only drops NEW tables/columns. Does not touch existing data.

-- Remove qr_payload column from tickets (if added)
ALTER TABLE tickets DROP COLUMN IF EXISTS qr_payload;

-- Drop new tables (cascade drops indexes, policies, constraints)
DROP TABLE IF EXISTS audit_log CASCADE;
DROP TABLE IF EXISTS event_co_organizers CASCADE;
DROP TABLE IF EXISTS checkins CASCADE;
DROP TABLE IF EXISTS ticket_holds CASCADE;
