-- Schedule process-event-followups with pg_cron.
--
-- Nothing scheduled the post-event follow-up worker, so no follow-up email
-- could ever send. Same shape as cron_event_reminder_sweep (20260922120000)
-- and cron_event_lynk_lifecycle_sweep: CRON_SECRET is read from Vault at call
-- time and sent as x-cron-secret, never stored in cron.job.
--
-- Every 15 minutes, like the 3-hour reminder sweep. The worker also refuses
-- to send until EVENT_FOLLOWUP_UNSUBSCRIBE_SECRET is set, so scheduling it
-- early sends nothing.
--
-- PREREQUISITE: process-event-followups deployed with the same CRON_SECRET
-- (x-cron-secret auth) before this job's first run.

create or replace function public.cron_event_followup_sweep()
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
    raise warning 'cron_event_followup_sweep: CRON_SECRET not in Vault, skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/process-event-followups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.cron_event_followup_sweep() from public;
revoke all on function public.cron_event_followup_sweep() from anon;
revoke all on function public.cron_event_followup_sweep() from authenticated;
grant execute on function public.cron_event_followup_sweep() to service_role;

-- Schedule (idempotent, guarded; same pattern as the reminders migration).
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('event-followups-every-15min')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'event-followups-every-15min',
      '*/15 * * * *',
      'select public.cron_event_followup_sweep();'
    )$$;
  end if;
end $cron$;
