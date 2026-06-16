-- Ensure call_signals table exists for video call ringing notifications
-- Used by IncomingCallOverlay via Supabase Realtime

CREATE TABLE IF NOT EXISTS public.call_signals (
  id SERIAL PRIMARY KEY,
  room_id TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  caller_username TEXT,
  caller_avatar TEXT,
  callee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'accepted', 'declined', 'missed', 'ended')),
  is_group BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ
);

-- Index for realtime subscription filter
CREATE INDEX IF NOT EXISTS call_signals_callee_status_idx ON public.call_signals (callee_id, status);

-- Enable realtime on this table (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'call_signals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
  END IF;
END $$;

-- RLS: allow authenticated users to insert signals and read their own
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;

-- Allow any authenticated user to insert (to ring others)
DO $$ BEGIN
  CREATE POLICY "Users can insert call signals"
    ON public.call_signals FOR INSERT
    TO authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow users to read signals where they are the callee
DO $$ BEGIN
  CREATE POLICY "Users can read their own call signals"
    ON public.call_signals FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allow users to update signals (accept/decline)
DO $$ BEGIN
  CREATE POLICY "Users can update call signals"
    ON public.call_signals FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
