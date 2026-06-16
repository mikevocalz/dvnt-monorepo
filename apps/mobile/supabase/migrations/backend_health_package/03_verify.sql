-- ============================================================================
-- DVNT Backend Health — VERIFY (Post-Apply Verification)
-- Run after 02_apply.sql. All queries should return 0 rows or expected values.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- V1. VERIFY INDEXES EXIST
-- ═══════════════════════════════════════════════════════════════════════════

SELECT 'INDEXES' AS section,
  COUNT(*) FILTER (WHERE indexname = 'idx_messages_conv_created') AS messages_conv,
  COUNT(*) FILTER (WHERE indexname = 'idx_likes_post_id') AS likes_post,
  COUNT(*) FILTER (WHERE indexname = 'idx_likes_user_post_unique') AS likes_unique,
  COUNT(*) FILTER (WHERE indexname = 'idx_follows_follower') AS follows_follower,
  COUNT(*) FILTER (WHERE indexname = 'idx_follows_following') AS follows_following,
  COUNT(*) FILTER (WHERE indexname = 'idx_users_auth_id_unique') AS users_auth_id,
  COUNT(*) FILTER (WHERE indexname = 'idx_posts_author') AS posts_author,
  COUNT(*) FILTER (WHERE indexname = 'idx_notifications_recipient_created') AS notif_recipient,
  COUNT(*) FILTER (WHERE indexname = 'idx_tickets_qr_token') AS tickets_qr
FROM pg_indexes
WHERE schemaname = 'public';

-- ═══════════════════════════════════════════════════════════════════════════
-- V2. VERIFY RLS IS ENABLED ON ALL CORE TABLES
-- Should return 0 rows (all tables have RLS)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT c.relname AS table_missing_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
  AND c.relname IN (
    'likes', 'bookmarks', 'event_likes', 'event_rsvps', 'notifications',
    'posts', 'posts_media', 'comments', 'stories', 'events', 'tickets',
    'follows', 'messages', 'conversations', 'conversations_rels', 'users',
    'comment_likes', 'story_views', 'media', 'ticket_types'
  );

-- ═══════════════════════════════════════════════════════════════════════════
-- V3. VERIFY NO DIRECT WRITE GRANTS FOR authenticated ON CORE TABLES
-- Should return 0 rows
-- ═══════════════════════════════════════════════════════════════════════════

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  AND grantee = 'authenticated'
  AND table_name IN (
    'likes', 'bookmarks', 'event_likes', 'event_rsvps', 'notifications',
    'posts', 'posts_media', 'comments', 'stories', 'events', 'tickets',
    'follows', 'comment_likes'
  )
ORDER BY table_name;

-- ═══════════════════════════════════════════════════════════════════════════
-- V4. VERIFY service_role CAN STILL WRITE (must return rows)
-- ═══════════════════════════════════════════════════════════════════════════

SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  AND grantee = 'service_role'
  AND table_name IN ('likes', 'follows', 'posts', 'comments', 'tickets')
ORDER BY table_name, privilege_type;

-- ═══════════════════════════════════════════════════════════════════════════
-- V5. VERIFY COUNTER RECONCILIATION FUNCTION EXISTS
-- ═══════════════════════════════════════════════════════════════════════════

SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'reconcile_counters';

-- ═══════════════════════════════════════════════════════════════════════════
-- V6. VERIFY COUNTER INTEGRITY (should return 0 rows after reconciliation)
-- ═══════════════════════════════════════════════════════════════════════════

-- Run reconciliation first
SELECT public.reconcile_counters();

-- Then verify no drift remains
SELECT 'likes_drift' AS check_name, COUNT(*) AS drifted
FROM posts p
LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM likes GROUP BY post_id) a ON a.post_id = p.id
WHERE p.likes_count != COALESCE(a.cnt, 0)

UNION ALL

SELECT 'comments_drift', COUNT(*)
FROM posts p
LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM comments GROUP BY post_id) a ON a.post_id = p.id
WHERE p.comments_count != COALESCE(a.cnt, 0)

UNION ALL

SELECT 'followers_drift', COUNT(*)
FROM users u
LEFT JOIN (SELECT following_id, COUNT(*) AS cnt FROM follows GROUP BY following_id) a ON a.following_id = u.id
WHERE u.followers_count != COALESCE(a.cnt, 0)

UNION ALL

SELECT 'following_drift', COUNT(*)
FROM users u
LEFT JOIN (SELECT follower_id, COUNT(*) AS cnt FROM follows GROUP BY follower_id) a ON a.follower_id = u.id
WHERE u.following_count != COALESCE(a.cnt, 0)

UNION ALL

SELECT 'posts_count_drift', COUNT(*)
FROM users u
LEFT JOIN (SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id) a ON a.author_id = u.id
WHERE COALESCE(u.posts_count, 0) != COALESCE(a.cnt, 0);

-- ═══════════════════════════════════════════════════════════════════════════
-- V7. VERIFY NO DUPLICATE IDENTITIES
-- Should return 0 rows
-- ═══════════════════════════════════════════════════════════════════════════

SELECT auth_id, COUNT(*) AS cnt
FROM users
WHERE auth_id IS NOT NULL AND auth_id != ''
GROUP BY auth_id
HAVING COUNT(*) > 1;
