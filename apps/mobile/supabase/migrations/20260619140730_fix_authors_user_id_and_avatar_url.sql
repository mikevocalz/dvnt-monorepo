-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260619140730 :: fix_authors_user_id_and_avatar_url). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE payload.authors ADD COLUMN IF NOT EXISTS user_id integer;
ALTER TABLE payload.authors ADD COLUMN IF NOT EXISTS avatar_url varchar;

DO $$ BEGIN
  ALTER TABLE payload.authors
    ADD CONSTRAINT authors_user_id_admin_users_id_fk
    FOREIGN KEY (user_id) REFERENCES payload.admin_users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS authors_user_idx ON payload.authors (user_id);;
