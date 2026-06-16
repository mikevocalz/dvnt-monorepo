-- event_moments: ephemeral per-event photo/video posts ("Who All Over There")
-- Expires 24h after the event ends. Visible to all authenticated viewers.
-- Write access enforced by Edge Function (ticket holder OR host).

CREATE TABLE IF NOT EXISTS public.event_moments (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_url     TEXT NOT NULL,
  media_type    TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  duration_sec  FLOAT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  is_flagged    BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_event_moments_event   ON public.event_moments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_moments_expires ON public.event_moments(expires_at);
CREATE INDEX IF NOT EXISTS idx_event_moments_user    ON public.event_moments(user_id);

-- RLS: authenticated users can read non-expired, non-flagged moments
ALTER TABLE public.event_moments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_moments_select ON public.event_moments;
CREATE POLICY event_moments_select ON public.event_moments
  FOR SELECT TO authenticated, anon USING (expires_at > NOW() AND is_flagged = FALSE);

DROP POLICY IF EXISTS event_moments_delete_own ON public.event_moments;
CREATE POLICY event_moments_delete_own ON public.event_moments
  FOR DELETE TO authenticated USING (true);

-- Service role (Edge Functions) has full access
GRANT ALL ON public.event_moments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.event_moments_id_seq TO service_role;
GRANT SELECT, DELETE ON public.event_moments TO authenticated;
GRANT SELECT ON public.event_moments TO anon;

NOTIFY pgrst, 'reload schema';
