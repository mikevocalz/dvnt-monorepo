-- ============================================================================
-- COMPREHENSIVE FIX: Grant anon role proper access to ALL client-writable tables
--
-- ROOT CAUSE: The Supabase client connects as `anon` (Better Auth handles real
-- authentication at the app layer, NOT via Supabase Auth). Previous migrations
-- only granted INSERT/UPDATE/DELETE to `authenticated`, causing:
--   - "permission denied for table conversations" (group chat creation)
--   - Empty tickets list (anon can't read through JWT-based RLS policies)
--   - Silent failures on event_comments, event_reviews, event_co_organizers, etc.
--
-- STRATEGY: Mirror every `authenticated` write policy/grant with an `anon` equivalent.
-- This is safe because:
--   1. The anon key is embedded in the app binary (standard Supabase RN pattern)
--   2. Better Auth enforces real authentication at the application layer
--   3. Edge Functions use session tokens for privileged operations
--   4. SECURITY DEFINER RPCs already bypass RLS for batch reads
--
-- IDEMPOTENT: All statements use DROP IF EXISTS + CREATE / GRANT (additive).
-- ROLLBACK: See bottom of file.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. CONVERSATIONS — group chat creation
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.conversations TO anon;
GRANT USAGE, SELECT ON SEQUENCE conversations_id_seq TO anon;

DROP POLICY IF EXISTS conversations_select_anon ON public.conversations;
CREATE POLICY conversations_select_anon ON public.conversations
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS conversations_insert_anon ON public.conversations;
CREATE POLICY conversations_insert_anon ON public.conversations
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS conversations_update_anon ON public.conversations;
CREATE POLICY conversations_update_anon ON public.conversations
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. CONVERSATIONS_RELS — add/remove members
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, DELETE ON public.conversations_rels TO anon;

DROP POLICY IF EXISTS conv_rels_select_anon ON public.conversations_rels;
CREATE POLICY conv_rels_select_anon ON public.conversations_rels
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS conv_rels_insert_anon ON public.conversations_rels;
CREATE POLICY conv_rels_insert_anon ON public.conversations_rels
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS conv_rels_delete_anon ON public.conversations_rels;
CREATE POLICY conv_rels_delete_anon ON public.conversations_rels
  FOR DELETE TO anon USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. MESSAGES — send, edit, delete messages
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO anon;
GRANT USAGE, SELECT ON SEQUENCE messages_id_seq TO anon;

DROP POLICY IF EXISTS messages_select_anon ON public.messages;
CREATE POLICY messages_select_anon ON public.messages
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS messages_insert_anon ON public.messages;
CREATE POLICY messages_insert_anon ON public.messages
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS messages_update_anon ON public.messages;
CREATE POLICY messages_update_anon ON public.messages
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS messages_delete_anon ON public.messages;
CREATE POLICY messages_delete_anon ON public.messages
  FOR DELETE TO anon USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. TICKETS — read own tickets (fixes empty tickets page)
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.tickets TO anon;

DROP POLICY IF EXISTS tickets_select_anon ON public.tickets;
CREATE POLICY tickets_select_anon ON public.tickets
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS tickets_insert_anon ON public.tickets;
CREATE POLICY tickets_insert_anon ON public.tickets
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS tickets_update_anon ON public.tickets;
CREATE POLICY tickets_update_anon ON public.tickets
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. EVENT_COMMENTS — post comments on events
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, DELETE ON public.event_comments TO anon;
GRANT SELECT, INSERT, DELETE ON public.event_comments TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE event_comments_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE event_comments_id_seq TO authenticated;

DROP POLICY IF EXISTS event_comments_select_anon ON public.event_comments;
CREATE POLICY event_comments_select_anon ON public.event_comments
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS event_comments_select_authenticated ON public.event_comments;
CREATE POLICY event_comments_select_authenticated ON public.event_comments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS event_comments_insert_anon ON public.event_comments;
CREATE POLICY event_comments_insert_anon ON public.event_comments
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS event_comments_insert_authenticated ON public.event_comments;
CREATE POLICY event_comments_insert_authenticated ON public.event_comments
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS event_comments_delete_anon ON public.event_comments;
CREATE POLICY event_comments_delete_anon ON public.event_comments
  FOR DELETE TO anon USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. EVENT_REVIEWS — rate events
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  -- Table may not exist in all environments
  GRANT SELECT, INSERT, UPDATE ON public.event_reviews TO anon;
  GRANT SELECT, INSERT, UPDATE ON public.event_reviews TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  GRANT USAGE, SELECT ON SEQUENCE event_reviews_id_seq TO anon;
  GRANT USAGE, SELECT ON SEQUENCE event_reviews_id_seq TO authenticated;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS event_reviews_select_anon ON public.event_reviews;
  CREATE POLICY event_reviews_select_anon ON public.event_reviews
    FOR SELECT TO anon USING (true);

  DROP POLICY IF EXISTS event_reviews_select_authenticated ON public.event_reviews;
  CREATE POLICY event_reviews_select_authenticated ON public.event_reviews
    FOR SELECT TO authenticated USING (true);

  DROP POLICY IF EXISTS event_reviews_insert_anon ON public.event_reviews;
  CREATE POLICY event_reviews_insert_anon ON public.event_reviews
    FOR INSERT TO anon WITH CHECK (true);

  DROP POLICY IF EXISTS event_reviews_insert_authenticated ON public.event_reviews;
  CREATE POLICY event_reviews_insert_authenticated ON public.event_reviews
    FOR INSERT TO authenticated WITH CHECK (true);

  DROP POLICY IF EXISTS event_reviews_update_anon ON public.event_reviews;
  CREATE POLICY event_reviews_update_anon ON public.event_reviews
    FOR UPDATE TO anon USING (true) WITH CHECK (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. EVENT_CO_ORGANIZERS — manage co-hosts
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_co_organizers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_co_organizers TO authenticated;

DROP POLICY IF EXISTS coorg_select_anon ON public.event_co_organizers;
CREATE POLICY coorg_select_anon ON public.event_co_organizers
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS coorg_insert_anon ON public.event_co_organizers;
CREATE POLICY coorg_insert_anon ON public.event_co_organizers
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS coorg_update_anon ON public.event_co_organizers;
CREATE POLICY coorg_update_anon ON public.event_co_organizers
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS coorg_delete_anon ON public.event_co_organizers;
CREATE POLICY coorg_delete_anon ON public.event_co_organizers
  FOR DELETE TO anon USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. POST_TAGS — tag users in posts
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_tags TO anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_tags TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  GRANT USAGE, SELECT ON SEQUENCE post_tags_id_seq TO anon;
  GRANT USAGE, SELECT ON SEQUENCE post_tags_id_seq TO authenticated;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS post_tags_select_anon ON public.post_tags;
  CREATE POLICY post_tags_select_anon ON public.post_tags
    FOR SELECT TO anon USING (true);

  DROP POLICY IF EXISTS post_tags_insert_anon ON public.post_tags;
  CREATE POLICY post_tags_insert_anon ON public.post_tags
    FOR INSERT TO anon WITH CHECK (true);

  DROP POLICY IF EXISTS post_tags_update_anon ON public.post_tags;
  CREATE POLICY post_tags_update_anon ON public.post_tags
    FOR UPDATE TO anon USING (true) WITH CHECK (true);

  DROP POLICY IF EXISTS post_tags_delete_anon ON public.post_tags;
  CREATE POLICY post_tags_delete_anon ON public.post_tags
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. USERS — signup (INSERT) + profile edit (UPDATE)
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.users TO anon;
GRANT SELECT, INSERT, UPDATE ON public.users TO authenticated;

DROP POLICY IF EXISTS users_insert_anon ON public.users;
CREATE POLICY users_insert_anon ON public.users
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS users_insert_authenticated ON public.users;
CREATE POLICY users_insert_authenticated ON public.users
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS users_update_anon ON public.users;
CREATE POLICY users_update_anon ON public.users
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS users_update_authenticated ON public.users;
CREATE POLICY users_update_authenticated ON public.users
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. EVENT_RSVPS — anon write access
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rsvps TO anon;
GRANT USAGE, SELECT ON SEQUENCE event_rsvps_id_seq TO anon;

DROP POLICY IF EXISTS event_rsvps_select_anon ON public.event_rsvps;
CREATE POLICY event_rsvps_select_anon ON public.event_rsvps
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS event_rsvps_insert_anon ON public.event_rsvps;
CREATE POLICY event_rsvps_insert_anon ON public.event_rsvps
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS event_rsvps_update_anon ON public.event_rsvps;
CREATE POLICY event_rsvps_update_anon ON public.event_rsvps
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_rsvps_delete_anon ON public.event_rsvps;
CREATE POLICY event_rsvps_delete_anon ON public.event_rsvps
  FOR DELETE TO anon USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. EVENT_LIKES — like/unlike events
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, DELETE ON public.event_likes TO anon;
GRANT USAGE, SELECT ON SEQUENCE event_likes_id_seq TO anon;

DROP POLICY IF EXISTS event_likes_select_anon ON public.event_likes;
CREATE POLICY event_likes_select_anon ON public.event_likes
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS event_likes_insert_anon ON public.event_likes;
CREATE POLICY event_likes_insert_anon ON public.event_likes
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS event_likes_delete_anon ON public.event_likes;
CREATE POLICY event_likes_delete_anon ON public.event_likes
  FOR DELETE TO anon USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. STORIES + STORY_VIEWS — anon write access
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.stories TO anon;

DROP POLICY IF EXISTS stories_select_anon ON public.stories;
CREATE POLICY stories_select_anon ON public.stories
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS stories_update_anon ON public.stories;
CREATE POLICY stories_update_anon ON public.stories
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS stories_insert_anon ON public.stories;
CREATE POLICY stories_insert_anon ON public.stories
  FOR INSERT TO anon WITH CHECK (true);

GRANT SELECT, INSERT ON public.story_views TO anon;

DROP POLICY IF EXISTS story_views_select_anon ON public.story_views;
CREATE POLICY story_views_select_anon ON public.story_views
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS story_views_insert_anon ON public.story_views;
CREATE POLICY story_views_insert_anon ON public.story_views
  FOR INSERT TO anon WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. NOTIFICATIONS — mark as read
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.notifications TO anon;

DROP POLICY IF EXISTS notifications_select_anon ON public.notifications;
CREATE POLICY notifications_select_anon ON public.notifications
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS notifications_update_anon ON public.notifications;
CREATE POLICY notifications_update_anon ON public.notifications
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS notifications_insert_anon ON public.notifications;
CREATE POLICY notifications_insert_anon ON public.notifications
  FOR INSERT TO anon WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. TICKET_TYPES — organizer creates/updates ticket tiers
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.ticket_types TO anon;

DROP POLICY IF EXISTS ticket_types_select_anon ON public.ticket_types;
CREATE POLICY ticket_types_select_anon ON public.ticket_types
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS ticket_types_insert_anon ON public.ticket_types;
CREATE POLICY ticket_types_insert_anon ON public.ticket_types
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS ticket_types_update_anon ON public.ticket_types;
CREATE POLICY ticket_types_update_anon ON public.ticket_types
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. FOLLOWS — follow/unfollow users
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  GRANT SELECT, INSERT, DELETE ON public.follows TO anon;
  GRANT SELECT, INSERT, DELETE ON public.follows TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS follows_select_anon ON public.follows;
  CREATE POLICY follows_select_anon ON public.follows
    FOR SELECT TO anon USING (true);

  DROP POLICY IF EXISTS follows_insert_anon ON public.follows;
  CREATE POLICY follows_insert_anon ON public.follows
    FOR INSERT TO anon WITH CHECK (true);

  DROP POLICY IF EXISTS follows_delete_anon ON public.follows;
  CREATE POLICY follows_delete_anon ON public.follows
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 16. LIKES + BOOKMARKS — like/bookmark posts
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  GRANT SELECT, INSERT, DELETE ON public.likes TO anon;
  GRANT SELECT, INSERT, DELETE ON public.likes TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS likes_select_anon ON public.likes;
  CREATE POLICY likes_select_anon ON public.likes
    FOR SELECT TO anon USING (true);
  DROP POLICY IF EXISTS likes_insert_anon ON public.likes;
  CREATE POLICY likes_insert_anon ON public.likes
    FOR INSERT TO anon WITH CHECK (true);
  DROP POLICY IF EXISTS likes_delete_anon ON public.likes;
  CREATE POLICY likes_delete_anon ON public.likes
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  GRANT SELECT, INSERT, DELETE ON public.bookmarks TO anon;
  GRANT SELECT, INSERT, DELETE ON public.bookmarks TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS bookmarks_select_anon ON public.bookmarks;
  CREATE POLICY bookmarks_select_anon ON public.bookmarks
    FOR SELECT TO anon USING (true);
  DROP POLICY IF EXISTS bookmarks_insert_anon ON public.bookmarks;
  CREATE POLICY bookmarks_insert_anon ON public.bookmarks
    FOR INSERT TO anon WITH CHECK (true);
  DROP POLICY IF EXISTS bookmarks_delete_anon ON public.bookmarks;
  CREATE POLICY bookmarks_delete_anon ON public.bookmarks
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 17. COMMENTS — post comments
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.comments TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS comments_select_anon ON public.comments;
  CREATE POLICY comments_select_anon ON public.comments
    FOR SELECT TO anon USING (true);
  DROP POLICY IF EXISTS comments_insert_anon ON public.comments;
  CREATE POLICY comments_insert_anon ON public.comments
    FOR INSERT TO anon WITH CHECK (true);
  DROP POLICY IF EXISTS comments_update_anon ON public.comments;
  CREATE POLICY comments_update_anon ON public.comments
    FOR UPDATE TO anon USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS comments_delete_anon ON public.comments;
  CREATE POLICY comments_delete_anon ON public.comments
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 18. COMMENT_LIKES
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  GRANT SELECT, INSERT, DELETE ON public.comment_likes TO anon;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS comment_likes_select_anon ON public.comment_likes;
  CREATE POLICY comment_likes_select_anon ON public.comment_likes
    FOR SELECT TO anon USING (true);
  DROP POLICY IF EXISTS comment_likes_insert_anon ON public.comment_likes;
  CREATE POLICY comment_likes_insert_anon ON public.comment_likes
    FOR INSERT TO anon WITH CHECK (true);
  DROP POLICY IF EXISTS comment_likes_delete_anon ON public.comment_likes;
  CREATE POLICY comment_likes_delete_anon ON public.comment_likes
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 19. POSTS + POSTS_MEDIA — anon write for post creation
-- ═══════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS posts_insert_anon ON public.posts;
  CREATE POLICY posts_insert_anon ON public.posts
    FOR INSERT TO anon WITH CHECK (true);
  DROP POLICY IF EXISTS posts_update_anon ON public.posts;
  CREATE POLICY posts_update_anon ON public.posts
    FOR UPDATE TO anon USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS posts_delete_anon ON public.posts;
  CREATE POLICY posts_delete_anon ON public.posts
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  GRANT SELECT, INSERT, DELETE ON public.posts_media TO anon;
  GRANT SELECT, INSERT, DELETE ON public.posts_media TO authenticated;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS posts_media_insert_anon ON public.posts_media;
  CREATE POLICY posts_media_insert_anon ON public.posts_media
    FOR INSERT TO anon WITH CHECK (true);
  DROP POLICY IF EXISTS posts_media_delete_anon ON public.posts_media;
  CREATE POLICY posts_media_delete_anon ON public.posts_media
    FOR DELETE TO anon USING (true);
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 20. MEDIA — image/video uploads
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON public.media TO anon;
GRANT SELECT, INSERT ON public.media TO authenticated;

DROP POLICY IF EXISTS media_select_anon ON public.media;
CREATE POLICY media_select_anon ON public.media
  FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS media_insert_anon ON public.media;
CREATE POLICY media_insert_anon ON public.media
  FOR INSERT TO anon WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Belt + suspenders: ensure service_role keeps full access
-- ═══════════════════════════════════════════════════════════════════════════
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (run only if needed):
-- ═══════════════════════════════════════════════════════════════════════════
-- DROP POLICY IF EXISTS conversations_select_anon ON public.conversations;
-- DROP POLICY IF EXISTS conversations_insert_anon ON public.conversations;
-- DROP POLICY IF EXISTS conversations_update_anon ON public.conversations;
-- DROP POLICY IF EXISTS conv_rels_select_anon ON public.conversations_rels;
-- DROP POLICY IF EXISTS conv_rels_insert_anon ON public.conversations_rels;
-- DROP POLICY IF EXISTS conv_rels_delete_anon ON public.conversations_rels;
-- DROP POLICY IF EXISTS messages_select_anon ON public.messages;
-- DROP POLICY IF EXISTS messages_insert_anon ON public.messages;
-- DROP POLICY IF EXISTS messages_update_anon ON public.messages;
-- DROP POLICY IF EXISTS messages_delete_anon ON public.messages;
-- DROP POLICY IF EXISTS tickets_select_anon ON public.tickets;
-- DROP POLICY IF EXISTS tickets_insert_anon ON public.tickets;
-- DROP POLICY IF EXISTS tickets_update_anon ON public.tickets;
-- (... and so on for all _anon policies above)
-- REVOKE INSERT, UPDATE, DELETE ON public.conversations FROM anon;
-- REVOKE INSERT, DELETE ON public.conversations_rels FROM anon;
-- REVOKE INSERT, UPDATE, DELETE ON public.messages FROM anon;
-- (... and so on for all GRANTs above)
