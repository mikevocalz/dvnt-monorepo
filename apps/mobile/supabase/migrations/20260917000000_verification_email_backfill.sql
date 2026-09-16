-- Backfill outbox for the verification email that never went out.
--
-- sendVerificationEmail sat inside emailAndPassword instead of the top-level
-- emailVerification block, so Better Auth ignored it and
-- /send-verification-email answered VERIFICATION_EMAIL_NOT_ENABLED for the life
-- of the product. 1113 of 1137 rows in public."user" have "emailVerified" IS
-- NOT TRUE because nobody was ever asked to verify.
--
-- Same shape as 20260916180000_brand_message_outbox.sql: one row per recipient
-- per campaign version, a stable idempotency key equal to the unique key, a
-- claim/complete pair so a crashed run resumes instead of re-mailing, and
-- service_role-only access. The state vocabulary is deliberately identical so
-- the edge function reuses _shared/brand-outbox.ts transition() rather than
-- growing a second state machine.
--
-- This outbox is keyed on public."user".id (Better Auth, text). public.users is
-- the app profile table with an integer id and 18 rows of unused auth.users
-- behind it — neither is the account list that needs mail.
--
-- ponytail: no send-window / timezone column. The ceiling is that one operator
-- runs this by hand over a few days; a scheduled drip would need a cron entry
-- and a per-recipient local hour, and neither exists yet.
BEGIN;

CREATE TABLE IF NOT EXISTS public.verification_email_backfill (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_version text NOT NULL,
  -- public."user".id. No FK: Better Auth owns that table and creates it
  -- outside this migration history, so a reference would break a fresh db.
  auth_user_id text NOT NULL,
  email text NOT NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  -- Identical to the unique key, so a duplicate enqueue and a duplicate send
  -- collide the same way.
  provider_idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_email_backfill_campaign_user_key
    UNIQUE (campaign_version, auth_user_id)
);

CREATE INDEX IF NOT EXISTS verification_email_backfill_queued_idx
  ON public.verification_email_backfill (id) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS verification_email_backfill_recent_idx
  ON public.verification_email_backfill (auth_user_id, sent_at)
  WHERE state = 'sent';

-- Service role only: RLS on with no policies and no client grant, so neither
-- anon nor authenticated can read the address list or queue a send.
ALTER TABLE public.verification_email_backfill ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_email_backfill FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.verification_email_backfill TO service_role;

-- ── Enqueue ────────────────────────────────────────────────────────────
-- Safe to call as often as you like, and cheap: it writes rows, it does not
-- send. Anyone who verifies before their row is claimed is caught by
-- verification_backfill_skip_reason at claim time.
CREATE OR REPLACE FUNCTION public.enqueue_verification_backfill(
  p_campaign_version text DEFAULT 'verify_backfill_v1'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.verification_email_backfill
    (campaign_version, auth_user_id, email, provider_idempotency_key)
  SELECT p_campaign_version, u.id, lower(btrim(u.email)),
         p_campaign_version || ':' || u.id
  FROM public."user" u
  WHERE u."emailVerified" IS NOT TRUE
    AND u.email IS NOT NULL
    AND btrim(u.email) <> ''
  ON CONFLICT ON CONSTRAINT verification_email_backfill_campaign_user_key
  DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Skip rules ─────────────────────────────────────────────────────────
-- One definition, used by both the dry run and the real claim, so the preview
-- cannot drift from what actually gets mailed. The recency check spans every
-- campaign version: a v2 run will not mail somebody who got v1 yesterday.
CREATE OR REPLACE FUNCTION public.verification_backfill_skip_reason(
  p_auth_user_id text,
  p_cooldown interval DEFAULT interval '3 days'
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public."user" u WHERE u.id = p_auth_user_id
    ) THEN 'account_missing'
    WHEN EXISTS (
      SELECT 1 FROM public."user" u
       WHERE u.id = p_auth_user_id AND u."emailVerified" IS TRUE
    ) THEN 'already_verified'
    WHEN EXISTS (
      SELECT 1 FROM public.verification_email_backfill s
       WHERE s.auth_user_id = p_auth_user_id AND s.state = 'sent'
         AND s.sent_at >= now() - p_cooldown
    ) THEN 'mailed_recently'
  END;
$$;

COMMIT;
