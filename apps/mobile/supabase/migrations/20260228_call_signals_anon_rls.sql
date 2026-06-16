-- Fix: call_signals RLS policies only allowed 'authenticated' role
-- Better Auth uses anon key (not Supabase Auth), so client is always 'anon'
-- Add matching policies for anon role

GRANT ALL ON TABLE public.call_signals TO anon;
GRANT USAGE, SELECT ON SEQUENCE call_signals_id_seq TO anon;

DO $$ BEGIN
  CREATE POLICY "Anon can insert call signals"
    ON public.call_signals FOR INSERT
    TO anon
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anon can read call signals"
    ON public.call_signals FOR SELECT
    TO anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anon can update call signals"
    ON public.call_signals FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anon can delete call signals"
    ON public.call_signals FOR DELETE
    TO anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
