-- ============================================================================
-- VERIFICATION SUITE: Event Spotlight Campaigns (20260302)
--
-- Run after applying the migration. ALL gates must pass.
-- Copy-paste into Supabase SQL editor or psql.
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- GATE A: Schema invariants — columns/types/nullability match expectations
-- ════════════════════════════════════════════════════════════════════════════
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'event_spotlight_campaigns'
ORDER BY ordinal_position;
-- EXPECT 14 rows:
--   id              | bigint    | NO  | generated
--   event_id        | bigint    | NO  |
--   city_id         | bigint    | YES |
--   organizer_id    | text      | NO  |
--   placement       | text      | NO  | 'spotlight+feed'
--   priority        | integer   | NO  | 0
--   status          | text      | NO  | 'pending'
--   starts_at       | timestamp with time zone | NO  |
--   ends_at         | timestamp with time zone | NO  |
--   stripe_payment_intent_id | text | YES |
--   receipt_id      | bigint    | YES |
--   amount_cents    | integer   | NO  | 0
--   currency        | text      | NO  | 'usd'
--   created_at      | timestamp with time zone | NO  | now()
--   updated_at      | timestamp with time zone | NO  | now()

-- Flyer columns on events table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'events'
  AND column_name IN ('flyer_image_url', 'flyer_image_meta')
ORDER BY column_name;
-- EXPECT 2 rows, both nullable


-- ════════════════════════════════════════════════════════════════════════════
-- GATE B: RLS is enabled on the table
-- ════════════════════════════════════════════════════════════════════════════
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE relname = 'event_spotlight_campaigns';
-- EXPECT: relrowsecurity = true


-- ════════════════════════════════════════════════════════════════════════════
-- GATE C: Deny-by-default policies exist for anon + authenticated
-- ════════════════════════════════════════════════════════════════════════════
SELECT policyname, roles, cmd, permissive, qual, with_check
FROM pg_policies
WHERE tablename = 'event_spotlight_campaigns'
ORDER BY policyname;
-- EXPECT 8 deny policies:
--   deny_anon_select     | {anon}          | SELECT | PERMISSIVE | false |
--   deny_anon_insert     | {anon}          | INSERT | PERMISSIVE |       | false
--   deny_anon_update     | {anon}          | UPDATE | PERMISSIVE | false | false
--   deny_anon_delete     | {anon}          | DELETE | PERMISSIVE | false |
--   deny_auth_select     | {authenticated} | SELECT | PERMISSIVE | false |
--   deny_auth_insert     | {authenticated} | INSERT | PERMISSIVE |       | false
--   deny_auth_update     | {authenticated} | UPDATE | PERMISSIVE | false | false
--   deny_auth_delete     | {authenticated} | DELETE | PERMISSIVE | false |
--
-- MUST NOT contain: spotlight_select_active, spotlight_select_own,
--   spotlight_insert_own, spotlight_update_own, spotlight_delete_own


-- ════════════════════════════════════════════════════════════════════════════
-- GATE D: No table-level grants for client roles
-- ════════════════════════════════════════════════════════════════════════════
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_name = 'event_spotlight_campaigns'
  AND grantee IN ('anon', 'authenticated');
-- EXPECT: 0 rows (all grants revoked)


-- ════════════════════════════════════════════════════════════════════════════
-- GATE E: Client role CANNOT read table directly
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT count(*) FROM event_spotlight_campaigns;
-- EXPECT: ERROR (permission denied) or 0 rows
RESET ROLE;

SET ROLE anon;
SELECT count(*) FROM event_spotlight_campaigns;
-- EXPECT: ERROR (permission denied) or 0 rows
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- GATE F: Client role CANNOT write to table directly
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
-- This should fail with permission denied or RLS violation
INSERT INTO event_spotlight_campaigns (event_id, organizer_id, starts_at, ends_at, amount_cents)
VALUES (1, 'test', now(), now() + interval '1 day', 999);
-- EXPECT: ERROR
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- GATE G: SECURITY DEFINER RPCs work from client roles (bypass RLS)
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE authenticated;
SELECT get_spotlight_feed(NULL);
-- EXPECT: '[]'::jsonb (no data, but NO error)
RESET ROLE;

SET ROLE anon;
SELECT get_spotlight_feed(NULL);
-- EXPECT: '[]'::jsonb (no data, but NO error)
RESET ROLE;

SET ROLE authenticated;
SELECT * FROM get_promoted_event_ids(NULL);
-- EXPECT: 0 rows (no data, but NO error)
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- GATE H: get_event_campaigns enforces JWT verification
-- ════════════════════════════════════════════════════════════════════════════
-- Without JWT claims set, should return empty array
SET ROLE authenticated;
SELECT get_event_campaigns(1, 'some_organizer_id');
-- EXPECT: '[]'::jsonb (JWT sub is null, so mismatch → empty)
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- GATE I: service_role has full access (gateway path works)
-- ════════════════════════════════════════════════════════════════════════════
SET ROLE service_role;
SELECT count(*) FROM event_spotlight_campaigns;
-- EXPECT: 0 (no data, but NO error — full access confirmed)
RESET ROLE;


-- ════════════════════════════════════════════════════════════════════════════
-- GATE J: Indexes exist
-- ════════════════════════════════════════════════════════════════════════════
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'event_spotlight_campaigns'
ORDER BY indexname;
-- EXPECT 5 indexes:
--   event_spotlight_campaigns_pkey   (PK)
--   idx_spotlight_active_city        (partial, WHERE status = 'active')
--   idx_spotlight_by_event           (event_id, status)
--   idx_spotlight_by_organizer       (organizer_id)
--   idx_spotlight_stripe_pi          (unique partial, stripe_payment_intent_id)


-- ════════════════════════════════════════════════════════════════════════════
-- GATE K: Trigger exists
-- ════════════════════════════════════════════════════════════════════════════
SELECT trigger_name, event_manipulation, action_timing
FROM information_schema.triggers
WHERE event_object_table = 'event_spotlight_campaigns';
-- EXPECT: trg_spotlight_campaign_updated | UPDATE | BEFORE


-- ════════════════════════════════════════════════════════════════════════════
-- GATE L: CHECK constraints exist
-- ════════════════════════════════════════════════════════════════════════════
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'event_spotlight_campaigns'::regclass
  AND contype = 'c'
ORDER BY conname;
-- EXPECT 3 constraints:
--   ends_after_starts         (ends_at > starts_at)
--   event_spotlight_campaigns_placement_check  (placement IN (...))
--   event_spotlight_campaigns_status_check     (status IN (...))


-- ════════════════════════════════════════════════════════════════════════════
-- GATE M: No orphan data (integrity check — run post-backfill if needed)
-- ════════════════════════════════════════════════════════════════════════════
-- Campaigns with non-existent events
SELECT c.id FROM event_spotlight_campaigns c
LEFT JOIN events e ON e.id = c.event_id
WHERE e.id IS NULL;
-- EXPECT: 0 rows

-- Campaigns with non-existent organizers
SELECT c.id FROM event_spotlight_campaigns c
LEFT JOIN users u ON u.auth_id = c.organizer_id
WHERE u.id IS NULL;
-- EXPECT: 0 rows (or flag for investigation)


-- ════════════════════════════════════════════════════════════════════════════
-- GATE N: FK constraint fk_spotlight_city exists (after 20260303 runs)
-- ════════════════════════════════════════════════════════════════════════════
-- NOTE: This FK is created by 20260303, not 20260302. Run this gate AFTER
-- both migrations have been applied.
SELECT conname, confrelid::regclass AS referenced_table
FROM pg_constraint
WHERE conrelid = 'event_spotlight_campaigns'::regclass
  AND conname = 'fk_spotlight_city';
-- EXPECT: 1 row → fk_spotlight_city referencing cities
-- If 0 rows: cities migration (20260303) hasn't run yet, or FK creation failed.
-- Resolution: re-run the DO $$ block from 20260303 manually.


-- ════════════════════════════════════════════════════════════════════════════
-- GATE O: No client bypass — full path audit
-- ════════════════════════════════════════════════════════════════════════════
-- Verify: no table-level grants for writes exist for client roles
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_name = 'event_spotlight_campaigns'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
-- EXPECT: 0 rows

-- Verify: service_role retains full access
SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_name = 'event_spotlight_campaigns'
  AND grantee = 'service_role';
-- EXPECT: SELECT, INSERT, UPDATE, DELETE (4 rows minimum)
