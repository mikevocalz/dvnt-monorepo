-- Workstream 07 compliance — retention for provider-supplied SMS payloads.
--
-- ticket_sms_delivery_events.provider_payload holds whatever the provider
-- posted. Before the webhook was narrowed to a field whitelist it stored the
-- recipient's free-text message body verbatim, unbounded and forever. The
-- whitelist (ticket-sms-webhook) stops new bodies landing; this sweep bounds
-- how long even the whitelisted fields live, so "we keep provider metadata
-- indefinitely" stops being true.
--
-- Three windows, each with a reason:
--   provider_payload      30 days   debugging a delivery dispute, nothing longer
--   delivery event rows  400 days   one full year of delivery history plus slack
--   consent events      5 years     TCPA claims run to four years; one year over
--
-- The status columns on the row (status, error, created_at) outlive the payload
-- blob, so clearing the blob keeps the audit trail intact and drops the PII.
--
-- No destructive DML in this migration. The deletes live inside a function
-- body; defining a function does not execute it. The first rows go when cron
-- next fires.

BEGIN;

-- ── Retention windows, in one place ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sms_retention_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_payloads_cleared bigint := 0;
  v_events_deleted bigint := 0;
  v_consent_deleted bigint := 0;
BEGIN
  -- Clear the provider blob but keep the status transition.
  WITH cleared AS (
    UPDATE public.ticket_sms_delivery_events
      SET provider_payload = NULL
      WHERE provider_payload IS NOT NULL
        AND created_at < now() - interval '30 days'
      RETURNING 1
  )
  SELECT count(*) INTO v_payloads_cleared FROM cleared;

  WITH removed AS (
    DELETE FROM public.ticket_sms_delivery_events
      WHERE created_at < now() - interval '400 days'
      RETURNING 1
  )
  SELECT count(*) INTO v_events_deleted FROM removed;

  WITH removed AS (
    DELETE FROM public.sms_consent_events
      WHERE created_at < now() - interval '5 years'
      RETURNING 1
  )
  SELECT count(*) INTO v_consent_deleted FROM removed;

  RETURN jsonb_build_object(
    'payloads_cleared', v_payloads_cleared,
    'delivery_events_deleted', v_events_deleted,
    'consent_events_deleted', v_consent_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sms_retention_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_retention_sweep() TO service_role;

-- ── Cron wrapper: lock + heartbeat around the pure sweep ───────────────
-- Same shape as cron_cart_release_expired_holds (20260809100100): xact-scoped
-- advisory lock so an overlapping tick backs off, and a heartbeat so a sweep
-- that stops running trips the db-health watchdog instead of going unnoticed.
CREATE OR REPLACE FUNCTION public.cron_sms_retention_sweep()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_start timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('sms-retention-sweep')) THEN
    RETURN;
  END IF;

  v_result := public.sms_retention_sweep();

  PERFORM public.record_job_heartbeat(
    'sms-retention-sweep',
    'ok',
    true,
    (extract(epoch FROM clock_timestamp() - v_start) * 1000)::int,
    v_result
  );
EXCEPTION
  WHEN others THEN
    -- Swallow so the error heartbeat COMMITS. A re-raise would roll it back
    -- with the transaction and the watchdog would see nothing at all.
    PERFORM public.record_job_heartbeat(
      'sms-retention-sweep',
      'error',
      false,
      (extract(epoch FROM clock_timestamp() - v_start) * 1000)::int,
      jsonb_build_object('error', sqlerrm)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_sms_retention_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_sms_retention_sweep() TO service_role;

COMMIT;

-- ── Schedule (idempotent, guarded — house pattern) ─────────────────────
-- 03:40 daily. Off the hour and off every other job's slot so three sweeps do
-- not fire in lockstep.
DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    BEGIN
      EXECUTE $$SELECT cron.unschedule('sms-retention-sweep')$$;
    EXCEPTION
      WHEN others THEN NULL;
    END;

    EXECUTE $$SELECT cron.schedule(
      'sms-retention-sweep',
      '40 3 * * *',
      'select public.cron_sms_retention_sweep();'
    )$$;
  END IF;
END $cron$;

NOTIFY pgrst, 'reload schema';
