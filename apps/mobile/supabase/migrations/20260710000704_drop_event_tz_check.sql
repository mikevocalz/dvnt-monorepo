-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260710000704 :: drop_event_tz_check). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- event_tz is display-only metadata; a bad/empty value must NEVER block event
-- creation. The CHECK was turning an empty event_tz into a 400 that killed ALL
-- publishing. Drop it; validation/normalization belongs in app code, not a
-- hard DB gate on the insert path.
alter table public.events drop constraint if exists events_event_tz_valid;

-- Normalize any empty strings that snuck in to NULL so display falls back cleanly.
update public.events set event_tz = null where event_tz = '';;
