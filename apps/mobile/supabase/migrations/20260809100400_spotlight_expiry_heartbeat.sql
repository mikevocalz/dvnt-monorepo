-- WS-3/WS-4 — expire_spotlight_campaigns() heartbeat + skip-if-running guard.
--
-- CAVEAT (verified against baseline §2): spotlight expiry is NOT a cron job.
-- It is client-fired on feed load (lib/api/promotions.ts sweep; re-granted to
-- authenticated + service_role in 20260518175454). We keep that model and only
-- add a heartbeat so the db-health watchdog can dead-man it (lenient SLA:
-- 60m interval + 60m margin, since cadence == organic feed traffic, not cron).
--
-- Behavior preserved exactly: still an idempotent UPDATE of status='active'
-- rows past ends_at. No destructive DML. Language moves sql → plpgsql to add
-- the lock + heartbeat around the same UPDATE.
create or replace function public.expire_spotlight_campaigns()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start   timestamptz := clock_timestamp();
  v_expired integer;
begin
  -- WS-4 skip-if-running: many clients call this concurrently on feed load;
  -- only one sweep runs per moment, the rest back off. Idempotent → a skip
  -- loses nothing (another caller records the heartbeat).
  if not pg_try_advisory_xact_lock(hashtext('spotlight-expiry')) then
    return;
  end if;

  update event_spotlight_campaigns
  set status = 'expired', updated_at = now()
  where status = 'active' and ends_at < now();
  get diagnostics v_expired = row_count;

  perform public.record_job_heartbeat(
    'spotlight-expiry',
    'ok',
    true,
    (extract(epoch from clock_timestamp() - v_start) * 1000)::int,
    jsonb_build_object('expired', v_expired)
  );
end;
$$;

-- Preserve the existing grants (postgres owner + client sweep + service_role).
grant execute on function public.expire_spotlight_campaigns() to authenticated, service_role;

notify pgrst, 'reload schema';
