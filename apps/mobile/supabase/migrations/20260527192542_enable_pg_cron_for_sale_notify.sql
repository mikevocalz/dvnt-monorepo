-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260527192542 :: enable_pg_cron_for_sale_notify). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Enable pg_cron so the notify-sale-open edge function can be triggered
-- on a recurring schedule directly from the database. Supabase exposes
-- this in the "extensions" schema by convention.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;;
