BEGIN;

CREATE TABLE IF NOT EXISTS public.event_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_auth_id text NOT NULL,
  source_event_id integer REFERENCES public.events(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled event',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_drafts_owner_updated_idx
  ON public.event_drafts (owner_auth_id, updated_at DESC);

ALTER TABLE public.event_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_drafts TO service_role;

COMMIT;
