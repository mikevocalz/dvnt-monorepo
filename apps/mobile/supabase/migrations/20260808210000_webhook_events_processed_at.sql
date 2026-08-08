-- Completion marker for webhook dedup (I2 hardening). Both webhooks insert
-- their dedup row BEFORE processing; if processing then throws, the provider
-- retry hits the unique violation and is skipped — the transition is dropped
-- permanently. processed_at lets the handlers distinguish "already handled"
-- from "died mid-flight, reprocess". Additive only; NULL on existing rows is
-- correct (pre-marker events were either handled or already lost).

ALTER TABLE public.stripe_events
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- stripe_events predates this marker with processed_at DEFAULT now() — an
-- insert-time stamp, which would mark every event "processed" before the
-- handler ran and neuter the reprocess check. The handler now writes it
-- explicitly after processing; the default must go.
ALTER TABLE public.stripe_events ALTER COLUMN processed_at DROP DEFAULT;

ALTER TABLE public.rc_events
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- Existing rows predate the marker: treat them as processed so a very late
-- provider retry of an old event doesn't reprocess months-old state (the
-- monotonic guard would refuse it anyway — this just keeps logs quiet).
UPDATE public.stripe_events SET processed_at = now() WHERE processed_at IS NULL;
UPDATE public.rc_events SET processed_at = now() WHERE processed_at IS NULL;
