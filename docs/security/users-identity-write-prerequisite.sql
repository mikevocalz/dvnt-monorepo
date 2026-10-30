-- REVIEW DRAFT ONLY; never automatically applied by migration tooling.
-- Prerequisite for notification ownership policies. Existing repo design in
-- 20261003150000_users_anon_write_lockdown.sql already sends profile mutations
-- through verified service-role edge functions, not direct client writes.
-- This blocks direct client remapping, NOT an unsafe privileged auth-sync/RPC.
-- In particular, auth-sync's email-based rebind remains a separate blocker.
BEGIN;
-- An ALL policy also supplies SELECT. Do not silently change read compatibility.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='users' AND cmd='ALL') THEN
    RAISE EXCEPTION 'Review users ALL policies before identity write lockdown';
  END IF;
END $$;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.users FROM PUBLIC, anon, authenticated;
-- Independent column privileges survive table-level revocation.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT attname FROM pg_attribute WHERE attrelid='public.users'::regclass
    AND attnum>0 AND NOT attisdropped
  LOOP EXECUTE format('REVOKE INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON public.users FROM PUBLIC, anon, authenticated', c.attname);
  END LOOP;
END $$;
-- Retain every SELECT policy and all existing SELECT grants unchanged.
-- Service_role bypasses RLS and retains its explicit privileges.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public'
    AND tablename='users' AND cmd IN ('INSERT','UPDATE','DELETE')
  LOOP EXECUTE format('DROP POLICY %I ON public.users',p.policyname); END LOOP;
END $$;
COMMIT;
