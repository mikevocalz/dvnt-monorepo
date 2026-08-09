-- Schedule-as-code — dvnt-cms-sync (WS-3 drift fix).
--
-- DRIFT: 20260722160000_cms_auto_sync_cron.sql has its cron.schedule COMMENTED
-- OUT (file is documentation of a psql-applied job); the real APP_SYNC_KEY
-- lives only in the live cron.job command + Vercel env. A restore/branch-reset
-- silently kills CMS auto-sync. This re-declares it idempotently and lifts the
-- secret OUT of cron.job into Vault (house pattern).
--
-- PREREQUISITE (secret VALUE never lives in a migration): seed Vault once with
--   select vault.create_secret(
--     '<APP_SYNC_KEY value — same as Vercel env>', 'APP_SYNC_KEY');
-- If absent the dispatcher no-ops with a warning; the CMS endpoint would
-- reject an empty x-sync-key anyway.

-- ── 1. Vault-backed dispatcher ─────────────────────────────────────────
create or replace function public.cron_cms_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'APP_SYNC_KEY'
  limit 1;

  if v_key is null then
    raise warning 'cron_cms_sync: APP_SYNC_KEY not in Vault — skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://dvntapp.live/payload-api/app/sync',
    headers := jsonb_build_object('x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000  -- WS-4: 55s ≪ the */10 interval
  );
end;
$$;

revoke all on function public.cron_cms_sync() from public;
revoke all on function public.cron_cms_sync() from anon;
revoke all on function public.cron_cms_sync() from authenticated;
grant execute on function public.cron_cms_sync() to service_role;

-- ── 2. Schedule (idempotent, guarded — house pattern) ──────────────────
-- Live schedule mirrored EXACTLY: name 'dvnt-cms-sync', */10 * * * *.
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('dvnt-cms-sync')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'dvnt-cms-sync',
      '*/10 * * * *',
      'select public.cron_cms_sync();'
    )$$;
  end if;
end $cron$;
