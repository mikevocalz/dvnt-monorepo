-- Schedule-as-code — cart-hold-cleanup (WS-3/WS-4).
--
-- DRIFT FIX: 20260516150000_mixed_cart_checkout.sql scheduled this job in a
-- pg_cron DO block, but it is ABSENT from live cron.job (a fresh replay never
-- recreated it). This migration re-declares it idempotently so cron.job ≡
-- migrations, and routes the cron through a wrapper that adds the WS-3
-- heartbeat + WS-4 advisory lock + jitter WITHOUT touching the money SQL.
--
-- cart_release_expired_holds() itself is already idempotent (UPDATE ...
-- WHERE released = false AND expires_at <= now()). No destructive DML here.

-- ── 1. Cron wrapper: lock + jitter + heartbeat around the pure sweep ────
create or replace function public.cron_cart_release_expired_holds()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start  timestamptz := clock_timestamp();
  v_result jsonb;
begin
  -- WS-4 skip-if-running: xact-scoped advisory lock — an overlapping */5 tick
  -- (a slow sweep still running) backs off instead of stampeding.
  if not pg_try_advisory_xact_lock(hashtext('cart-hold-cleanup')) then
    return;
  end if;

  -- WS-4 jitter: 0–5s spread so the three */5 jobs don't fire in lockstep.
  -- Safe — the sweep is idempotent.
  perform pg_sleep(floor(random() * 5)::int);

  v_result := public.cart_release_expired_holds();

  perform public.record_job_heartbeat(
    'cart-hold-cleanup',
    'ok',
    true,
    (extract(epoch from clock_timestamp() - v_start) * 1000)::int,
    v_result
  );
exception
  when others then
    -- Swallow so the error heartbeat COMMITS (a re-raise would roll it back
    -- with the transaction). Stale last_ok_at then trips the db-health
    -- watchdog — the intended dead-man signal.
    perform public.record_job_heartbeat(
      'cart-hold-cleanup',
      'error',
      false,
      (extract(epoch from clock_timestamp() - v_start) * 1000)::int,
      jsonb_build_object('error', sqlerrm)
    );
end;
$$;

revoke all on function public.cron_cart_release_expired_holds() from public;
revoke all on function public.cron_cart_release_expired_holds() from anon;
revoke all on function public.cron_cart_release_expired_holds() from authenticated;
grant execute on function public.cron_cart_release_expired_holds() to service_role;

-- ── 2. Schedule (idempotent, guarded — house pattern) ──────────────────
-- Live schedule mirrored: */5 * * * *.
do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    begin
      execute $$select cron.unschedule('cart-hold-cleanup')$$;
    exception
      when others then null;
    end;

    execute $$select cron.schedule(
      'cart-hold-cleanup',
      '*/5 * * * *',
      'select public.cron_cart_release_expired_holds();'
    )$$;
  end if;
end $cron$;
