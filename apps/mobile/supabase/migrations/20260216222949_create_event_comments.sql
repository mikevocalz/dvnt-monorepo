-- Create event_comments table
CREATE TABLE IF NOT EXISTS public.event_comments (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  parent_id INTEGER REFERENCES public.event_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_comments_event_id ON public.event_comments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_comments_author_id ON public.event_comments(author_id);

-- Permissions
GRANT ALL ON public.event_comments TO service_role;
GRANT ALL ON SEQUENCE public.event_comments_id_seq TO service_role;

-- RLS
ALTER TABLE public.event_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.event_comments FOR ALL TO service_role USING (true) WITH CHECK (true);
