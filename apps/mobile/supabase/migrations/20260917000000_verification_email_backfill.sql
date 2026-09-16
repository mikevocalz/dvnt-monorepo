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

-- ── Claim ──────────────────────────────────────────────────────────────
-- p_dry_run defaults TRUE and writes nothing: it returns the rows the same
-- p_limit would claim, after the same skip rules. A real run persists the
-- skips first so a suppressed row never burns an attempt, then claims what is
-- left with FOR UPDATE SKIP LOCKED so two runs cannot mail the same person.
CREATE OR REPLACE FUNCTION public.claim_verification_backfill(
  p_campaign_version text DEFAULT 'verify_backfill_v1',
  p_limit integer DEFAULT 25,
  p_cooldown interval DEFAULT interval '3 days',
  p_dry_run boolean DEFAULT true
) RETURNS SETOF public.verification_email_backfill
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_dry_run THEN
    RETURN QUERY
      SELECT q.* FROM public.verification_email_backfill q
       WHERE q.campaign_version = p_campaign_version
         AND q.state = 'queued'
         AND public.verification_backfill_skip_reason(q.auth_user_id, p_cooldown) IS NULL
       ORDER BY q.id
       LIMIT GREATEST(p_limit, 0);
    RETURN;
  END IF;

  UPDATE public.verification_email_backfill o
     SET state = 'suppressed', last_error = stop.reason, updated_at = now()
  FROM (
    SELECT q.id,
           public.verification_backfill_skip_reason(q.auth_user_id, p_cooldown) AS reason
      FROM public.verification_email_backfill q
     WHERE q.campaign_version = p_campaign_version AND q.state = 'queued'
  ) stop
  WHERE o.id = stop.id AND stop.reason IS NOT NULL;

  RETURN QUERY
  UPDATE public.verification_email_backfill o
     SET state = 'sending',
         attempt_count = o.attempt_count + 1,
         claimed_at = now(),
         updated_at = now()
   WHERE o.id IN (
     SELECT c.id FROM public.verification_email_backfill c
      WHERE c.campaign_version = p_campaign_version AND c.state = 'queued'
      ORDER BY c.id
      LIMIT GREATEST(p_limit, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$$;

-- ── Complete ───────────────────────────────────────────────────────────
-- Only a claimed row moves, so a slow run that finishes after a second one
-- started cannot reopen a sent row or clear its sent_at.
CREATE OR REPLACE FUNCTION public.complete_verification_backfill(
  p_id bigint,
  p_state text,
  p_error text DEFAULT NULL
) RETURNS public.verification_email_backfill
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.verification_email_backfill;
BEGIN
  IF p_state NOT IN ('queued', 'sent', 'failed', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid backfill completion state: %', p_state;
  END IF;
  UPDATE public.verification_email_backfill
     SET state = p_state,
         last_error = p_error,
         sent_at = CASE WHEN p_state = 'sent' THEN now() ELSE sent_at END,
         updated_at = now()
   WHERE id = p_id AND state = 'sending'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Verification backfill row % is not claimed', p_id;
  END IF;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_verification_backfill(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verification_backfill_skip_reason(text, interval)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_verification_backfill(text, integer, interval, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_verification_backfill(bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_verification_backfill(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.verification_backfill_skip_reason(text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_verification_backfill(text, integer, interval, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_verification_backfill(bigint, text, text) TO service_role;

COMMIT;
