-- REVIEW DRAFT ONLY. NOT in the auto-applied migrations directory.
-- Do not execute against a live database until bridge/legacy-client readiness,
-- Realtime behavior, and explicit scoped live-migration approval are established.
-- Identity is the server-signed Better Auth JWT sub, never user_metadata or a
-- caller-supplied recipient id. auth.uid() is unsuitable for non-UUID auth IDs.
BEGIN;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
-- Permissive policies are ORed. Leaving any historical USING(true) would defeat
-- the recipient predicate, so replace every policy for this table atomically.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='notifications'
  LOOP EXECUTE format('DROP POLICY %I ON public.notifications', p.policyname); END LOOP;
END $$;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.notifications_id_seq FROM PUBLIC, anon, authenticated;
-- Table-level revocation does not revoke independently granted column rights.
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='notifications'
  LOOP EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.notifications FROM PUBLIC, anon, authenticated',
    c.column_name,c.column_name,c.column_name,c.column_name); END LOOP;
END $$;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
CREATE POLICY notifications_recipient_read ON public.notifications
  FOR SELECT TO authenticated USING (
    recipient_id IN (SELECT u.id FROM public.users u
      WHERE u.auth_id = (SELECT auth.jwt()->>'sub'))
  );
CREATE POLICY notifications_recipient_read_state ON public.notifications
  FOR UPDATE TO authenticated USING (
    recipient_id IN (SELECT u.id FROM public.users u
      WHERE u.auth_id = (SELECT auth.jwt()->>'sub'))
  ) WITH CHECK (
    recipient_id IN (SELECT u.id FROM public.users u
      WHERE u.auth_id = (SELECT auth.jwt()->>'sub'))
  );
-- Service-role emitters retain their existing explicit privileges and bypass RLS.
-- Never grant client INSERT/DELETE; never allow client UPDATE of recipient,
-- actor, type, entity, payload, created_at or other notification content.
COMMIT;
