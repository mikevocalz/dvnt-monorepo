-- Verification queries for 20260312_ticketing_v3_holds_checkins_coorg.sql

-- 1. Verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('ticket_holds', 'checkins', 'event_co_organizers', 'audit_log')
ORDER BY table_name;
-- Expected: 4 rows

-- 2. Verify ticket_holds columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'ticket_holds' ORDER BY ordinal_position;

-- 3. Verify checkins columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'checkins' ORDER BY ordinal_position;

-- 4. Verify event_co_organizers columns
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'event_co_organizers' ORDER BY ordinal_position;

-- 5. Verify indexes exist
SELECT indexname FROM pg_indexes
WHERE tablename IN ('ticket_holds', 'checkins', 'event_co_organizers', 'audit_log')
ORDER BY indexname;

-- 6. Verify RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE tablename IN ('ticket_holds', 'checkins', 'event_co_organizers', 'audit_log');
-- Expected: all rowsecurity = true

-- 7. Verify service_role grants
SELECT grantee, privilege_type FROM information_schema.table_privileges
WHERE table_name IN ('ticket_holds', 'checkins', 'event_co_organizers', 'audit_log')
  AND grantee = 'service_role';

-- 8. Verify qr_payload column on tickets
SELECT column_name FROM information_schema.columns
WHERE table_name = 'tickets' AND column_name = 'qr_payload';
-- Expected: 1 row

-- 9. Performance: verify index usage (run after data exists)
-- EXPLAIN ANALYZE SELECT * FROM ticket_holds WHERE ticket_type_id = '...' AND status = 'active' AND expires_at > now();
-- Should show index scan on idx_ticket_holds_type_status
