-- DVNT 2026-10-08: repair unattended brand follow + profile photo reminders.
-- Never infer a sender from a mutable username alone. The brand's public ID is
-- pinned to the known canonical account, with an existing Better Auth user.
-- A stale or renamed account makes this procedure fail closed.
CREATE OR REPLACE FUNCTION public.repair_canonical_brand_follows(
  p_limit integer DEFAULT 250
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u JOIN public."user" a ON a.id = u.auth_id
    WHERE u.id = 613 AND lower(u.username) = 'deviantevents'
      AND u.banned_at IS NULL AND coalesce(a.banned,false) = false
  ) THEN
    RAISE EXCEPTION 'Canonical DeviantEvents identity is unavailable';
  END IF;
  SELECT public.backfill_brand_follows(613,least(greatest(p_limit,1),1000),'7 days') INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.repair_canonical_brand_follows(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.repair_canonical_brand_follows(integer) TO service_role;

-- No avatar: both public.users.avatar_id and the Better Auth image are missing.
-- Suppress accounts that have disappeared, are banned, or already have a photo.
-- UNIQUE (campaign_version, recipient_id, channel) makes retries no-op.
CREATE OR REPLACE FUNCTION public.enqueue_missing_avatar_reminder(
 p_limit integer DEFAULT 2000
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,pg_temp AS $$
DECLARE inserted_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u JOIN public."user" a ON a.id=u.auth_id
    WHERE u.id=613 AND lower(u.username)='deviantevents' AND u.banned_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical DeviantEvents identity is unavailable';
  END IF;
  WITH recipients AS (
    SELECT u.id FROM public.users u
    JOIN public."user" a ON a.id=u.auth_id
    WHERE u.id <> 613 AND u.banned_at IS NULL
      AND coalesce(a.banned,false)=false
      AND u.avatar_id IS NULL
      AND nullif(btrim(coalesce(a.image,'')),'') IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_message_opt_outs o WHERE o.recipient_id=u.id
      )
      -- Filter BEFORE the batch limit; otherwise existing outbox rows
      -- starve higher-ID members forever once the audience exceeds p_limit.
      AND NOT EXISTS (
        SELECT 1 FROM public.brand_message_outbox q
        WHERE q.recipient_id=u.id AND q.campaign_version='profile_photo_v1'
          AND q.channel='dm'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.blocks b
        WHERE (b.blocker_id=613 AND b.blocked_id=u.id)
           OR (b.blocked_id=613 AND b.blocker_id=u.id)
      )
    ORDER BY u.id LIMIT least(greatest(p_limit,0),5000)
  ), inserted AS (
    INSERT INTO public.brand_message_outbox
      (campaign,campaign_version,recipient_id,channel,provider_idempotency_key,available_at)
    SELECT 'profile_completion','profile_photo_v1',id,'dm',
           'profile_photo_v1:'||id||':dm',now()
    FROM recipients
    ON CONFLICT ON CONSTRAINT brand_message_outbox_campaign_recipient_channel_key DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted_count FROM inserted;
  RETURN inserted_count;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_missing_avatar_reminder(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_missing_avatar_reminder(integer) TO service_role;

-- Continue the follow repair inside the cron sweep even when Edge worker
-- brand credentials are accidentally omitted. Keep existing cron behavior.
-- This is a fail-closed database repair and does NOT enable outbound messages.
