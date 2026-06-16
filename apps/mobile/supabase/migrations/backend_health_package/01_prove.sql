-- ============================================================================
-- DVNT Backend Audit — PROVE (Runnable Diagnostic SQL)
-- Run against Supabase SQL Editor. Non-destructive SELECT-only queries.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. SCHEMA & MIGRATION DRIFT
-- ═══════════════════════════════════════════════════════════════════════════

-- 1.1 Tables without RLS enabled (CRITICAL — should be empty for public schema)
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename NOT IN ('spatial_ref_sys', 'geometry_columns', 'geography_columns')
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = tablename AND n.nspname = schemaname AND c.relrowsecurity = true
  )
ORDER BY tablename;

-- 1.2 Tables WITH RLS enabled but NO policies (data is invisible to all)
SELECT c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname AND p.schemaname = 'public'
  )
ORDER BY c.relname;

-- 1.3 Missing NOT NULL constraints on critical FK columns
SELECT table_name, column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('user_id', 'author_id', 'host_id', 'post_id', 'event_id',
                       'sender_id', 'conversation_id', 'follower_id', 'following_id',
                       'recipient_id', 'actor_id', 'ticket_type_id')
  AND is_nullable = 'YES'
ORDER BY table_name, column_name;

-- 1.4 Missing indexes on foreign key columns (causes slow JOINs)
SELECT
  tc.table_name,
  kcu.column_name AS fk_column,
  CASE WHEN idx.indexname IS NOT NULL THEN 'INDEXED' ELSE '⚠️ NO INDEX' END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
LEFT JOIN pg_indexes idx
  ON idx.tablename = tc.table_name
  AND idx.indexdef LIKE '%' || kcu.column_name || '%'
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- 1.5 Recently created/modified objects (last 30 days of migrations)
SELECT
  c.relname AS object_name,
  CASE c.relkind WHEN 'r' THEN 'table' WHEN 'i' THEN 'index' WHEN 'v' THEN 'view' WHEN 'S' THEN 'sequence' ELSE c.relkind::text END AS kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'v')
ORDER BY c.oid DESC
LIMIT 30;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RLS & POLICY CORRECTNESS
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1 All policies — look for permissive "qual = true" anti-pattern
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 2.2 Tables with INSERT/UPDATE/DELETE policies for 'authenticated' (potential direct writes)
-- These should ONLY exist if the table is explicitly allowed for client writes
SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  AND roles::text LIKE '%authenticated%'
ORDER BY tablename, cmd;

-- 2.3 GRANT analysis — which roles can write to which tables?
SELECT
  grantee,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  AND grantee IN ('authenticated', 'anon')
ORDER BY table_name, grantee, privilege_type;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. DATA INTEGRITY
-- ═══════════════════════════════════════════════════════════════════════════

-- 3.1 Orphaned conversations_rels (users_id not in users.auth_id)
SELECT cr.parent_id, cr.users_id
FROM conversations_rels cr
WHERE cr.users_id IS NOT NULL
  AND cr.users_id NOT IN (SELECT auth_id FROM users WHERE auth_id IS NOT NULL)
LIMIT 20;

-- 3.2 Users missing auth_id (broken identity mapping)
SELECT id, username, email, auth_id, created_at
FROM users
WHERE auth_id IS NULL OR auth_id = ''
ORDER BY created_at DESC
LIMIT 20;

-- 3.3 Duplicate auth_id in users table (CRITICAL — should be 0)
SELECT auth_id, COUNT(*) AS cnt
FROM users
WHERE auth_id IS NOT NULL AND auth_id != ''
GROUP BY auth_id
HAVING COUNT(*) > 1;

-- 3.4 Tickets with user_id that doesn't match any user auth_id or integer id
SELECT t.id, t.user_id, t.event_id, t.status, t.created_at
FROM tickets t
WHERE t.user_id NOT IN (SELECT auth_id FROM users WHERE auth_id IS NOT NULL)
  AND t.user_id NOT IN (SELECT id::text FROM users)
LIMIT 20;

-- 3.5 Orphaned likes (post deleted but like row remains)
SELECT l.id, l.post_id, l.user_id
FROM likes l
LEFT JOIN posts p ON p.id = l.post_id
WHERE p.id IS NULL
LIMIT 20;

-- 3.6 Orphaned comments (post deleted but comment remains)
SELECT c.id, c.post_id, c.author_id
FROM comments c
LEFT JOIN posts p ON p.id = c.post_id
WHERE p.id IS NULL
LIMIT 20;

-- 3.7 Orphaned follows (user deleted but follow row remains)
SELECT f.id, f.follower_id, f.following_id
FROM follows f
LEFT JOIN users u1 ON u1.id = f.follower_id
LEFT JOIN users u2 ON u2.id = f.following_id
WHERE u1.id IS NULL OR u2.id IS NULL
LIMIT 20;

-- 3.8 Messages with null or empty content (potential blank message bug)
SELECT id, conversation_id, sender_id, content, created_at
FROM messages
WHERE content IS NULL OR content = ''
ORDER BY created_at DESC
LIMIT 20;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. COUNTER INTEGRITY (CRITICAL for regression prevention)
-- ═══════════════════════════════════════════════════════════════════════════

-- 4.1 Posts where likes_count != actual likes rows
SELECT
  p.id AS post_id,
  p.likes_count AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  p.likes_count - COALESCE(actual.cnt, 0) AS drift
FROM posts p
LEFT JOIN (
  SELECT post_id, COUNT(*) AS cnt FROM likes GROUP BY post_id
) actual ON actual.post_id = p.id
WHERE p.likes_count != COALESCE(actual.cnt, 0)
ORDER BY ABS(p.likes_count - COALESCE(actual.cnt, 0)) DESC
LIMIT 50;

-- 4.2 Posts where comments_count != actual comments rows
SELECT
  p.id AS post_id,
  p.comments_count AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  p.comments_count - COALESCE(actual.cnt, 0) AS drift
FROM posts p
LEFT JOIN (
  SELECT post_id, COUNT(*) AS cnt FROM comments GROUP BY post_id
) actual ON actual.post_id = p.id
WHERE p.comments_count != COALESCE(actual.cnt, 0)
ORDER BY ABS(p.comments_count - COALESCE(actual.cnt, 0)) DESC
LIMIT 50;

-- 4.3 Users where followers_count != actual follows rows
SELECT
  u.id AS user_id,
  u.username,
  u.followers_count AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  u.followers_count - COALESCE(actual.cnt, 0) AS drift
FROM users u
LEFT JOIN (
  SELECT following_id, COUNT(*) AS cnt FROM follows GROUP BY following_id
) actual ON actual.following_id = u.id
WHERE u.followers_count != COALESCE(actual.cnt, 0)
ORDER BY ABS(u.followers_count - COALESCE(actual.cnt, 0)) DESC
LIMIT 50;

-- 4.4 Users where following_count != actual follows rows
SELECT
  u.id AS user_id,
  u.username,
  u.following_count AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  u.following_count - COALESCE(actual.cnt, 0) AS drift
FROM users u
LEFT JOIN (
  SELECT follower_id, COUNT(*) AS cnt FROM follows GROUP BY follower_id
) actual ON actual.follower_id = u.id
WHERE u.following_count != COALESCE(actual.cnt, 0)
ORDER BY ABS(u.following_count - COALESCE(actual.cnt, 0)) DESC
LIMIT 50;

-- 4.5 Comments where likes_count != actual comment_likes rows
SELECT
  c.id AS comment_id,
  c.likes_count AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  c.likes_count - COALESCE(actual.cnt, 0) AS drift
FROM comments c
LEFT JOIN (
  SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id
) actual ON actual.comment_id = c.id
WHERE c.likes_count != COALESCE(actual.cnt, 0)
ORDER BY ABS(c.likes_count - COALESCE(actual.cnt, 0)) DESC
LIMIT 50;

-- 4.6 Users where posts_count != actual posts rows
SELECT
  u.id AS user_id,
  u.username,
  COALESCE(u.posts_count, 0) AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  COALESCE(u.posts_count, 0) - COALESCE(actual.cnt, 0) AS drift
FROM users u
LEFT JOIN (
  SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id
) actual ON actual.author_id = u.id
WHERE COALESCE(u.posts_count, 0) != COALESCE(actual.cnt, 0)
ORDER BY ABS(COALESCE(u.posts_count, 0) - COALESCE(actual.cnt, 0)) DESC
LIMIT 50;

-- 4.7 Ticket types where quantity_sold != actual tickets
SELECT
  tt.id AS ticket_type_id,
  tt.name,
  tt.quantity_sold AS cached_count,
  COALESCE(actual.cnt, 0) AS actual_count,
  tt.quantity_sold - COALESCE(actual.cnt, 0) AS drift
FROM ticket_types tt
LEFT JOIN (
  SELECT ticket_type_id, COUNT(*) AS cnt
  FROM tickets
  WHERE status NOT IN ('cancelled', 'refunded')
  GROUP BY ticket_type_id
) actual ON actual.ticket_type_id = tt.id
WHERE tt.quantity_sold != COALESCE(actual.cnt, 0)
LIMIT 50;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. PERFORMANCE — Missing indexes for hot query paths
-- ═══════════════════════════════════════════════════════════════════════════

-- 5.1 Check existing indexes on core tables
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'likes', 'comments', 'follows', 'messages',
                     'conversations_rels', 'tickets', 'event_likes', 'event_rsvps',
                     'bookmarks', 'notifications', 'stories', 'story_views',
                     'comment_likes', 'users')
ORDER BY tablename, indexname;

-- 5.2 Table sizes (identify large tables that need attention)
SELECT
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
  n_live_tup AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relname = c.relname
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 30;

-- 5.3 Sequential scans on large tables (performance red flags)
SELECT
  relname,
  seq_scan,
  seq_tup_read,
  idx_scan,
  idx_tup_fetch,
  n_live_tup,
  CASE WHEN seq_scan > 0 THEN seq_tup_read / seq_scan ELSE 0 END AS avg_seq_tup
FROM pg_stat_user_tables
WHERE schemaname = 'public'
  AND n_live_tup > 1000
ORDER BY seq_tup_read DESC
LIMIT 20;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. IDENTITY MAPPING AUDIT
-- ═══════════════════════════════════════════════════════════════════════════

-- 6.1 Count of Better Auth sessions (should match active users)
SELECT COUNT(*) AS total_sessions,
       COUNT(CASE WHEN "expiresAt" > NOW() THEN 1 END) AS active_sessions
FROM session;

-- 6.2 Better Auth accounts linked to DVNT users
SELECT
  u.id AS dvnt_user_id,
  u.auth_id,
  u.username,
  a.id AS better_auth_account_id,
  a."providerId"
FROM users u
LEFT JOIN account a ON a."userId" = u.auth_id
ORDER BY u.id
LIMIT 20;

-- 6.3 Summary counts for audit
SELECT 'users' AS entity, COUNT(*) AS total FROM users
UNION ALL SELECT 'posts', COUNT(*) FROM posts
UNION ALL SELECT 'likes', COUNT(*) FROM likes
UNION ALL SELECT 'comments', COUNT(*) FROM comments
UNION ALL SELECT 'follows', COUNT(*) FROM follows
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'conversations_rels', COUNT(*) FROM conversations_rels
UNION ALL SELECT 'tickets', COUNT(*) FROM tickets
UNION ALL SELECT 'events', COUNT(*) FROM events
UNION ALL SELECT 'event_rsvps', COUNT(*) FROM event_rsvps
UNION ALL SELECT 'event_likes', COUNT(*) FROM event_likes
UNION ALL SELECT 'bookmarks', COUNT(*) FROM bookmarks
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'stories', COUNT(*) FROM stories
UNION ALL SELECT 'comment_likes', COUNT(*) FROM comment_likes
ORDER BY entity;
