-- Schedule process-event-lynk-lifecycle with pg_cron.
--
-- Same shape as cron_event_reminder_sweep (20260922120000): CRON_SECRET is
-- read from Vault at call time and sent as x-cron-secret, so the secret is
-- never baked into cron.job.
--
-- Every 5 minutes: the sweep is what flips a precreated 'scheduled' room to
-- 'open' at event start, so the cadence is the worst-case lag between the
-- advertised start and the room opening. 15 minutes (the reminder cadence)
-- would leave ticket holders on the countdown for up to a quarter hour.
-- End-of-event cleanup only needs to beat the 24h listing cap, which any of
-- these cadences does.
--
-- PREREQUISITE: Vault already holds CRON_SECRET (seeded for
-- reconcile-orders, reused by event reminders). The edge function must be
-- deployed with the same CRON_SECRET before this job's first run, or every
-- call is rejected.

create or replace function public.cron_event_lynk_lifecycle_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'CRON_SECRET'
  limit 1;

  if v_secret is null then
    raise warning 'cron_event_lynk_lifecycle_sweep: CRON_SECRET not in Vault, skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/process-event-lynk-lifecycle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    -- At most 500 events, one RPC and one update each; well under the
    -- 5-minute interval.
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.cron_event_lynk_lifecycle_sweep() from public;
revoke all on function public.cron_event_lynk_lifecycle_sweep() from anon;
revoke all on function public.cron_event_lynk_lifecycle_sweep() from authenticated;
grant execute on function public.cron_event_lynk_lifecycle_sweep() to service_role;

-- Schedule (idempotent, guarded; same pattern as the reminders migration).
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('event-lynk-lifecycle-every-5min')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'event-lynk-lifecycle-every-5min',
      '*/5 * * * *',
      'select public.cron_event_lynk_lifecycle_sweep();'
    )$$;
  end if;
end $cron$;
