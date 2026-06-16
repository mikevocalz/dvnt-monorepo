-- DVNT Full Audit — Single query, paste into Supabase SQL Editor and run once

WITH
likes_drift AS (
  SELECT p.id AS post_id, p.likes_count AS cached, COALESCE(a.cnt,0) AS actual
  FROM posts p LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM likes GROUP BY post_id) a ON a.post_id = p.id
  WHERE p.likes_count != COALESCE(a.cnt,0)
),
comments_drift AS (
  SELECT p.id AS post_id, p.comments_count AS cached, COALESCE(a.cnt,0) AS actual
  FROM posts p LEFT JOIN (SELECT post_id, COUNT(*) AS cnt FROM comments GROUP BY post_id) a ON a.post_id = p.id
  WHERE p.comments_count != COALESCE(a.cnt,0)
),
followers_drift AS (
  SELECT u.id AS user_id, u.username, u.followers_count AS cached, COALESCE(a.cnt,0) AS actual
  FROM users u LEFT JOIN (SELECT following_id, COUNT(*) AS cnt FROM follows GROUP BY following_id) a ON a.following_id = u.id
  WHERE u.followers_count != COALESCE(a.cnt,0)
),
following_drift AS (
  SELECT u.id AS user_id, u.username, u.following_count AS cached, COALESCE(a.cnt,0) AS actual
  FROM users u LEFT JOIN (SELECT follower_id, COUNT(*) AS cnt FROM follows GROUP BY follower_id) a ON a.follower_id = u.id
  WHERE u.following_count != COALESCE(a.cnt,0)
),
posts_count_drift AS (
  SELECT u.id AS user_id, u.username, COALESCE(u.posts_count,0) AS cached, COALESCE(a.cnt,0) AS actual
  FROM users u LEFT JOIN (SELECT author_id, COUNT(*) AS cnt FROM posts GROUP BY author_id) a ON a.author_id = u.id
  WHERE COALESCE(u.posts_count,0) != COALESCE(a.cnt,0)
),
dup_auth AS (
  SELECT auth_id, COUNT(*) AS cnt FROM users WHERE auth_id IS NOT NULL AND auth_id != '' GROUP BY auth_id HAVING COUNT(*) > 1
),
missing_auth AS (
  SELECT id, username FROM users WHERE auth_id IS NULL OR auth_id = ''
),
orphan_likes AS (
  SELECT l.id FROM likes l LEFT JOIN posts p ON p.id = l.post_id WHERE p.id IS NULL
),
orphan_comments AS (
  SELECT c.id FROM comments c LEFT JOIN posts p ON p.id = c.post_id WHERE p.id IS NULL
),
blank_msgs AS (
  SELECT id FROM messages WHERE content IS NULL OR content = ''
),
no_rls AS (
  SELECT t.tablename FROM pg_tables t
  WHERE t.schemaname = 'public'
    AND t.tablename NOT IN ('spatial_ref_sys','geometry_columns','geography_columns')
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = t.tablename AND n.nspname = 'public' AND c.relrowsecurity = true)
),
summary AS (
  SELECT 'users' AS entity, COUNT(*) AS total FROM users
  UNION ALL SELECT 'posts', COUNT(*) FROM posts
  UNION ALL SELECT 'likes', COUNT(*) FROM likes
  UNION ALL SELECT 'comments', COUNT(*) FROM comments
  UNION ALL SELECT 'follows', COUNT(*) FROM follows
  UNION ALL SELECT 'messages', COUNT(*) FROM messages
  UNION ALL SELECT 'events', COUNT(*) FROM events
  UNION ALL SELECT 'tickets', COUNT(*) FROM tickets
  UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
  UNION ALL SELECT 'bookmarks', COUNT(*) FROM bookmarks
  UNION ALL SELECT 'stories', COUNT(*) FROM stories
  UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
)

SELECT
  'SUMMARY' AS section,
  jsonb_build_object(
    'entity_counts', (SELECT jsonb_object_agg(entity, total) FROM summary),
    'counter_drift', jsonb_build_object(
      'likes_drift_posts', (SELECT COUNT(*) FROM likes_drift),
      'comments_drift_posts', (SELECT COUNT(*) FROM comments_drift),
      'followers_drift_users', (SELECT COUNT(*) FROM followers_drift),
      'following_drift_users', (SELECT COUNT(*) FROM following_drift),
      'posts_count_drift_users', (SELECT COUNT(*) FROM posts_count_drift)
    ),
    'data_integrity', jsonb_build_object(
      'duplicate_auth_ids', (SELECT COUNT(*) FROM dup_auth),
      'users_missing_auth_id', (SELECT COUNT(*) FROM missing_auth),
      'orphaned_likes', (SELECT COUNT(*) FROM orphan_likes),
      'orphaned_comments', (SELECT COUNT(*) FROM orphan_comments),
      'blank_messages', (SELECT COUNT(*) FROM blank_msgs)
    ),
    'security', jsonb_build_object(
      'tables_without_rls', (SELECT COUNT(*) FROM no_rls),
      'tables_without_rls_list', (SELECT COALESCE(jsonb_agg(tablename), '[]'::jsonb) FROM no_rls)
    ),
    'drift_details', jsonb_build_object(
      'likes_examples', (SELECT COALESCE(jsonb_agg(jsonb_build_object('post', post_id, 'cached', cached, 'actual', actual)), '[]'::jsonb) FROM (SELECT * FROM likes_drift LIMIT 5) x),
      'followers_examples', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user', username, 'cached', cached, 'actual', actual)), '[]'::jsonb) FROM (SELECT * FROM followers_drift LIMIT 5) x),
      'following_examples', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user', username, 'cached', cached, 'actual', actual)), '[]'::jsonb) FROM (SELECT * FROM following_drift LIMIT 5) x),
      'posts_count_examples', (SELECT COALESCE(jsonb_agg(jsonb_build_object('user', username, 'cached', cached, 'actual', actual)), '[]'::jsonb) FROM (SELECT * FROM posts_count_drift LIMIT 5) x)
    )
  ) AS audit_result;
