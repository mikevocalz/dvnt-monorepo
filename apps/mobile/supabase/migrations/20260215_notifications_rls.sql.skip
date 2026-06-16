-- RLS policies for notifications table
-- Edge functions INSERT with service_role (bypasses RLS)
-- Client reads with anon key (needs SELECT policy)

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Grant table access to anon and authenticated roles
GRANT SELECT, UPDATE ON public.notifications TO anon;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;

-- Grant sequence usage for SERIAL id column
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE notifications_id_seq TO authenticated;

-- SELECT: users can only read their own notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (true);

-- UPDATE: users can update their own notifications (mark as read)
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- INSERT: only service_role (edge functions) can insert
-- No INSERT policy for anon/authenticated — edge functions use service_role which bypasses RLS

-- service_role gets full access
GRANT ALL ON public.notifications TO service_role;
GRANT ALL ON SEQUENCE notifications_id_seq TO service_role;

-- Also ensure push_tokens table is accessible
-- (used by edge functions for push notifications, may need client INSERT for token registration)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'push_tokens' AND table_schema = 'public') THEN
    ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;
    
    -- Allow users to read/write their own push tokens
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'push_tokens_select_all') THEN
      CREATE POLICY "push_tokens_select_all" ON public.push_tokens FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'push_tokens_insert_all') THEN
      CREATE POLICY "push_tokens_insert_all" ON public.push_tokens FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'push_tokens_update_all') THEN
      CREATE POLICY "push_tokens_update_all" ON public.push_tokens FOR UPDATE USING (true) WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'push_tokens' AND policyname = 'push_tokens_delete_all') THEN
      CREATE POLICY "push_tokens_delete_all" ON public.push_tokens FOR DELETE USING (true);
    END IF;
    
    EXECUTE 'GRANT ALL ON public.push_tokens TO anon';
    EXECUTE 'GRANT ALL ON public.push_tokens TO authenticated';
    EXECUTE 'GRANT ALL ON public.push_tokens TO service_role';
  END IF;
END $$;
