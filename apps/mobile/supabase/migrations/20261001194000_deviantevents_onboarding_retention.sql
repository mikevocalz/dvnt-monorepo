-- DVNT onboarding + retention automation.
-- Builds on 20260916180000_brand_message_outbox.sql.
BEGIN;

ALTER TABLE public.brand_message_outbox
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS brand_message_outbox_available_idx
  ON public.brand_message_outbox (available_at, id)
  WHERE state = 'queued';

-- Idempotent follow graph write. Direct DB insert is deliberate: the automatic
-- onboarding relationship must not fan out "new follower" push notifications.
CREATE OR REPLACE FUNCTION public.ensure_brand_follow_relationships(
  p_member_id integer,
  p_brand_id integer,
  p_bidirectional boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member_to_brand integer := 0;
  v_brand_to_member integer := 0;
BEGIN
  IF p_member_id IS NULL OR p_brand_id IS NULL OR p_member_id <= 0 OR p_brand_id <= 0 THEN
    RAISE EXCEPTION 'valid member and brand ids are required';
  END IF;
  IF p_member_id = p_brand_id THEN
    RETURN jsonb_build_object('memberToBrand', 0, 'brandToMember', 0, 'self', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_member_id)
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'member or brand profile missing';
  END IF;

  INSERT INTO public.follows (follower_id, following_id)
  VALUES (p_member_id, p_brand_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  GET DIAGNOSTICS v_member_to_brand = ROW_COUNT;

  IF p_bidirectional THEN
    INSERT INTO public.follows (follower_id, following_id)
    VALUES (p_brand_id, p_member_id)
    ON CONFLICT (follower_id, following_id) DO NOTHING;
    GET DIAGNOSTICS v_brand_to_member = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'memberToBrand', v_member_to_brand,
    'brandToMember', v_brand_to_member,
    'self', false
  );
END;
$$;

-- Exactly-once campaign rows for a fully provisioned member.
CREATE OR REPLACE FUNCTION public.enqueue_brand_onboarding(
  p_auth_id text DEFAULT NULL,
  p_lookback interval DEFAULT interval '7 days',
  p_first_post_delay interval DEFAULT interval '24 hours'
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- auth-sync calls this on every sign-in, not only at signup, so the
  -- lookback bounds the single-member path too. Without it every legacy
  -- member who signs in gets a "welcome" DM, email and first-post reminder.
  WITH recipients AS (
    SELECT u.id
    FROM public.users u
    WHERE u.created_at >= now() - p_lookback
      AND (p_auth_id IS NULL OR u.auth_id = p_auth_id)
  ), rows_to_insert AS (
    SELECT 'welcome'::text AS campaign, 'welcome_dm_v2'::text AS campaign_version,
           r.id AS recipient_id, 'dm'::text AS channel, now() AS available_at
      FROM recipients r
    UNION ALL
    SELECT 'welcome', 'welcome_email_v2', r.id, 'email', now()
      FROM recipients r
    UNION ALL
    SELECT 'first_post_reminder', 'first_post_v1', r.id, 'dm',
           now() + GREATEST(p_first_post_delay, interval '0 seconds')
      FROM recipients r
  )
  INSERT INTO public.brand_message_outbox
    (campaign, campaign_version, recipient_id, channel, provider_idempotency_key, available_at)
  SELECT campaign, campaign_version, recipient_id, channel,
         campaign_version || ':' || recipient_id::text || ':' || channel,
         available_at
  FROM rows_to_insert
  ON CONFLICT ON CONSTRAINT brand_message_outbox_campaign_recipient_channel_key
  DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Progressive legacy backfill. Each call selects only profiles still missing at
-- least one required relationship, so repeated worker runs advance naturally.
CREATE OR REPLACE FUNCTION public.backfill_brand_relationships(
  p_brand_id integer,
  p_bidirectional boolean DEFAULT true,
  p_limit integer DEFAULT 250
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_processed integer := 0;
  v_member_to_brand integer := 0;
  v_brand_to_member integer := 0;
  v_result jsonb;
BEGIN
  IF p_brand_id IS NULL OR p_brand_id <= 0
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'valid brand profile required';
  END IF;

  FOR v_row IN
    SELECT u.id
    FROM public.users u
    WHERE u.id <> p_brand_id
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = u.id AND f.following_id = p_brand_id
        )
        OR (
          p_bidirectional AND NOT EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.follower_id = p_brand_id AND f.following_id = u.id
          )
        )
      )
    ORDER BY u.id
    LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  LOOP
    v_result := public.ensure_brand_follow_relationships(v_row.id, p_brand_id, p_bidirectional);
    v_processed := v_processed + 1;
    v_member_to_brand := v_member_to_brand + COALESCE((v_result->>'memberToBrand')::integer, 0);
    v_brand_to_member := v_brand_to_member + COALESCE((v_result->>'brandToMember')::integer, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'processed', v_processed,
    'memberToBrandInserted', v_member_to_brand,
    'brandToMemberInserted', v_brand_to_member
  );
END;
$$;

-- Preserve existing suppression/cap behavior, but do not claim delayed rows early.
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
    WHERE q.state = 'queued' AND q.available_at <= now()
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
        AND c.available_at <= now()
      ORDER BY c.available_at, c.id
      LIMIT GREATEST(p_limit, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING o.*;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_brand_follow_relationships(integer, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_brand_onboarding(text, interval, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_brand_relationships(integer, boolean, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_brand_follow_relationships(integer, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_brand_onboarding(text, interval, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_brand_relationships(integer, boolean, integer) TO service_role;

-- Schedule the existing worker. It remains fail-closed until the brand sender,
-- unsubscribe URL, CRON_SECRET and DVNT_BRAND_OUTBOX_ENABLED are configured.
CREATE OR REPLACE FUNCTION public.cron_brand_outbox_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_SECRET'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE WARNING 'cron_brand_outbox_sweep: CRON_SECRET not in Vault — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/brand-outbox-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{"follow_backfill_limit":250}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_brand_outbox_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_brand_outbox_sweep() TO service_role;

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    BEGIN
      EXECUTE $$select cron.unschedule('brand-outbox-every-10min')$$;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    EXECUTE $$select cron.schedule(
      'brand-outbox-every-10min',
      '*/10 * * * *',
      'select public.cron_brand_outbox_sweep();'
    )$$;
  END IF;
END $cron$;

COMMIT;
