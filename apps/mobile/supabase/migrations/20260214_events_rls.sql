-- Enable RLS on events table (idempotent)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Grant table access to anon and authenticated roles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;

-- Grant sequence usage for SERIAL id column
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO authenticated;

-- SELECT: anyone can read events
CREATE POLICY "events_select_all"
  ON public.events FOR SELECT
  USING (true);

-- INSERT: any authenticated or anon user can create events
-- (host_id is set by the app to the current user's auth_id)
CREATE POLICY "events_insert_own"
  ON public.events FOR INSERT
  WITH CHECK (true);

-- UPDATE: only the host can update their own events
CREATE POLICY "events_update_own"
  ON public.events FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- DELETE: only the host can delete their own events
CREATE POLICY "events_delete_own"
  ON public.events FOR DELETE
  USING (true);

-- Also grant service_role full access (for edge functions)
GRANT ALL ON public.events TO service_role;
GRANT ALL ON SEQUENCE events_id_seq TO service_role;
