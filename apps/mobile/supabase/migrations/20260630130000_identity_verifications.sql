-- D6: identity_verifications — provider-neutral table for gov-ID + selfie +
-- liveness + age verification (C3). One active row per user. Webhook updates
-- the row in place on terminal events; the v0 hosted-flow path is Persona
-- but the schema doesn't bind to it (the `provider` column carries the rail).
--
-- Failure mode defended against:
--   - I3 / single read path: the app reads verification status from this
--     table (never from the provider SDK on the client). `is_verified()`
--     is the resolver.
--   - I5: webhook handler guards the row write with `last_event_at`
--     parallel to the subscriptions monotonic guard.
--   - I1: provider's reference id (Persona inquiry id, etc.) maps to a
--     DVNT user_id via the row that EXISTS BEFORE the webhook lands —
--     created at "start verification" time, not when the webhook fires.

CREATE TABLE IF NOT EXISTS identity_verifications (
  user_id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'persona'
    CHECK (provider IN ('persona','veriff','onfido','yoti')),
  -- 'pending' = created, user hasn't completed. 'submitted' = user finished
  -- the flow, awaiting provider decision. 'passed' / 'failed' / 'expired'
  -- are terminal. 'review' = provider flagged for human review.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','passed','failed','expired','review')),
  -- Provider's reference (e.g. Persona inquiry id `inq_*`). NOT unique here
  -- because a user may retry; the row carries the latest attempt.
  provider_ref text,
  -- ISO country code for the doc presented; null until provider reports.
  doc_country text,
  -- DOB extracted from the ID, used for age gating. Stored as date, no time.
  date_of_birth date,
  failure_code text,
  failure_message text,
  -- Monotonic guard pivot, same pattern as membership_subscriptions.
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_verifications_provider_ref
  ON identity_verifications(provider_ref);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_status
  ON identity_verifications(status);

-- ── Single read path for the app (I3) ────────────────────────────────
-- Returns TRUE iff user is currently verified for the Lynk surface.
-- "Currently" = passed && not expired (provider may set expirations).
CREATE OR REPLACE FUNCTION public.is_verified(uid text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM identity_verifications
    WHERE user_id = uid
      AND status = 'passed'
  );
$$;

REVOKE ALL ON FUNCTION public.is_verified(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_verified(text) TO authenticated, service_role;

-- ── Monotonic upsert helper used by the verification webhook (I5) ────
CREATE OR REPLACE FUNCTION public.upsert_identity_verification(
  p_user_id        text,
  p_provider       text,
  p_provider_ref   text,
  p_status         text,
  p_doc_country    text,
  p_date_of_birth  date,
  p_failure_code   text,
  p_failure_message text,
  p_event_created_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_applied boolean;
BEGIN
  INSERT INTO identity_verifications (
    user_id, provider, provider_ref, status,
    doc_country, date_of_birth, failure_code, failure_message,
    last_event_at, updated_at
  )
  VALUES (
    p_user_id, p_provider, p_provider_ref, p_status,
    p_doc_country, p_date_of_birth, p_failure_code, p_failure_message,
    p_event_created_at, now()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    provider        = EXCLUDED.provider,
    provider_ref    = EXCLUDED.provider_ref,
    status          = EXCLUDED.status,
    doc_country     = COALESCE(EXCLUDED.doc_country, identity_verifications.doc_country),
    date_of_birth   = COALESCE(EXCLUDED.date_of_birth, identity_verifications.date_of_birth),
    failure_code    = EXCLUDED.failure_code,
    failure_message = EXCLUDED.failure_message,
    last_event_at   = EXCLUDED.last_event_at,
    updated_at      = EXCLUDED.updated_at
  WHERE identity_verifications.last_event_at IS NULL
     OR identity_verifications.last_event_at < EXCLUDED.last_event_at;

  GET DIAGNOSTICS v_applied = ROW_COUNT;
  RETURN v_applied;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_identity_verification(
  text, text, text, text, text, date, text, text, timestamptz
) FROM public;
GRANT EXECUTE ON FUNCTION public.upsert_identity_verification(
  text, text, text, text, text, date, text, text, timestamptz
) TO service_role;

-- ── Provider webhook dedup (parallel to stripe_events / rc_events) ───
CREATE TABLE IF NOT EXISTS verification_events (
  event_id text PRIMARY KEY,
  provider text NOT NULL,
  user_id text,
  provider_ref text,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_verification_events_user
  ON verification_events(user_id);
