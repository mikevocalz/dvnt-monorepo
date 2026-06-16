-- ============================================================================
-- FIX: Ticket user_id mismatch causing creator tickets to be invisible
-- 
-- PROBLEM: Some tickets have user_id = integer (e.g. "11") but auth system
-- uses auth_id = text (e.g. "pKa8v6movw4tdx0uhVN9v2IPiAEwD7ug")
-- This causes RLS policy to fail and creators can't see their own tickets.
--
-- SOLUTION: Update all tickets with integer user_id to use proper auth_id
-- ============================================================================

-- 1. Update tickets that have integer user_id to use auth_id from users table
UPDATE tickets t
SET user_id = u.auth_id
FROM users u
WHERE t.user_id = u.id::text
  AND u.auth_id IS NOT NULL
  AND u.auth_id != t.user_id;

-- 2. Add comment explaining the fix
COMMENT ON TABLE tickets IS 'user_id must be auth_id (Better Auth), not integer user.id';

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
