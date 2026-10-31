-- Activation requires separate approval AFTER refresh-platform-fees is deployed.
-- Reporting only: no recovery schedule/function changes, no credentials created,
-- no provider reads or cache enrollment occur while this migration is applied.
BEGIN;
CREATE FUNCTION public.cron_refresh_platform_fees()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret text; v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM vault.decrypted_secrets WHERE name='CRON_SECRET';
 IF v_count<>1 THEN
   RAISE WARNING 'Reporting scheduler secret is unavailable or ambiguous';
   RETURN;
 END IF;
 SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name='CRON_SECRET';
 IF v_secret IS NULL OR length(v_secret)=0 THEN
   RAISE WARNING 'Reporting scheduler secret is unavailable';
   RETURN;
 END IF;
 PERFORM net.http_post(
   url := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/refresh-platform-fees',
   headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',v_secret),
   body := '{}'::jsonb,
   timeout_milliseconds := 30000
 );
END;
$$;
REVOKE ALL ON FUNCTION public.cron_refresh_platform_fees() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cron_refresh_platform_fees() TO service_role;
DO $schedule$
BEGIN
 IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
   RAISE EXCEPTION 'Reporting schedule requires the existing scheduler';
 END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='refresh-platform-fees-reporting-only') THEN
   RAISE EXCEPTION 'Reporting job already exists; inspect before activation';
 END IF;
 PERFORM cron.schedule('refresh-platform-fees-reporting-only','7,22,37,52 * * * *','select public.cron_refresh_platform_fees();');
END;
$schedule$;
COMMIT;
