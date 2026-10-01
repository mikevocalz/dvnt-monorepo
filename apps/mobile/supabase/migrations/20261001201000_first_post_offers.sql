BEGIN;

CREATE TABLE IF NOT EXISTS public.first_post_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  campaign_version text NOT NULL DEFAULT 'first_ticket_v1',
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  cart_id uuid,
  state text NOT NULL DEFAULT 'offered'
    CHECK (state IN ('offered','accepted','dismissed','invalidated')),
  accepted_at timestamptz,
  dismissed_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_post_offers_user_campaign_key UNIQUE (user_id, campaign_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS first_post_offers_ticket_campaign_key
  ON public.first_post_offers (ticket_id, campaign_version);

ALTER TABLE public.first_post_offers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.first_post_offers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.first_post_offers TO service_role;

COMMIT;
