-- A10 probes (applied 2026-07-22 via psql): pg_cron drives the scheduled
-- self-runs; Sentry cron monitors (auto-created by check-ins) are the
-- dead-man's switch that fires when these CAN'T run.
select cron.schedule(
  'dvnt-db-health',
  '* * * * *',
  $$select net.http_get(url := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/db-health?checkin=1', timeout_milliseconds := 8000)$$
);
select cron.schedule(
  'dvnt-cdn-probe',
  '*/5 * * * *',
  $$select net.http_get(url := 'https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/cdn-probe?checkin=1', timeout_milliseconds := 15000)$$
);
