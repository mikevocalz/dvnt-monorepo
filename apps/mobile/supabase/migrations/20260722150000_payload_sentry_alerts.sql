-- A9 sentry-alerts Payload collection table (push=false in prod — reviewed
-- DDL matching the drizzle adapter conventions of payload.reports).
-- Applied 2026-07-22 via psql.
create type payload.enum_sentry_alerts_action as enum ('created','regressed','resolved','unresolved','other');
create table if not exists payload.sentry_alerts (
  id serial primary key,
  action payload.enum_sentry_alerts_action not null,
  title varchar not null,
  short_id varchar,
  issue_id varchar,
  project varchar,
  level varchar,
  permalink varchar,
  read boolean default false,
  updated_at timestamp(3) with time zone not null default now(),
  created_at timestamp(3) with time zone not null default now()
);
create index if not exists sentry_alerts_issue_id_idx on payload.sentry_alerts (issue_id);
create index if not exists sentry_alerts_read_idx on payload.sentry_alerts (read);
create index if not exists sentry_alerts_created_at_idx on payload.sentry_alerts (created_at);
create index if not exists sentry_alerts_updated_at_idx on payload.sentry_alerts (updated_at);
