-- ============================================================
-- 01_prove.sql — Read-only baseline queries
-- Run BEFORE applying 02_apply.sql to capture current state.
-- ============================================================

-- 1. Confirm events table exists and check row count
SELECT 'events' AS table_name, count(*) AS row_count FROM events;

-- 2. Confirm users table exists and check row count
SELECT 'users' AS table_name, count(*) AS row_count FROM users;

-- 3. Check events.id column type (should be integer)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'events' AND column_name IN ('id', 'host_id', 'title', 'description', 'start_date', 'end_date')
ORDER BY ordinal_position;

-- 4. Check users.id column type (should be integer)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users' AND column_name IN ('id', 'auth_id')
ORDER BY ordinal_position;

-- 5. Check if new tables already exist (should NOT exist yet)
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('event_organizers', 'event_revisions', 'event_promotions');

-- 6. Check existing RLS policies on events table
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'events';

-- 7. Check existing RPC functions we'll modify
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('get_event_detail', 'get_events_home', 'get_events_for_you');

-- 8. Check existing event_spotlight_campaigns (to avoid conflicts)
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'event_spotlight_campaigns'
) AS spotlight_campaigns_exists;

-- 9. Capture current events column list for diff after apply
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'events'
ORDER BY ordinal_position;
