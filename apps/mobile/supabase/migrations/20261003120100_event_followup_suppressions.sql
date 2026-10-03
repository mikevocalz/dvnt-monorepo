-- Unsubscribe list for organizer post-event follow-up email.
--
-- Keyed by lowercased address, not by users.id, because follow-ups also reach
-- guest checkouts that have no account. brand_message_opt_outs (members only)
-- is honoured as well; the worker checks both before every send.
--
-- Rows are written only by the event-followup-unsubscribe edge function after
-- it verifies an HMAC-signed token, and read only by process-event-followups.
BEGIN;

CREATE TABLE IF NOT EXISTS public.event_followup_email_suppressions (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
  source text NOT NULL DEFAULT 'unsubscribe_link',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.event_followup_email_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_followup_email_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_followup_email_suppressions TO service_role;

-- Lets the worker find who already got a follow-up for an event across all
-- campaign versions without scanning every version's rows.
CREATE INDEX IF NOT EXISTS event_followup_outbox_event_status_idx
  ON public.event_followup_outbox (event_id, status);

COMMIT;
