-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260618022544 :: events_cover_upload). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

alter table payload.events add column if not exists cover_upload_id integer;
alter table payload._events_v add column if not exists version_cover_upload_id integer;;
