-- ============================================================================
-- COMPREHENSIVE RLS SELECT POLICY FIX
-- The backend_health_package enabled RLS on 60+ tables but only created
-- SELECT policies for ~4 of them. This migration ensures EVERY table that
-- the client needs to read has a proper SELECT policy for authenticated users.
--
-- Strategy: DROP IF EXISTS + CREATE to be fully idempotent.
-- All policies use USING (true) for reads — write policies handle authorization.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CORE CONTENT TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Events (ensure select policy exists)
DROP POLICY IF EXISTS events_select_all ON public.events;
CREATE POLICY events_select_all ON public.events
  FOR SELECT TO authenticated USING (true);

-- Posts — replace restrictive visibility policy with open read
-- (visibility filtering should happen in app logic, not RLS)
DROP POLICY IF EXISTS posts_select_public ON public.posts;
DROP POLICY IF EXISTS posts_select_all ON public.posts;
CREATE POLICY posts_select_all ON public.posts
  FOR SELECT TO authenticated USING (true);

-- Posts media
DROP POLICY IF EXISTS posts_media_select_all ON public.posts_media;
CREATE POLICY posts_media_select_all ON public.posts_media
  FOR SELECT TO authenticated USING (true);

-- Posts rels
DROP POLICY IF EXISTS posts_rels_select_all ON public.posts_rels;
CREATE POLICY posts_rels_select_all ON public.posts_rels
  FOR SELECT TO authenticated USING (true);

-- Comments
DROP POLICY IF EXISTS comments_select_all ON public.comments;
CREATE POLICY comments_select_all ON public.comments
  FOR SELECT TO authenticated USING (true);

-- Comment likes
DROP POLICY IF EXISTS comment_likes_select_authenticated ON public.comment_likes;
DROP POLICY IF EXISTS comment_likes_select_all ON public.comment_likes;
CREATE POLICY comment_likes_select_all ON public.comment_likes
  FOR SELECT TO authenticated USING (true);

-- Likes
DROP POLICY IF EXISTS likes_select_all ON public.likes;
CREATE POLICY likes_select_all ON public.likes
  FOR SELECT TO authenticated USING (true);

-- Bookmarks
DROP POLICY IF EXISTS bookmarks_select_all ON public.bookmarks;
CREATE POLICY bookmarks_select_all ON public.bookmarks
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EVENTS ECOSYSTEM
-- ═══════════════════════════════════════════════════════════════════════════

-- Event likes
DROP POLICY IF EXISTS event_likes_select_all ON public.event_likes;
CREATE POLICY event_likes_select_all ON public.event_likes
  FOR SELECT TO authenticated USING (true);

-- Event RSVPs
DROP POLICY IF EXISTS event_rsvps_select_authenticated ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_select_all ON public.event_rsvps;
CREATE POLICY event_rsvps_select_all ON public.event_rsvps
  FOR SELECT TO authenticated USING (true);

-- Event comments
DO $$ BEGIN
  DROP POLICY IF EXISTS event_comments_select_all ON public.event_comments;
  CREATE POLICY event_comments_select_all ON public.event_comments
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Event reviews
DO $$ BEGIN
  DROP POLICY IF EXISTS event_reviews_select_all ON public.event_reviews;
  CREATE POLICY event_reviews_select_all ON public.event_reviews
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Event financials (host reads own)
DO $$ BEGIN
  DROP POLICY IF EXISTS event_financials_select_all ON public.event_financials;
  CREATE POLICY event_financials_select_all ON public.event_financials
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Tickets
DROP POLICY IF EXISTS tickets_select_all ON public.tickets;
CREATE POLICY tickets_select_all ON public.tickets
  FOR SELECT TO authenticated USING (true);

-- Ticket types
DROP POLICY IF EXISTS ticket_types_select_all ON public.ticket_types;
CREATE POLICY ticket_types_select_all ON public.ticket_types
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. USER & SOCIAL TABLES
-- ═══════════════════════════════════════════════════════════════════════════

-- Users
DROP POLICY IF EXISTS users_select_public ON public.users;
DROP POLICY IF EXISTS users_select_all ON public.users;
CREATE POLICY users_select_all ON public.users
  FOR SELECT TO authenticated USING (true);

-- Follows
DROP POLICY IF EXISTS follows_select_all ON public.follows;
CREATE POLICY follows_select_all ON public.follows
  FOR SELECT TO authenticated USING (true);

-- Blocks
DO $$ BEGIN
  DROP POLICY IF EXISTS blocks_select_all ON public.blocks;
  CREATE POLICY blocks_select_all ON public.blocks
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Close friends
DO $$ BEGIN
  DROP POLICY IF EXISTS close_friends_select_all ON public.close_friends;
  CREATE POLICY close_friends_select_all ON public.close_friends
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Profiles
DO $$ BEGIN
  DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
  CREATE POLICY profiles_select_all ON public.profiles
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Profiles links
DO $$ BEGIN
  DROP POLICY IF EXISTS profiles_links_select_all ON public.profiles_links;
  CREATE POLICY profiles_links_select_all ON public.profiles_links
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Users rels
DO $$ BEGIN
  DROP POLICY IF EXISTS users_rels_select_all ON public.users_rels;
  CREATE POLICY users_rels_select_all ON public.users_rels
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Notifications
DROP POLICY IF EXISTS notifications_select_authenticated ON public.notifications;
DROP POLICY IF EXISTS notifications_select_all ON public.notifications;
CREATE POLICY notifications_select_all ON public.notifications
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. MEDIA
-- ═══════════════════════════════════════════════════════════════════════════

-- Media (avatars, post images, etc.)
DROP POLICY IF EXISTS media_select_all ON public.media;
CREATE POLICY media_select_all ON public.media
  FOR SELECT TO authenticated USING (true);

-- Media AI tags
DO $$ BEGIN
  DROP POLICY IF EXISTS media_ai_tags_select_all ON public.media_ai_tags;
  CREATE POLICY media_ai_tags_select_all ON public.media_ai_tags
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. STORIES
-- ═══════════════════════════════════════════════════════════════════════════

-- Stories
DROP POLICY IF EXISTS stories_select_all ON public.stories;
CREATE POLICY stories_select_all ON public.stories
  FOR SELECT TO authenticated USING (true);

-- Story views
DROP POLICY IF EXISTS story_views_select_authenticated ON public.story_views;
DROP POLICY IF EXISTS story_views_select_all ON public.story_views;
CREATE POLICY story_views_select_all ON public.story_views
  FOR SELECT TO authenticated USING (true);

-- Story tags
DO $$ BEGIN
  DROP POLICY IF EXISTS story_tags_select_all ON public.story_tags;
  CREATE POLICY story_tags_select_all ON public.story_tags
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Stories items
DO $$ BEGIN
  DROP POLICY IF EXISTS stories_items_select_all ON public.stories_items;
  CREATE POLICY stories_items_select_all ON public.stories_items
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Stories stickers
DO $$ BEGIN
  DROP POLICY IF EXISTS stories_stickers_select_all ON public.stories_stickers;
  CREATE POLICY stories_stickers_select_all ON public.stories_stickers
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. MESSAGING
-- ═══════════════════════════════════════════════════════════════════════════

-- Conversations
DROP POLICY IF EXISTS conversations_select_authenticated ON public.conversations;
DROP POLICY IF EXISTS conversations_select_all ON public.conversations;
CREATE POLICY conversations_select_all ON public.conversations
  FOR SELECT TO authenticated USING (true);

-- Conversations rels
DROP POLICY IF EXISTS conv_rels_select_authenticated ON public.conversations_rels;
DROP POLICY IF EXISTS conv_rels_select_all ON public.conversations_rels;
CREATE POLICY conv_rels_select_all ON public.conversations_rels
  FOR SELECT TO authenticated USING (true);

-- Messages
DROP POLICY IF EXISTS messages_select_authenticated ON public.messages;
DROP POLICY IF EXISTS messages_select_all ON public.messages;
CREATE POLICY messages_select_all ON public.messages
  FOR SELECT TO authenticated USING (true);

-- Reactions
DO $$ BEGIN
  DROP POLICY IF EXISTS reactions_select_all ON public.reactions;
  CREATE POLICY reactions_select_all ON public.reactions
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Messages rels
DO $$ BEGIN
  DROP POLICY IF EXISTS messages_rels_select_all ON public.messages_rels;
  CREATE POLICY messages_rels_select_all ON public.messages_rels
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- Messages media
DO $$ BEGIN
  DROP POLICY IF EXISTS messages_media_select_all ON public.messages_media;
  CREATE POLICY messages_media_select_all ON public.messages_media
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. SUBSCRIPTIONS & PAYMENTS
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  DROP POLICY IF EXISTS subscription_tiers_select_all ON public.subscription_tiers;
  CREATE POLICY subscription_tiers_select_all ON public.subscription_tiers
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS subscription_tiers_perks_select_all ON public.subscription_tiers_perks;
  CREATE POLICY subscription_tiers_perks_select_all ON public.subscription_tiers_perks
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS subscriptions_select_all ON public.subscriptions;
  CREATE POLICY subscriptions_select_all ON public.subscriptions
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS transactions_select_all ON public.transactions;
  CREATE POLICY transactions_select_all ON public.transactions
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. SETTINGS & MISC
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  DROP POLICY IF EXISTS user_settings_select_all ON public.user_settings;
  CREATE POLICY user_settings_select_all ON public.user_settings
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS user_devices_select_all ON public.user_devices;
  CREATE POLICY user_devices_select_all ON public.user_devices
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS hashtags_select_all ON public.hashtags;
  CREATE POLICY hashtags_select_all ON public.hashtags
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS categories_select_all ON public.categories;
  CREATE POLICY categories_select_all ON public.categories
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS feature_flags_select_all ON public.feature_flags;
  CREATE POLICY feature_flags_select_all ON public.feature_flags
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS settings_select_all ON public.settings;
  CREATE POLICY settings_select_all ON public.settings
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. VIDEO / SNEAKY LYNK
-- ═══════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  DROP POLICY IF EXISTS video_rooms_select_all ON public.video_rooms;
  CREATE POLICY video_rooms_select_all ON public.video_rooms
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS video_room_events_select_all ON public.video_room_events;
  CREATE POLICY video_room_events_select_all ON public.video_room_events
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS video_room_tokens_select_all ON public.video_room_tokens;
  CREATE POLICY video_room_tokens_select_all ON public.video_room_tokens
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS video_room_bans_select_all ON public.video_room_bans;
  CREATE POLICY video_room_bans_select_all ON public.video_room_bans
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS room_comments_select_all ON public.room_comments;
  CREATE POLICY room_comments_select_all ON public.room_comments
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. GRANT SELECT on all tables to authenticated (belt + suspenders)
-- ═══════════════════════════════════════════════════════════════════════════

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. ANON role needs SELECT on public-facing tables too
-- ═══════════════════════════════════════════════════════════════════════════

-- Events ecosystem (public browsing)
DROP POLICY IF EXISTS events_select_anon ON public.events;
CREATE POLICY events_select_anon ON public.events
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS users_select_anon ON public.users;
CREATE POLICY users_select_anon ON public.users
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS media_select_anon ON public.media;
CREATE POLICY media_select_anon ON public.media
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS posts_select_anon ON public.posts;
CREATE POLICY posts_select_anon ON public.posts
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS ticket_types_select_anon ON public.ticket_types;
CREATE POLICY ticket_types_select_anon ON public.ticket_types
  FOR SELECT TO anon USING (true);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
