-- One-time cleanup: remove duplicate posts created by the rapid-tap bug.
-- Keeps the latest post inside each duplicate cluster.
-- A duplicate cluster is: same author + same content + each post no more than 5 minutes
-- apart from the previous post in that author/content sequence.

BEGIN;

CREATE TEMP TABLE tmp_duplicate_posts ON COMMIT DROP AS
WITH ordered AS (
  SELECT
    id,
    author_id,
    COALESCE(content, '') AS content_key,
    created_at,
    CASE
      WHEN LAG(created_at) OVER (
        PARTITION BY author_id, COALESCE(content, '')
        ORDER BY created_at ASC, id ASC
      ) IS NULL THEN 1
      WHEN created_at - LAG(created_at) OVER (
        PARTITION BY author_id, COALESCE(content, '')
        ORDER BY created_at ASC, id ASC
      ) > interval '5 minutes' THEN 1
      ELSE 0
    END AS starts_new_cluster
  FROM public.posts
  WHERE created_at > now() - interval '7 days'
),
clustered AS (
  SELECT
    id,
    author_id,
    created_at,
    SUM(starts_new_cluster) OVER (
      PARTITION BY author_id, content_key
      ORDER BY created_at ASC, id ASC
      ROWS UNBOUNDED PRECEDING
    ) AS cluster_id
  FROM ordered
),
ranked AS (
  SELECT
    id,
    author_id,
    ROW_NUMBER() OVER (
      PARTITION BY author_id, cluster_id
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM clustered
)
SELECT id, author_id
FROM ranked
WHERE rn > 1;

DELETE FROM public.post_text_slides
WHERE post_id IN (SELECT id FROM tmp_duplicate_posts);

DELETE FROM public.posts_media
WHERE _parent_id IN (SELECT id FROM tmp_duplicate_posts);

DELETE FROM public.likes
WHERE post_id IN (SELECT id FROM tmp_duplicate_posts);

DELETE FROM public.comments
WHERE post_id IN (SELECT id FROM tmp_duplicate_posts);

DELETE FROM public.bookmarks
WHERE post_id IN (SELECT id FROM tmp_duplicate_posts);

DELETE FROM public.posts
WHERE id IN (SELECT id FROM tmp_duplicate_posts);

UPDATE public.users
SET posts_count = GREATEST(0, posts_count - grouped.cnt)
FROM (
  SELECT author_id, COUNT(*)::INTEGER AS cnt
  FROM tmp_duplicate_posts
  GROUP BY author_id
) AS grouped
WHERE public.users.id = grouped.author_id;

COMMIT;
