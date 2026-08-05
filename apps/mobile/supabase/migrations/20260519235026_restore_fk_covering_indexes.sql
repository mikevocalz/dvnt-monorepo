-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519235026 :: restore_fk_covering_indexes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Restore two indexes inadvertently dropped in the previous
-- unused-index cleanup — they were 0-scan but actually cover FK
-- constraints. Re-add them so the advisor's FK lint stays green.
CREATE INDEX IF NOT EXISTS posts_rels_hashtags_id_idx
  ON public.posts_rels(hashtags_id) WHERE hashtags_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscription_tiers_perks_parent_id_idx
  ON public.subscription_tiers_perks(_parent_id);;
