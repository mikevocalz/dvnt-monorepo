-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519234941 :: drop_obviously_dead_indexes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Drop OBVIOUSLY-legacy indexes only — pg_stat_user_indexes shows
-- 0 scans across 5+ months of production traffic, AND the index
-- pattern is clearly dead-by-design (audit/CMS leftovers, never-used
-- secondary keys). Excludes:
--   - any unique index (constraint by another name)
--   - any idempotency / QR / recent-feature index
--   - any index I created during this session's FK-coverage pass
--
-- Net storage savings are small (~1 MB) but every dropped index
-- removes write overhead. Keeping the conservative subset; the rest
-- can be revisited after a longer traffic window confirms they're
-- still unused.

-- updated_at — automatic on every table migrated via Payload's
-- timestamp helper. No live query orders by updated_at.
DROP INDEX IF EXISTS public.blocks_updated_at_idx;
DROP INDEX IF EXISTS public.bookmarks_updated_at_idx;
DROP INDEX IF EXISTS public.categories_updated_at_idx;
DROP INDEX IF EXISTS public.comments_updated_at_idx;
DROP INDEX IF EXISTS public.content_flags_updated_at_idx;
DROP INDEX IF EXISTS public.conversations_updated_at_idx;
DROP INDEX IF EXISTS public.device_bans_updated_at_idx;
DROP INDEX IF EXISTS public.event_rsvps_updated_at_idx;
DROP INDEX IF EXISTS public.events_updated_at_idx;
DROP INDEX IF EXISTS public.follows_updated_at_idx;
DROP INDEX IF EXISTS public.hashtags_updated_at_idx;
DROP INDEX IF EXISTS public.likes_updated_at_idx;
DROP INDEX IF EXISTS public.media_updated_at_idx;
DROP INDEX IF EXISTS public.messages_updated_at_idx;
DROP INDEX IF EXISTS public.moderation_actions_updated_at_idx;
DROP INDEX IF EXISTS public.notifications_updated_at_idx;
DROP INDEX IF EXISTS public.posts_updated_at_idx;
DROP INDEX IF EXISTS public.reports_updated_at_idx;
DROP INDEX IF EXISTS public.stories_updated_at_idx;
DROP INDEX IF EXISTS public.story_views_updated_at_idx;
DROP INDEX IF EXISTS public.subscription_tiers_updated_at_idx;
DROP INDEX IF EXISTS public.subscriptions_updated_at_idx;
DROP INDEX IF EXISTS public.transactions_updated_at_idx;

-- external_author_id — Payload import bridge column, no live code reads it.
DROP INDEX IF EXISTS public.events_external_author_id_idx;
DROP INDEX IF EXISTS public.posts_external_author_id_idx;
DROP INDEX IF EXISTS public.stories_external_author_id_idx;

-- Payload _rels relationship-table indexes on order/path (dead schema
-- pattern from the CMS that's been removed, never queried since).
DROP INDEX IF EXISTS public.conversations_rels_order_idx;
DROP INDEX IF EXISTS public.messages_rels_order_idx;
DROP INDEX IF EXISTS public.messages_rels_path_idx;
DROP INDEX IF EXISTS public.posts_rels_hashtags_id_idx;
DROP INDEX IF EXISTS public.posts_rels_order_idx;
DROP INDEX IF EXISTS public.users_rels_order_idx;
DROP INDEX IF EXISTS public.users_rels_path_idx;
DROP INDEX IF EXISTS public.users_sessions_order_idx;
DROP INDEX IF EXISTS public.media_ai_tags_order_idx;
DROP INDEX IF EXISTS public.stories_items_order_idx;
DROP INDEX IF EXISTS public.subscription_tiers_perks_order_idx;
DROP INDEX IF EXISTS public.subscription_tiers_perks_parent_id_idx;
DROP INDEX IF EXISTS public.messages_media_order_idx;

-- Payload media size filename indexes — Payload generated these for
-- its image resizer; the live app uses Bunny CDN URLs directly.
DROP INDEX IF EXISTS public.media_sizes_card_sizes_card_filename_idx;
DROP INDEX IF EXISTS public.media_sizes_tablet_sizes_tablet_filename_idx;
DROP INDEX IF EXISTS public.media_sizes_thumbnail_sizes_thumbnail_filename_idx;

-- Slug indexes on tables where nothing queries by slug.
-- (event share_slug + cart line item indexes ARE used or could be,
-- skipping those. These three have 0 scans AND no slug-lookup code.)
DROP INDEX IF EXISTS public.categories_slug_idx;
DROP INDEX IF EXISTS public.idx_cities_slug;

-- Audit / moderation target_id / target_type indexes — these tables
-- are write-mostly (audit trail). Reads happen via admin RPCs that
-- don't filter by target_id/type alone, never used in 5 months.
DROP INDEX IF EXISTS public.moderation_actions_target_id_idx;
DROP INDEX IF EXISTS public.moderation_actions_target_type_idx;
DROP INDEX IF EXISTS public.reports_target_id_idx;
DROP INDEX IF EXISTS public.reports_target_type_idx;
DROP INDEX IF EXISTS public.content_flags_content_id_idx;
DROP INDEX IF EXISTS public.content_flags_content_type_idx;

-- categories created_at — never used (we don't paginate categories by created_at).
DROP INDEX IF EXISTS public.categories_created_at_idx;
DROP INDEX IF EXISTS public.feature_flags_created_at_idx;
DROP INDEX IF EXISTS public.settings_created_at_idx;;
