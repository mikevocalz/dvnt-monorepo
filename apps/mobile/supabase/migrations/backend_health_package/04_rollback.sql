-- ============================================================================
-- DVNT Backend Health — ROLLBACK
-- Reverses 02_apply.sql changes. Safe to run multiple times.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- R1. RESTORE DIRECT WRITE GRANTS (reverse Phase 2 lockdown)
-- Only run if Edge Functions are NOT yet handling all writes
-- ═══════════════════════════════════════════════════════════════════════════

GRANT INSERT, DELETE ON public.likes TO authenticated;
GRANT INSERT, DELETE ON public.bookmarks TO authenticated;
GRANT INSERT, DELETE ON public.event_likes TO authenticated;
GRANT INSERT, DELETE ON public.event_rsvps TO authenticated;
GRANT INSERT, UPDATE ON public.notifications TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.posts TO authenticated;
GRANT INSERT, DELETE ON public.posts_media TO authenticated;
GRANT INSERT, DELETE ON public.comments TO authenticated;
GRANT INSERT, DELETE ON public.stories TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT INSERT, UPDATE ON public.tickets TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- R2. DROP NEW INDEXES (only the ones added by 02_apply.sql)
-- These are additive/non-breaking so rollback is optional
-- ═══════════════════════════════════════════════════════════════════════════

-- NOTE: Only drop indexes if they cause performance issues.
-- Indexes are generally safe to keep. Uncomment if needed:

-- DROP INDEX IF EXISTS idx_messages_conv_created;
-- DROP INDEX IF EXISTS idx_messages_sender;
-- DROP INDEX IF EXISTS idx_messages_read_at;
-- DROP INDEX IF EXISTS idx_likes_post_id;
-- DROP INDEX IF EXISTS idx_likes_user_id;
-- DROP INDEX IF EXISTS idx_likes_user_post_unique;
-- DROP INDEX IF EXISTS idx_comments_post_created;
-- DROP INDEX IF EXISTS idx_comment_likes_user_comment_unique;
-- DROP INDEX IF EXISTS idx_follows_follower;
-- DROP INDEX IF EXISTS idx_follows_following;
-- DROP INDEX IF EXISTS idx_bookmarks_user_id;
-- DROP INDEX IF EXISTS idx_bookmarks_user_post_unique;
-- DROP INDEX IF EXISTS idx_notifications_recipient_created;
-- DROP INDEX IF EXISTS idx_notifications_unread;
-- DROP INDEX IF EXISTS idx_posts_author;
-- DROP INDEX IF EXISTS idx_stories_author_active;
-- DROP INDEX IF EXISTS idx_story_views_unique;
-- DROP INDEX IF EXISTS idx_events_start_date;
-- DROP INDEX IF EXISTS idx_event_rsvps_unique;
-- DROP INDEX IF EXISTS idx_event_likes_unique;
-- DROP INDEX IF EXISTS idx_tickets_event_user;
-- DROP INDEX IF EXISTS idx_tickets_qr_token;
-- DROP INDEX IF EXISTS idx_conv_rels_user;
-- DROP INDEX IF EXISTS idx_users_auth_id_unique;
-- DROP INDEX IF EXISTS idx_users_username_unique;

-- ═══════════════════════════════════════════════════════════════════════════
-- R3. DROP RECONCILIATION FUNCTION
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.reconcile_counters();

-- ═══════════════════════════════════════════════════════════════════════════
-- R4. DROP ADDED POLICIES (only the ones we created)
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS posts_select_public ON public.posts;
DROP POLICY IF EXISTS events_select_all ON public.events;
DROP POLICY IF EXISTS users_select_public ON public.users;
DROP POLICY IF EXISTS ticket_types_select_all ON public.ticket_types;
