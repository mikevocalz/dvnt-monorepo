-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260518175454 :: v2_db_03c_restore_spotlight_sweep). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Wave 6 regression: the client-side `sweepExpiredCampaigns()` at
-- lib/api/promotions.ts:42 was silently failing after V2-DB-03 lockdown.
-- The function is idempotent and only flips ends_at < now() rows to status='expired'.
-- Re-grant authenticated + service_role. Anon stays locked out (anon doesn't read the
-- spotlight feed with sweep enabled anyway).
GRANT EXECUTE ON FUNCTION public.expire_spotlight_campaigns() TO authenticated, service_role;;
