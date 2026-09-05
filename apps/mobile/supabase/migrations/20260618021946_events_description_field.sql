-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260618021946 :: events_description_field). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

alter table payload.events add column if not exists description text;
alter table payload._events_v add column if not exists version_description text;
update payload.events ev
set description = e.description
from public.events e
where ev.app_event_id = e.id::text and e.description is not null;;
