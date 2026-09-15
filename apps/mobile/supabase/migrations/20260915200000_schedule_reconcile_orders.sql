-- Schedule-as-code — reconcile-orders every 15 minutes.
--
-- The function header has said "every 15 minutes via cron" since it was
-- written, and docs/runbooks/reconcile-orders.md already flags that no such
-- job exists in live cron.job. It has never run: as of 2026-09-15 there are
-- 48 orders in payment_pending with holds still 'active' months past
-- expires_at — the exact rows the first step of every run is meant to clear.
-- Money-tier: paid-but-unissued orders are only ever found by this sweep.
--
-- Same shape as cron_notify_sale_open (20260809100200): secret read from
-- Vault at call time, never baked into cron.job.
--
-- PREREQUISITE (secret VALUE never lives in a migration): seed Vault once with
--   select vault.create_secret(
--     '<CRON_SECRET value — same as the edge env>',
--     'CRON_SECRET');
-- Absent secret → the dispatcher no-ops with a warning (the edge fn would
-- 401 an empty x-cron-secret anyway).

-- ── 1. Vault-backed dispatcher ─────────────────────────────────────────
create or replace function public.cron_reconcile_orders()
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
    raise warning 'cron_reconcile_orders: CRON_SECRET not in Vault — skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/reconcile-orders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body    := '{"hours_back": 2}'::jsonb,
    -- Up to 50 orders × a Stripe GET each; well under the 15-min interval
    -- and under the fn's own 5-min tryClaimJob lock.
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.cron_reconcile_orders() from public;
revoke all on function public.cron_reconcile_orders() from anon;
revoke all on function public.cron_reconcile_orders() from authenticated;
grant execute on function public.cron_reconcile_orders() to service_role;

-- ── 2. Schedule (idempotent, guarded — house pattern) ──────────────────
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('reconcile-orders-every-15min')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'reconcile-orders-every-15min',
      '*/15 * * * *',
      'select public.cron_reconcile_orders();'
    )$$;
  end if;
end $cron$;
