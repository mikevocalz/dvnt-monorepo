-- Applied via MCP as `analytics_events_table`; recorded here so the repo
-- matches the database. See packages/app/lib/analytics/ for the writer and
-- packages/app/lib/sentry-boot.native.ts for why Sentry stopped being the
-- answer to these questions.
--
-- Full DDL is in the MCP migration of the same name: analytics_events
-- (user_id, event, feature_area, route, entity_type, entity_id, duration_ms,
-- platform, metadata, created_at) + three indexes (route/time, entity/time,
-- user/time), RLS insert-only for authenticated+anon, no select policy.
select 1;
