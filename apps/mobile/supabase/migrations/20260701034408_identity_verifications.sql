-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260701034408 :: identity_verifications). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- D6: identity_verifications — provider-neutral table for gov-ID + selfie +
-- liveness + age verification (C3).

CREATE TABLE IF NOT EXISTS identity_verifications (
  user_id text PRIMARY KEY,
  provider text NOT NULL DEFAULT 'persona'
    CHECK (provider IN ('persona','veriff','onfido','yoti')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','passed','failed','expired','review')),
  provider_ref text,
  doc_country text,
  date_of_birth date,
  failure_code text,
  failure_message text,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_verifications_provider_ref
  ON identity_verifications(provider_ref);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_status
  ON identity_verifications(status);

CREATE OR REPLACE FUNCTION public.is_verified(uid text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_jwt_sub text := current_setting('request.jwt.claims', true)::json ->> 'sub';
  v_role    text := current_setting('request.jwt.claims', true)::json ->> 'role';
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' AND uid <> v_jwt_sub THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM identity_verifications
    WHERE user_id = uid
      AND status = 'passed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_verified(text) FROM public;
GRANT EXECUTE ON FUNCTION public.is_verified(text) TO authenticated, service_role;

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

-- ── RLS for identity_verifications ──────────────────────────────
-- Mirror the pattern already used on membership_subscriptions: users
-- read only their own row. Writes go via the service-role-only RPC.
ALTER TABLE identity_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identity_verifications_own ON identity_verifications;
CREATE POLICY identity_verifications_own
  ON identity_verifications
  FOR SELECT
  TO authenticated
  USING (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

ALTER TABLE verification_events ENABLE ROW LEVEL SECURITY;
-- verification_events is service-role only; no policy = no client access.

ALTER TABLE rc_events ENABLE ROW LEVEL SECURITY;
-- rc_events is service-role only; no policy = no client access.;
