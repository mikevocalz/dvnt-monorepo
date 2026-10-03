-- DVNT onboarding + retention automation.
-- Builds on 20260916180000_brand_message_outbox.sql.
BEGIN;

ALTER TABLE public.brand_message_outbox
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS brand_message_outbox_available_idx
  ON public.brand_message_outbox (available_at, id)
  WHERE state = 'queued';

-- Who may be put into a follow relationship with @DeviantEvents. Checked on
-- every automatic write, single-member and batch alike:
--   - never the brand account itself;
--   - not banned in the app profile (users.banned_at);
--   - the Better Auth account still exists (a deleted login leaves its
--     public.users row behind with a dangling auth_id) and is not banned;
--   - not suspended, banned or shadow-banned in the moderation console
--     (payload.members.app_user_id holds public.users.id as text).
-- Following the brand confers nothing else: no column or role changes here.
CREATE OR REPLACE FUNCTION public.brand_follow_eligible(
  p_member_id integer,
  p_brand_id integer
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public."user" a ON a.id = u.auth_id
    WHERE u.id = p_member_id
      AND u.id <> p_brand_id
      AND u.banned_at IS NULL
      AND a.banned IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM payload.members m
        WHERE m.app_user_id = u.id::text
          AND m.status IN ('suspended', 'banned', 'shadow_banned')
      )
  );
$$;

-- Idempotent follow graph write. Direct DB insert is deliberate: the automatic
-- onboarding relationship must not fan out "new follower" push notifications.
-- auth-sync calls this on every sign-in. The member follows the brand whatever
-- their signup date, so a returning member who is still missing the follow
-- gets it. The brand follows back only members created inside p_lookback: old
-- members are never followed by the brand, one sign-in at a time or otherwise.
CREATE OR REPLACE FUNCTION public.ensure_brand_follow_relationships(
  p_member_id integer,
  p_brand_id integer,
  p_bidirectional boolean DEFAULT true,
  p_lookback interval DEFAULT interval '7 days'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member_to_brand integer := 0;
  v_brand_to_member integer := 0;
  v_member_created timestamptz;
BEGIN
  IF p_member_id IS NULL OR p_brand_id IS NULL OR p_member_id <= 0 OR p_brand_id <= 0 THEN
    RAISE EXCEPTION 'valid member and brand ids are required';
  END IF;
  IF p_lookback IS NULL THEN
    RAISE EXCEPTION 'a signup lookback window is required';
  END IF;
  IF p_member_id = p_brand_id THEN
    RETURN jsonb_build_object('memberToBrand', 0, 'brandToMember', 0, 'self', true);
  END IF;
  SELECT u.created_at INTO v_member_created FROM public.users u WHERE u.id = p_member_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'member or brand profile missing';
  END IF;
  IF NOT public.brand_follow_eligible(p_member_id, p_brand_id) THEN
    RETURN jsonb_build_object('memberToBrand', 0, 'brandToMember', 0, 'self', false, 'ineligible', true);
  END IF;

  INSERT INTO public.follows (follower_id, following_id)
  VALUES (p_member_id, p_brand_id)
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  GET DIAGNOSTICS v_member_to_brand = ROW_COUNT;

  -- A NULL created_at is treated as old: fail closed, no follow-back.
  IF p_bidirectional
     AND v_member_created IS NOT NULL
     AND v_member_created >= now() - p_lookback THEN
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

-- Batched catch-up, run by brand-outbox-worker on every cron tick.
--   1. Backfill: up to p_limit eligible members of any age who do not follow
--      @DeviantEvents start following it. This is the only retroactive
--      direction. The brand does NOT follow existing members back.
--   2. New profiles: the brand follows eligible members created inside
--      p_new_profile_window that it does not follow yet. This reaches profiles
--      created by any path that skips auth-sync (resolveOrProvisionUser, the
--      backfill-users function), at most one cron tick late.
-- Both inserts use ON CONFLICT on follower_following_idx, so a row that already
-- exists, or one a concurrent sign-in wrote first, is skipped and fires no
-- trigger; trigger_sync_follow_counts recounts from the table on each real
-- insert, so the counts cannot double. Once nothing is missing both inserts
-- touch no rows and 'remaining' reports 0.
CREATE OR REPLACE FUNCTION public.backfill_brand_follows(
  p_brand_id integer,
  p_limit integer DEFAULT 250,
  p_new_profile_window interval DEFAULT interval '7 days'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 250), 1), 1000);
  v_member_to_brand integer := 0;
  v_brand_to_member integer := 0;
  v_remaining integer := 0;
BEGIN
  IF p_brand_id IS NULL OR p_brand_id <= 0
     OR NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_brand_id) THEN
    RAISE EXCEPTION 'valid brand profile required';
  END IF;
  IF p_new_profile_window IS NULL THEN
    RAISE EXCEPTION 'a new-profile window is required';
  END IF;

  INSERT INTO public.follows (follower_id, following_id)
  SELECT u.id, p_brand_id
  FROM public.users u
  WHERE u.id <> p_brand_id
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = u.id AND f.following_id = p_brand_id
    )
    AND public.brand_follow_eligible(u.id, p_brand_id)
  ORDER BY u.id
  LIMIT v_limit
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  GET DIAGNOSTICS v_member_to_brand = ROW_COUNT;

  INSERT INTO public.follows (follower_id, following_id)
  SELECT p_brand_id, u.id
  FROM public.users u
  WHERE u.id <> p_brand_id
    AND u.created_at >= now() - p_new_profile_window
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = p_brand_id AND f.following_id = u.id
    )
    AND public.brand_follow_eligible(u.id, p_brand_id)
  ORDER BY u.id
  LIMIT v_limit
  ON CONFLICT (follower_id, following_id) DO NOTHING;
  GET DIAGNOSTICS v_brand_to_member = ROW_COUNT;

  SELECT count(*) INTO v_remaining
  FROM public.users u
  WHERE u.id <> p_brand_id
    AND NOT EXISTS (
      SELECT 1 FROM public.follows f
      WHERE f.follower_id = u.id AND f.following_id = p_brand_id
    )
    AND public.brand_follow_eligible(u.id, p_brand_id);

  RETURN jsonb_build_object(
    'memberToBrandInserted', v_member_to_brand,
    'brandToNewMemberInserted', v_brand_to_member,
    'remaining', v_remaining
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
  -- member who signs in gets a "welcome" DM and first-post reminder.
  -- The welcome email is not queued here: the auth function's user.create.after
  -- hook sends it directly, so queuing it would send it twice.
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

REVOKE ALL ON FUNCTION public.brand_follow_eligible(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_brand_follow_relationships(integer, integer, boolean, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_brand_follows(integer, integer, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_brand_onboarding(text, interval, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brand_follow_eligible(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_brand_follow_relationships(integer, integer, boolean, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_brand_follows(integer, integer, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_brand_onboarding(text, interval, interval) TO service_role;

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
