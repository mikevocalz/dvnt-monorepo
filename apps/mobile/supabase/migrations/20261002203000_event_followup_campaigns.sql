BEGIN;

CREATE TABLE IF NOT EXISTS public.event_followup_campaigns (
  event_id integer PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  subject text,
  message text NOT NULL DEFAULT '',
  cta_label text NOT NULL DEFAULT 'Leave a review',
  delay_minutes integer NOT NULL DEFAULT 600 CHECK (delay_minutes BETWEEN 0 AND 10080),
  campaign_version integer NOT NULL DEFAULT 1,
  scheduled_at timestamptz,
  status text NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('disabled','scheduled','processing','sent','partial_failure')),
  audience_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.event_followup_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_followup_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_followup_campaigns TO service_role;

CREATE TABLE IF NOT EXISTS public.event_followup_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id integer NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  campaign_version integer NOT NULL,
  recipient_email text NOT NULL,
  recipient_user_id text,
  ticket_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sending','sent','failed','suppressed')),
  provider_message_id text,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, campaign_version, recipient_email)
);
ALTER TABLE public.event_followup_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_followup_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_followup_outbox TO service_role;

CREATE INDEX IF NOT EXISTS event_followup_due_idx
  ON public.event_followup_campaigns(enabled, scheduled_at)
  WHERE enabled = true;

COMMIT;
