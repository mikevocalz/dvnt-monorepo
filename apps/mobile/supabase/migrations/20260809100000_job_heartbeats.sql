-- Observability WS-3 — dead-man monitoring for the scheduled-job fleet
-- (free Sentry Developer tier; NO paid cron monitors — see
-- docs/sentry-budget.md "Decision LOCKED"). Each money/critical job writes a
-- heartbeat row on every run; the db-health probe polls this table and raises
-- ONE clamped Sentry error per overdue job. Zero incremental Sentry cost.
--
-- Idempotent (create-if-not-exists / create-or-replace). No destructive DML.

-- ── 1. Heartbeat ledger ────────────────────────────────────────────────
create table if not exists public.job_heartbeats (
  job_name          text primary key,
  last_run_at       timestamptz,          -- start of the most recent run
  last_ok_at        timestamptz,          -- completion of the most recent OK run (dead-man anchor)
  last_status       text,                 -- 'in_progress' | 'ok' | 'error'
  last_duration_ms  integer,
  detail            jsonb,                -- last structured result (counts/outcome)
  -- WS-3 watchdog clamp: db-health stamps this when it raises the overdue
  -- Sentry error, so it fires ONCE per outage, not once per poll. Reset to
  -- NULL by record_job_heartbeat on the next OK run (alarm auto-clears).
  alerted_at        timestamptz,
  -- WS-4 skip-if-running guard: a claim sets this to now()+ttl; a concurrent
  -- run that finds it in the future backs off instead of stampeding.
  locked_until      timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table public.job_heartbeats is
  'WS-3 dead-man rows: one per scheduled/critical job. last_ok_at is the freshness anchor the db-health watchdog compares against each job SLA.';

-- ── 2. RLS: service_role only (clients never touch this) ───────────────
alter table public.job_heartbeats enable row level security;

do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'job_heartbeats'
      and policyname = 'job_heartbeats_service_role_all'
  ) then
    create policy job_heartbeats_service_role_all
      on public.job_heartbeats
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $rls$;

revoke all on public.job_heartbeats from public;
revoke all on public.job_heartbeats from anon;
revoke all on public.job_heartbeats from authenticated;
grant all on public.job_heartbeats to service_role;

-- ── 3. record_job_heartbeat RPC (service_role only) ────────────────────
-- Called by the shared withHeartbeat() edge helper and by the SQL cron
-- wrappers. Upserts the row; only an OK run advances last_ok_at and clears
-- the watchdog alarm. Never raises — telemetry must not break the money path.
create or replace function public.record_job_heartbeat(
  p_job         text,
  p_status      text,
  p_ok          boolean,
  p_duration_ms integer,
  p_detail      jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_heartbeats as jh (
    job_name, last_run_at, last_ok_at, last_status,
    last_duration_ms, detail, alerted_at, updated_at
  )
  values (
    p_job,
    now(),
    case when p_ok then now() else null end,
    p_status,
    p_duration_ms,
    p_detail,
    null,
    now()
  )
  on conflict (job_name) do update set
    last_run_at      = now(),
    last_ok_at       = case when p_ok then now() else jh.last_ok_at end,
    last_status      = excluded.last_status,
    last_duration_ms = coalesce(excluded.last_duration_ms, jh.last_duration_ms),
    detail           = coalesce(excluded.detail, jh.detail),
    -- an OK run clears the outage alarm so the next outage re-alerts
    alerted_at       = case when p_ok then null else jh.alerted_at end,
    updated_at       = now();
exception
  when others then
    -- swallow: a heartbeat write must never abort the job it measures
    raise warning 'record_job_heartbeat(%) failed: %', p_job, sqlerrm;
end;
$$;

revoke all on function public.record_job_heartbeat(text, text, boolean, integer, jsonb) from public;
revoke all on function public.record_job_heartbeat(text, text, boolean, integer, jsonb) from anon;
revoke all on function public.record_job_heartbeat(text, text, boolean, integer, jsonb) from authenticated;
grant execute on function public.record_job_heartbeat(text, text, boolean, integer, jsonb) to service_role;

-- ── 4. Skip-if-running lock (WS-4) ─────────────────────────────────────
-- Fail-CLOSED on contention (returns false → caller skips), but the caller
-- side treats an RPC ERROR as fail-open (runs anyway) so a telemetry hiccup
-- can never block a payout. TTL bounds a crashed run so the lock self-heals.
create or replace function public.try_claim_job(
  p_job         text,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.job_heartbeats (job_name)
  values (p_job)
  on conflict (job_name) do nothing;

  update public.job_heartbeats
  set locked_until = now() + make_interval(secs => greatest(p_ttl_seconds, 1))
  where job_name = p_job
    and (locked_until is null or locked_until < now());

  return found;
end;
$$;

create or replace function public.release_job_lock(p_job text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.job_heartbeats
  set locked_until = null
  where job_name = p_job;
end;
$$;

revoke all on function public.try_claim_job(text, integer) from public;
revoke all on function public.try_claim_job(text, integer) from anon;
revoke all on function public.try_claim_job(text, integer) from authenticated;
grant execute on function public.try_claim_job(text, integer) to service_role;

revoke all on function public.release_job_lock(text) from public;
revoke all on function public.release_job_lock(text) from anon;
revoke all on function public.release_job_lock(text) from authenticated;
grant execute on function public.release_job_lock(text) to service_role;

notify pgrst, 'reload schema';
