-- 3-hour event reminder emails — schedule-as-code.
--
-- `event-reminders` (edge fn) mails every ticket holder once per event,
-- ~3h before start_date. This migration adds the per-event sent marker
-- and the pg_cron dispatcher that calls it every 15 minutes.
--
-- Same Vault-secret shape as cron_reconcile_orders
-- (20260915200000): CRON_SECRET is read from Vault at call time, never
-- baked into cron.job.
--
-- PREREQUISITE: Vault already holds CRON_SECRET (seeded for
-- reconcile-orders). This dispatcher reuses it.

-- ── 1. Per-event sent marker ─────────────────────────────────────────
alter table public.events
  add column if not exists reminder_sent_at timestamptz;

comment on column public.events.reminder_sent_at is
  'Set by the event-reminders sweep after every ticket holder was mailed the 3-hour reminder. Null = not yet reminded.';

-- ── 2. Vault-backed dispatcher ───────────────────────────────────────
create or replace function public.cron_event_reminder_sweep()
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
    raise warning 'cron_event_reminder_sweep: CRON_SECRET not in Vault — skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/event-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    -- Fan-out is bounded by events in a 60-min band; well under the
    -- 15-min interval.
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.cron_event_reminder_sweep() from public;
revoke all on function public.cron_event_reminder_sweep() from anon;
revoke all on function public.cron_event_reminder_sweep() from authenticated;
grant execute on function public.cron_event_reminder_sweep() to service_role;

-- ── 3. Schedule (idempotent, guarded — house pattern) ────────────────
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('event-reminders-every-15min')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'event-reminders-every-15min',
      '*/15 * * * *',
      'select public.cron_event_reminder_sweep();'
    )$$;
  end if;
end $cron$;
