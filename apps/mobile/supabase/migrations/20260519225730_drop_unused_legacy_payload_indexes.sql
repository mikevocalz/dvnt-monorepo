-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519225730 :: drop_unused_legacy_payload_indexes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Drops 84 indexes on legacy Payload CMS tables. Per CLAUDE.md:
-- "Payload CMS — REMOVED, never reference". The tables themselves
-- still exist but are unused by the live app (all reads/writes
-- happen through Better Auth + Supabase Edge Functions). The
-- indexes contribute storage + write overhead with zero query benefit.
--
-- Tables are kept for now (separate decision to drop them entirely);
-- this is just the no-risk cleanup of unused indexes that the
-- Supabase performance advisor has been flagging.
DROP INDEX IF EXISTS public.payload_locked_documents_rels_user_devices_id_idx;
DROP INDEX IF EXISTS public.pages_hero_links_order_idx;
DROP INDEX IF EXISTS public.pages_hero_links_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_archive_order_idx;
DROP INDEX IF EXISTS public.pages_blocks_archive_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_archive_path_idx;
DROP INDEX IF EXISTS public.pages_blocks_content_columns_order_idx;
DROP INDEX IF EXISTS public.pages_blocks_content_columns_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_content_order_idx;
DROP INDEX IF EXISTS public.pages_blocks_content_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_content_path_idx;
DROP INDEX IF EXISTS public.pages_blocks_cta_links_order_idx;
DROP INDEX IF EXISTS public.pages_blocks_cta_links_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_cta_order_idx;
DROP INDEX IF EXISTS public.pages_blocks_cta_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_cta_path_idx;
DROP INDEX IF EXISTS public.pages_blocks_media_block_order_idx;
DROP INDEX IF EXISTS public.pages_blocks_media_block_parent_id_idx;
DROP INDEX IF EXISTS public.pages_blocks_media_block_path_idx;
DROP INDEX IF EXISTS public.pages_rels_order_idx;
DROP INDEX IF EXISTS public.pages_rels_parent_idx;
DROP INDEX IF EXISTS public.pages_rels_path_idx;
DROP INDEX IF EXISTS public.pages_rels_pages_id_idx;
DROP INDEX IF EXISTS public._pages_v_version_hero_links_order_idx;
DROP INDEX IF EXISTS public._pages_v_version_hero_links_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_archive_order_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_archive_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_archive_path_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_content_columns_order_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_content_columns_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_content_order_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_content_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_content_path_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_cta_links_order_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_cta_links_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_cta_order_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_cta_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_cta_path_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_media_block_order_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_media_block_parent_id_idx;
DROP INDEX IF EXISTS public._pages_v_blocks_media_block_path_idx;
DROP INDEX IF EXISTS public._pages_v_parent_idx;
DROP INDEX IF EXISTS public._pages_v_version_version_slug_idx;
DROP INDEX IF EXISTS public._pages_v_version_version_updated_at_idx;
DROP INDEX IF EXISTS public._pages_v_version_version_created_at_idx;
DROP INDEX IF EXISTS public._pages_v_version_version__status_idx;
DROP INDEX IF EXISTS public._pages_v_created_at_idx;
DROP INDEX IF EXISTS public._pages_v_updated_at_idx;
DROP INDEX IF EXISTS public._pages_v_latest_idx;
DROP INDEX IF EXISTS public._pages_v_autosave_idx;
DROP INDEX IF EXISTS public._pages_v_rels_order_idx;
DROP INDEX IF EXISTS public._pages_v_rels_parent_idx;
DROP INDEX IF EXISTS public._pages_v_rels_path_idx;
DROP INDEX IF EXISTS public._pages_v_rels_pages_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_global_slug_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_updated_at_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_created_at_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_order_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_parent_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_profiles_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_accounts_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_blocks_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_reactions_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_hashtags_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_user_tags_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_conversations_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_reports_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_moderation_actions_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_content_flags_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_device_bans_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_subscription_tiers_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_subscriptions_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_transactions_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_settings_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_feature_flags_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_pages_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_categories_id_idx;
DROP INDEX IF EXISTS public.payload_locked_documents_rels_legal_pages_id_idx;
DROP INDEX IF EXISTS public.payload_preferences_updated_at_idx;
DROP INDEX IF EXISTS public.payload_preferences_created_at_idx;
DROP INDEX IF EXISTS public.payload_preferences_rels_order_idx;
DROP INDEX IF EXISTS public.payload_migrations_updated_at_idx;
DROP INDEX IF EXISTS public.payload_migrations_created_at_idx;
DROP INDEX IF EXISTS public.idx_payload_locked_docs_rels_event_comments_id;;
