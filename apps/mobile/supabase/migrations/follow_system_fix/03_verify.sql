-- ============================================================
-- 03_verify.sql — Post-apply verification
-- ============================================================

-- 1. Confirm unique constraint exists
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'follows'::regclass
  AND (contype = 'u' OR contype = 'p');

-- 2. Confirm indexes exist
SELECT indexname FROM pg_indexes WHERE tablename = 'follows';

-- 3. Confirm RLS is enabled
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'follows';

-- 4. List ALL policies — verify no broad INSERT/UPDATE/DELETE for authenticated
SELECT policyname, permissive, roles, cmd
FROM pg_policies WHERE tablename = 'follows';

-- 5. Verify grants — authenticated should only have SELECT
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'follows' AND grantee = 'authenticated';

-- 6. Verify count RPCs exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'increment_followers_count', 'decrement_followers_count',
    'increment_following_count', 'decrement_following_count'
  );

-- 7. STOP-THE-LINE: Fail if authenticated has INSERT on follows
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_name = 'follows' AND grantee = 'authenticated'
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'STOP: authenticated role has write access to follows table';
  END IF;
END $$;
