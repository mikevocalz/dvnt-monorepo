-- Outbox for growth messages sent by the canonical Deviant brand account.
-- Deploy before the brand-outbox-worker edge function. Rows can exist long
-- before anything is allowed to send: the worker refuses to run until
-- DVNT_BRAND_USER_ID, DVNT_BRAND_AUTH_ID and DVNT_BRAND_OUTBOX_ENABLED are all
-- set (apps/mobile/supabase/functions/_shared/brand-sender.ts).
--
-- Ticket delivery does not pass through here. Ticket email is transactional,
-- keeps its own path (_shared/send-resend-email.ts), and an opt-out row in
-- brand_message_opt_outs stops growth messages only.
--
-- SMS is deliberately missing from the channel check. A text channel needs its
-- own per-topic consent record, STOP/HELP handling and carrier delivery
-- receipts; none of that exists in this schema, so the constraint refuses the
-- value instead of letting a caller invent it.
BEGIN;

CREATE TABLE IF NOT EXISTS public.brand_message_opt_outs (
  recipient_id integer PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.brand_message_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign text NOT NULL,
  campaign_version text NOT NULL,
  recipient_id integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('dm', 'email')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  -- Stable across every retry of the same row, and identical to the unique key
  -- so a duplicate enqueue and a duplicate provider call fail the same way.
  provider_idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  provider_message_id text,
  receipt jsonb,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_message_outbox_campaign_recipient_channel_key
    UNIQUE (campaign_version, recipient_id, channel)
);

CREATE INDEX IF NOT EXISTS brand_message_outbox_queued_idx
  ON public.brand_message_outbox (id) WHERE state = 'queued';
CREATE INDEX IF NOT EXISTS brand_message_outbox_cap_idx
  ON public.brand_message_outbox (recipient_id, sent_at) WHERE state = 'sent';

-- Service role only. RLS is on with no policies, and the client roles keep no
-- grant, so neither anon nor authenticated can read or write a queued message.
ALTER TABLE public.brand_message_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_message_opt_outs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_message_outbox FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.brand_message_opt_outs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.brand_message_outbox TO service_role;
GRANT ALL ON public.brand_message_opt_outs TO service_role;

-- ── Enqueue ────────────────────────────────────────────────────────────
-- Safe to call as often as you like. With p_auth_id it targets one new
-- account (the auth user.create.after hook); without it, it sweeps accounts
-- created inside p_lookback so a missed hook still reaches its member.
CREATE OR REPLACE FUNCTION public.enqueue_brand_welcome(
  p_auth_id text DEFAULT NULL,
  p_lookback interval DEFAULT interval '7 days'
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.brand_message_outbox
    (campaign, campaign_version, recipient_id, channel, provider_idempotency_key)
  SELECT 'welcome', 'welcome_dm_v1', u.id, 'dm',
         'welcome_dm_v1:' || u.id::text || ':dm'
  FROM public.users u
  WHERE (p_auth_id IS NOT NULL AND u.auth_id = p_auth_id)
     OR (p_auth_id IS NULL AND u.created_at >= now() - p_lookback)
  ON CONFLICT ON CONSTRAINT brand_message_outbox_campaign_recipient_channel_key
  DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── Claim ──────────────────────────────────────────────────────────────
-- Suppression runs before the claim so a stopped campaign never burns an
-- attempt, then the survivors are claimed atomically with SKIP LOCKED.
CREATE OR REPLACE FUNCTION public.claim_brand_messages(
  p_sender_id integer,
  p_limit integer DEFAULT 20,
  p_cap integer DEFAULT 2,
  p_window interval DEFAULT interval '7 days'
) RETURNS SETOF public.brand_message_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_sender_id IS NULL OR p_sender_id <= 0 THEN
    RAISE EXCEPTION 'A brand sender id is required to claim outbox rows';
  END IF;

  UPDATE public.brand_message_outbox o
     SET state = 'suppressed', last_error = stop.reason, updated_at = now()
  FROM (
    SELECT q.id,
      CASE
        WHEN EXISTS (SELECT 1 FROM public.brand_message_opt_outs x
                      WHERE x.recipient_id = q.recipient_id) THEN 'opted_out'
        WHEN EXISTS (SELECT 1 FROM public.blocks b
                      WHERE (b.blocker_id = q.recipient_id AND b.blocked_id = p_sender_id)
                         OR (b.blocker_id = p_sender_id AND b.blocked_id = q.recipient_id)) THEN 'blocked'
        WHEN q.campaign = 'first_post_reminder'
             AND EXISTS (SELECT 1 FROM public.posts p WHERE p.author_id = q.recipient_id) THEN 'already_posted'
        WHEN (SELECT count(*) FROM public.brand_message_outbox c
               WHERE c.recipient_id = q.recipient_id AND c.state = 'sent'
                 AND c.sent_at >= now() - p_window) >= p_cap THEN 'frequency_cap'
      END AS reason
    FROM public.brand_message_outbox q
    WHERE q.state = 'queued'
  ) stop
  WHERE o.id = stop.id AND stop.reason IS NOT NULL;

  RETURN QUERY
  UPDATE public.brand_message_outbox o
     SET state = 'sending',
         attempt_count = o.attempt_count + 1,
         claimed_at = now(),
         updated_at = now()
   WHERE o.id IN (
     SELECT c.id FROM public.brand_message_outbox c
      WHERE c.state = 'queued'
      ORDER BY c.id
      LIMIT GREATEST(p_limit, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$$;

-- ── Complete ───────────────────────────────────────────────────────────
-- Only a claimed row can be completed, so a late second worker cannot
-- overwrite a receipt or resurrect a finished campaign row.
CREATE OR REPLACE FUNCTION public.complete_brand_message(
  p_id bigint,
  p_state text,
  p_provider_message_id text DEFAULT NULL,
  p_receipt jsonb DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS public.brand_message_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.brand_message_outbox;
BEGIN
  IF p_state NOT IN ('queued', 'sent', 'failed', 'suppressed') THEN
    RAISE EXCEPTION 'Invalid outbox completion state: %', p_state;
  END IF;
  UPDATE public.brand_message_outbox
     SET state = p_state,
         provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
         receipt = COALESCE(p_receipt, receipt),
         last_error = p_error,
         sent_at = CASE WHEN p_state = 'sent' THEN now() ELSE sent_at END,
         updated_at = now()
   WHERE id = p_id AND state = 'sending'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Outbox row % is not claimed', p_id;
  END IF;
  RETURN v_row;
END;
$$;

-- ── Opt out ────────────────────────────────────────────────────────────
-- Growth only. It never touches ticket email, order receipts or any other
-- transactional delivery, because none of those go through this outbox.
CREATE OR REPLACE FUNCTION public.set_brand_message_opt_out(
  p_recipient_id integer,
  p_opted_out boolean,
  p_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_opted_out THEN
    INSERT INTO public.brand_message_opt_outs (recipient_id, reason)
    VALUES (p_recipient_id, p_reason)
    ON CONFLICT (recipient_id) DO UPDATE SET reason = EXCLUDED.reason;
    UPDATE public.brand_message_outbox
       SET state = 'suppressed', last_error = 'opted_out', updated_at = now()
     WHERE recipient_id = p_recipient_id AND state = 'queued';
  ELSE
    DELETE FROM public.brand_message_opt_outs WHERE recipient_id = p_recipient_id;
  END IF;
  RETURN p_opted_out;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_brand_welcome(text, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_brand_messages(integer, integer, integer, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_brand_message(bigint, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_brand_message_opt_out(integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_brand_welcome(text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_brand_messages(integer, integer, integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_brand_message(bigint, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_brand_message_opt_out(integer, boolean, text) TO service_role;

COMMIT;
