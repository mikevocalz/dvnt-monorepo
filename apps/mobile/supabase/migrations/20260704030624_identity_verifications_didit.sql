-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260704030624 :: identity_verifications_didit). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE identity_verifications
  DROP CONSTRAINT IF EXISTS identity_verifications_provider_check;
ALTER TABLE identity_verifications
  ADD CONSTRAINT identity_verifications_provider_check
  CHECK (provider IN ('persona','veriff','onfido','yoti','didit'));;
