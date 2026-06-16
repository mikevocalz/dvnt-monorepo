-- ============================================================================
-- DVNT Database Contract Tests
-- Run after ANY migration or data change to verify invariants hold.
-- Each test returns 0 rows on success, or failing rows on violation.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-1: IDENTITY — No duplicate auth_ids (STOP-THE-LINE)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-1 FAIL: duplicate auth_id' AS test, auth_id, COUNT(*) AS cnt
FROM users
WHERE auth_id IS NOT NULL AND auth_id != ''
GROUP BY auth_id
HAVING COUNT(*) > 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-2: LIKES COUNT — posts.likes_count matches actual likes rows
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-2 FAIL: likes_count drift' AS test, p.id, p.likes_count AS cached, COALESCE(a.cnt, 0) AS actual
FROM posts p
LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM likes GROUP BY post_id) a ON a.post_id = p.id
WHERE p.likes_count != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-3: COMMENTS COUNT — posts.comments_count matches actual comments rows
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-3 FAIL: comments_count drift' AS test, p.id, p.comments_count AS cached, COALESCE(a.cnt, 0) AS actual
FROM posts p
LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM comments GROUP BY post_id) a ON a.post_id = p.id
WHERE p.comments_count != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-4: FOLLOWERS COUNT — users.followers_count matches follows rows
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-4 FAIL: followers_count drift' AS test, u.id, u.username, u.followers_count AS cached, COALESCE(a.cnt, 0) AS actual
FROM users u
LEFT JOIN (SELECT following_id, COUNT(*) AS cnt FROM follows GROUP BY following_id) a ON a.following_id = u.id
WHERE u.followers_count != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-5: FOLLOWING COUNT — users.following_count matches follows rows
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-5 FAIL: following_count drift' AS test, u.id, u.username, u.following_count AS cached, COALESCE(a.cnt, 0) AS actual
FROM users u
LEFT JOIN (SELECT follower_id, COUNT(*) AS cnt FROM follows GROUP BY follower_id) a ON a.follower_id = u.id
WHERE u.following_count != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-6: POSTS COUNT — users.posts_count matches posts rows
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-6 FAIL: posts_count drift' AS test, u.id, u.username, COALESCE(u.posts_count, 0) AS cached, COALESCE(a.cnt, 0) AS actual
FROM users u
LEFT JOIN (SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id) a ON a.author_id = u.id
WHERE COALESCE(u.posts_count, 0) != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-7: COMMENT LIKES COUNT — comments.likes_count matches comment_likes rows
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-7 FAIL: comment likes_count drift' AS test, c.id, c.likes_count AS cached, COALESCE(a.cnt, 0) AS actual
FROM comments c
LEFT JOIN (SELECT comment_id, COUNT(*) AS cnt FROM comment_likes GROUP BY comment_id) a ON a.comment_id = c.id
WHERE c.likes_count != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-8: TICKET CONSISTENCY — ticket_types.quantity_sold matches tickets
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-8 FAIL: ticket quantity_sold drift' AS test, tt.id, tt.name, tt.quantity_sold AS cached, COALESCE(a.cnt, 0) AS actual
FROM ticket_types tt
LEFT JOIN (
  SELECT ticket_type_id, COUNT(*) AS cnt FROM tickets WHERE status NOT IN ('cancelled', 'refunded') GROUP BY ticket_type_id
) a ON a.ticket_type_id = tt.id
WHERE tt.quantity_sold != COALESCE(a.cnt, 0)
LIMIT 10;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-9: ORPHAN DETECTION — likes without valid post
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-9 FAIL: orphaned likes' AS test, l.id, l.post_id
FROM likes l LEFT JOIN posts p ON p.id = l.post_id
WHERE p.id IS NULL
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-10: ORPHAN DETECTION — comments without valid post
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-10 FAIL: orphaned comments' AS test, c.id, c.post_id
FROM comments c LEFT JOIN posts p ON p.id = c.post_id
WHERE p.id IS NULL
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-11: RLS ENABLED — all core tables have RLS
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-11 FAIL: missing RLS on ' || c.relname AS test
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false
  AND c.relname IN ('likes','bookmarks','event_likes','event_rsvps','notifications',
    'posts','posts_media','comments','stories','events','tickets','follows',
    'messages','conversations','conversations_rels','users','comment_likes',
    'story_views','media','ticket_types');

-- ═══════════════════════════════════════════════════════════════════════════
-- CT-12: NO BLANK MESSAGES — content must never be null/empty
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'CT-12 FAIL: blank message' AS test, id, conversation_id, created_at
FROM messages
WHERE content IS NULL OR content = ''
ORDER BY created_at DESC
LIMIT 5;
