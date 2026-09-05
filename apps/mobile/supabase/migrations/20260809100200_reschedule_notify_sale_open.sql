-- Schedule-as-code — notify-sale-open-every-5min (WS-3 drift fix).
--
-- DRIFT: this job exists ONLY in live cron.job — no migration schedules it,
-- and its x-cron-secret lives only in the live command + edge env. A DB
-- restore/branch-reset silently kills sale notifications. This re-declares it
-- idempotently AND lifts the secret OUT of cron.job into Vault (the house
-- pattern from 20260808220000_rc_webhook_secret_vault_fn.sql).
--
-- PREREQUISITE (secret VALUE never lives in a migration): seed Vault once with
--   select vault.create_secret(
--     '<SALE_NOTIFY_CRON_SECRET value — same as the edge env>',
--     'SALE_NOTIFY_CRON_SECRET');
-- If the secret is absent the dispatcher no-ops with a warning (fail-safe:
-- the edge fn's x-cron-secret check would 403 an empty secret anyway).

-- ── 1. Vault-backed dispatcher (secret read at call time, not baked in) ─
create or replace function public.cron_notify_sale_open()
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
  where name = 'SALE_NOTIFY_CRON_SECRET'
  limit 1;

  if v_secret is null then
    raise warning 'cron_notify_sale_open: SALE_NOTIFY_CRON_SECRET not in Vault — skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/notify-sale-open',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000  -- WS-4: 30s ≪ the */5 interval
  );
end;
$$;

revoke all on function public.cron_notify_sale_open() from public;
revoke all on function public.cron_notify_sale_open() from anon;
revoke all on function public.cron_notify_sale_open() from authenticated;
grant execute on function public.cron_notify_sale_open() to service_role;

-- ── 2. Schedule (idempotent, guarded — house pattern) ──────────────────
-- Live schedule mirrored EXACTLY: name 'notify-sale-open-every-5min', */5 * * * *.
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('notify-sale-open-every-5min')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'notify-sale-open-every-5min',
      '*/5 * * * *',
      'select public.cron_notify_sale_open();'
    )$$;
  end if;
end $cron$;
