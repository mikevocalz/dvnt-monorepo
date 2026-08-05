-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260708171038 :: events_event_tz). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Absolute-instant storage stays start_date/end_date (already timestamptz/UTC).
-- Add event_tz: the IANA zone for display of physical events (event-local).
-- Reject abbreviations like "PST" — only real IANA names (region/city, or UTC).
create or replace function public.is_valid_event_tz(tz text)
returns boolean
language sql
stable
as $$
  select tz is not null and (
    tz = 'UTC'
    or exists (select 1 from pg_timezone_names where name = tz and name like '%/%')
  );
$$;

alter table public.events add column if not exists event_tz text;

alter table public.events drop constraint if exists events_event_tz_valid;
alter table public.events add constraint events_event_tz_valid
  check (event_tz is null or public.is_valid_event_tz(event_tz));

comment on column public.events.event_tz is
  'IANA timezone for display of physical (event-local) events, e.g. America/New_York. Storage stays UTC in start_date/end_date; this is display metadata only. Streamed events (is_online=true) render in the viewer''s zone and ignore this.';;
