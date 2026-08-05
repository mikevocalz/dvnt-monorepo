-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519231255 :: drop_legacy_payload_tables). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Drop 33 legacy Payload CMS + pre-Better-Auth tables. Verified
-- isolated: no live table has a foreign key pointing into any of
-- these. Per CLAUDE.md, Payload CMS has been REMOVED from this app
-- since 2026-02-06. The tables sat as dead schema until now.
--
-- CASCADE is safe here because all FK references are internal
-- (pages_blocks_* → pages, etc.) — the predicate query confirmed
-- nothing external touches them.
--
-- Eliminates ~50 unused_index warnings + the 41 unindexed_foreign_keys
-- warnings that appeared after we dropped the indexes on these
-- tables in the previous migration.

-- Pages CMS (must drop _pages_v block tables before _pages_v itself)
DROP TABLE IF EXISTS public._pages_v_blocks_media_block CASCADE;
DROP TABLE IF EXISTS public._pages_v_blocks_cta_links CASCADE;
DROP TABLE IF EXISTS public._pages_v_blocks_cta CASCADE;
DROP TABLE IF EXISTS public._pages_v_blocks_content_columns CASCADE;
DROP TABLE IF EXISTS public._pages_v_blocks_content CASCADE;
DROP TABLE IF EXISTS public._pages_v_blocks_archive CASCADE;
DROP TABLE IF EXISTS public._pages_v_version_hero_links CASCADE;
DROP TABLE IF EXISTS public._pages_v_rels CASCADE;
DROP TABLE IF EXISTS public._pages_v CASCADE;
DROP TABLE IF EXISTS public.pages_blocks_media_block CASCADE;
DROP TABLE IF EXISTS public.pages_blocks_cta_links CASCADE;
DROP TABLE IF EXISTS public.pages_blocks_cta CASCADE;
DROP TABLE IF EXISTS public.pages_blocks_content_columns CASCADE;
DROP TABLE IF EXISTS public.pages_blocks_content CASCADE;
DROP TABLE IF EXISTS public.pages_blocks_archive CASCADE;
DROP TABLE IF EXISTS public.pages_hero_links CASCADE;
DROP TABLE IF EXISTS public.pages_rels CASCADE;
DROP TABLE IF EXISTS public.pages CASCADE;

-- Payload CMS infra
DROP TABLE IF EXISTS public.payload_locked_documents_rels CASCADE;
DROP TABLE IF EXISTS public.payload_locked_documents CASCADE;
DROP TABLE IF EXISTS public.payload_preferences_rels CASCADE;
DROP TABLE IF EXISTS public.payload_preferences CASCADE;
DROP TABLE IF EXISTS public.payload_migrations CASCADE;
DROP TABLE IF EXISTS public.payload_kv CASCADE;

-- Payload-era profile/account leftovers (Better Auth's `user` table
-- + the app's `users` table are the live ones)
DROP TABLE IF EXISTS public.profiles_links CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.accounts CASCADE;
DROP TABLE IF EXISTS public.account CASCADE;

-- Other zero-ref leftovers
DROP TABLE IF EXISTS public.user_tags CASCADE;
DROP TABLE IF EXISTS public.user_devices CASCADE;
DROP TABLE IF EXISTS public.reactions CASCADE;
DROP TABLE IF EXISTS public.legal_pages_faqs CASCADE;
DROP TABLE IF EXISTS public.legal_pages CASCADE;;
