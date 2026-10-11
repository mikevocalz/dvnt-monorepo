-- Draft organizer configuration only. No changes to events, orders, holds or payouts.
BEGIN;
CREATE TABLE public.event_ticket_embed_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id integer NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  allowed_origin text NOT NULL CHECK (length(allowed_origin) BETWEEN 9 AND 255),
  -- Live activation requires a separately reviewed checkout implementation.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_ticket_embed_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_ticket_embed_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.event_ticket_embed_settings TO service_role;
COMMENT ON TABLE public.event_ticket_embed_settings IS
  'Organizer-only embed drafts. Server verifies event owner/accepted admin. Not a live sales authorization.';
COMMIT;
