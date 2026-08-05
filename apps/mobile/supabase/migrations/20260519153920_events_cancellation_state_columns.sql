-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519153920 :: events_cancellation_state_columns). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Add first-class lifecycle state to events so cancellation is not just
-- a row delete (which orphans tickets + Stripe charges with no refund
-- path). See cancel-event edge function for the cascade refund flow.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE public.events
  ADD CONSTRAINT events_status_check
  CHECK (status IN ('draft','active','cancelled','postponed','suspended'));

CREATE INDEX IF NOT EXISTS events_status_idx ON public.events (status)
  WHERE status <> 'active';

COMMENT ON COLUMN public.events.status IS
  'Lifecycle state. ''active'' is default; ''cancelled'' is the terminal '
  'state set by the cancel-event edge function (NEVER hard-delete an event '
  'that has tickets). See audit/12_FINDINGS_REGISTER_V2.md V2-EVT-01.';
COMMENT ON COLUMN public.events.cancelled_at IS
  'Timestamp the host cancelled the event. Used to drive material-change '
  'refund windows + UI banner.';
COMMENT ON COLUMN public.events.cancel_reason IS
  'Optional host-provided reason. Surfaced to attendees in the cancellation '
  'notification + email.';;
