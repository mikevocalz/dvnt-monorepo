-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260617202203 :: posts_created_by). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- User-consented (build-both): `createdBy` relationship on Posts so moderators
-- can be scoped to editing only the posts they created. Additive (posts +
-- versions table), matching Payload's hasOne-relationship column convention.
alter table payload.posts add column if not exists created_by_id integer;
alter table payload._posts_v add column if not exists version_created_by_id integer;;
