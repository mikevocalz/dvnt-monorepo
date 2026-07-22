-- Onboarding identity + event audience preference (applied 2026-07-21 via psql).
-- Nullable, no constraints: display/filter data must never gate the write path.
alter table public.users add column if not exists sexuality text[];
alter table public.users add column if not exists event_audience text;
