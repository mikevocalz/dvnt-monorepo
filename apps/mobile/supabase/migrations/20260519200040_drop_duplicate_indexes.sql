-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519200040 :: drop_duplicate_indexes). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Polish pass surfaced by the Supabase performance advisor.
-- Drops 22 identical indexes across 9 tables. Each removed index has
-- at least one identical sibling that stays. The constraint-backed
-- unique indexes (likes_user_post_unique, story_views_story_id_user_id_key)
-- are explicitly preserved.
DROP INDEX IF EXISTS public.bookmarks_user_idx;
DROP INDEX IF EXISTS public.user_post_1_idx;
DROP INDEX IF EXISTS public.call_signals_callee_status_idx;
DROP INDEX IF EXISTS public.conversations_rels_users_id_idx;
DROP INDEX IF EXISTS public.follows_follower_idx;
DROP INDEX IF EXISTS public.follows_following_idx;
DROP INDEX IF EXISTS public.likes_post_idx;
DROP INDEX IF EXISTS public.likes_user_idx;
DROP INDEX IF EXISTS public.user_post_idx;
DROP INDEX IF EXISTS public.idx_likes_user_post_unique;
DROP INDEX IF EXISTS public.messages_sender_idx;
DROP INDEX IF EXISTS public.posts_author_idx;
DROP INDEX IF EXISTS public.story_views_story_idx;
DROP INDEX IF EXISTS public.story_views_user_idx;
DROP INDEX IF EXISTS public.idx_story_views_unique;
DROP INDEX IF EXISTS public.story_user_idx;
DROP INDEX IF EXISTS public.video_room_events_room_idx;
DROP INDEX IF EXISTS public.video_room_members_user_idx;
DROP INDEX IF EXISTS public.video_room_tokens_room_user_idx;
DROP INDEX IF EXISTS public.video_room_tokens_jti_idx;
DROP INDEX IF EXISTS public.video_rooms_created_by_idx;
DROP INDEX IF EXISTS public.video_rooms_status_idx;
DROP INDEX IF EXISTS public.video_rooms_uuid_idx;;
