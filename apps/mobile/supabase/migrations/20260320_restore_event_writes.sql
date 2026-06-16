-- ============================================================================
-- Restore client-side writes blocked by backend_health_package/02_apply.sql
-- That migration revoked INSERT/UPDATE/DELETE on many tables and enabled RLS
-- without adding write policies, breaking events, messaging, stories, etc.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. EVENTS — create, edit, delete
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO authenticated;

DROP POLICY IF EXISTS events_insert_authenticated ON public.events;
CREATE POLICY events_insert_authenticated ON public.events
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS events_update_own ON public.events;
CREATE POLICY events_update_own ON public.events
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS events_delete_own ON public.events;
CREATE POLICY events_delete_own ON public.events
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. EVENT_LIKES — like / unlike
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, DELETE ON public.event_likes TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE event_likes_id_seq TO authenticated;

DROP POLICY IF EXISTS event_likes_insert_authenticated ON public.event_likes;
CREATE POLICY event_likes_insert_authenticated ON public.event_likes
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS event_likes_delete_own ON public.event_likes;
CREATE POLICY event_likes_delete_own ON public.event_likes
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. EVENT_RSVPS — RSVP / update / cancel
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rsvps TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE event_rsvps_id_seq TO authenticated;

DROP POLICY IF EXISTS event_rsvps_select_authenticated ON public.event_rsvps;
CREATE POLICY event_rsvps_select_authenticated ON public.event_rsvps
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS event_rsvps_insert_authenticated ON public.event_rsvps;
CREATE POLICY event_rsvps_insert_authenticated ON public.event_rsvps
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS event_rsvps_update_own ON public.event_rsvps;
CREATE POLICY event_rsvps_update_own ON public.event_rsvps
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS event_rsvps_delete_own ON public.event_rsvps;
CREATE POLICY event_rsvps_delete_own ON public.event_rsvps
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. CONVERSATIONS — create group chats
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE conversations_id_seq TO authenticated;

DROP POLICY IF EXISTS conversations_select_authenticated ON public.conversations;
CREATE POLICY conversations_select_authenticated ON public.conversations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS conversations_insert_authenticated ON public.conversations;
CREATE POLICY conversations_insert_authenticated ON public.conversations
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS conversations_update_authenticated ON public.conversations;
CREATE POLICY conversations_update_authenticated ON public.conversations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. CONVERSATIONS_RELS — add members to conversations
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, DELETE ON public.conversations_rels TO authenticated;

DROP POLICY IF EXISTS conv_rels_select_authenticated ON public.conversations_rels;
CREATE POLICY conv_rels_select_authenticated ON public.conversations_rels
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS conv_rels_insert_authenticated ON public.conversations_rels;
CREATE POLICY conv_rels_insert_authenticated ON public.conversations_rels
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS conv_rels_delete_authenticated ON public.conversations_rels;
CREATE POLICY conv_rels_delete_authenticated ON public.conversations_rels
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. MESSAGES — edit / delete own messages
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE messages_id_seq TO authenticated;

DROP POLICY IF EXISTS messages_select_authenticated ON public.messages;
CREATE POLICY messages_select_authenticated ON public.messages
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS messages_insert_authenticated ON public.messages;
CREATE POLICY messages_insert_authenticated ON public.messages
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS messages_update_authenticated ON public.messages;
CREATE POLICY messages_update_authenticated ON public.messages
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS messages_delete_authenticated ON public.messages;
CREATE POLICY messages_delete_authenticated ON public.messages
  FOR DELETE TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. STORIES — update visibility
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, UPDATE ON public.stories TO authenticated;

DROP POLICY IF EXISTS stories_update_own ON public.stories;
CREATE POLICY stories_update_own ON public.stories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. STORY_VIEWS — record views
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT ON public.story_views TO authenticated;

DROP POLICY IF EXISTS story_views_select_authenticated ON public.story_views;
CREATE POLICY story_views_select_authenticated ON public.story_views
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS story_views_insert_authenticated ON public.story_views;
CREATE POLICY story_views_insert_authenticated ON public.story_views
  FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. NOTIFICATIONS — mark as read
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, UPDATE ON public.notifications TO authenticated;

DROP POLICY IF EXISTS notifications_select_authenticated ON public.notifications;
CREATE POLICY notifications_select_authenticated ON public.notifications
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS notifications_update_authenticated ON public.notifications;
CREATE POLICY notifications_update_authenticated ON public.notifications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. TICKET_TYPES — organizer creates/updates ticket tiers
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON public.ticket_types TO authenticated;

DROP POLICY IF EXISTS ticket_types_insert_authenticated ON public.ticket_types;
CREATE POLICY ticket_types_insert_authenticated ON public.ticket_types
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS ticket_types_update_authenticated ON public.ticket_types;
CREATE POLICY ticket_types_update_authenticated ON public.ticket_types
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. MEDIA — ensure reads still work
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT ON public.media TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. COMMENT_LIKES — ensure reads still work
-- ═══════════════════════════════════════════════════════════════════════════
GRANT SELECT ON public.comment_likes TO authenticated;

DROP POLICY IF EXISTS comment_likes_select_authenticated ON public.comment_likes;
CREATE POLICY comment_likes_select_authenticated ON public.comment_likes
  FOR SELECT TO authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Ensure service_role retains full access
-- ═══════════════════════════════════════════════════════════════════════════
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
