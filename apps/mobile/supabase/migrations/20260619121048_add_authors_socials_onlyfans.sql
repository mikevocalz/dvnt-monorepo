-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260619121048 :: add_authors_socials_onlyfans). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE payload.authors ADD COLUMN IF NOT EXISTS socials_onlyfans text;;
