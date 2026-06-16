-- Read-only helper functions for auditing duplicate posts.

CREATE OR REPLACE FUNCTION public.find_duplicate_posts(
  minutes_window INTEGER DEFAULT 5
)
RETURNS TABLE (
  author_id INTEGER,
  content TEXT,
  duplicate_ids BIGINT[],
  keep_id BIGINT
)
LANGUAGE sql
AS $$
  WITH ordered AS (
    SELECT
      id,
      author_id,
      COALESCE(content, '') AS content_key,
      content,
      created_at,
      CASE
        WHEN LAG(created_at) OVER (
          PARTITION BY author_id, COALESCE(content, '')
          ORDER BY created_at ASC, id ASC
        ) IS NULL THEN 1
        WHEN created_at - LAG(created_at) OVER (
          PARTITION BY author_id, COALESCE(content, '')
          ORDER BY created_at ASC, id ASC
        ) > make_interval(mins => GREATEST(minutes_window, 1)) THEN 1
        ELSE 0
      END AS starts_new_cluster
    FROM public.posts
    WHERE created_at > now() - interval '7 days'
  ),
  clustered AS (
    SELECT
      id,
      author_id,
      content,
      created_at,
      SUM(starts_new_cluster) OVER (
        PARTITION BY author_id, COALESCE(content, '')
        ORDER BY created_at ASC, id ASC
        ROWS UNBOUNDED PRECEDING
      ) AS cluster_id
    FROM ordered
  ),
  grouped AS (
    SELECT
      author_id,
      content,
      cluster_id,
      ARRAY_AGG(id ORDER BY created_at DESC, id DESC) AS ordered_ids
    FROM clustered
    GROUP BY author_id, content, cluster_id
    HAVING COUNT(*) > 1
  )
  SELECT
    grouped.author_id,
    grouped.content,
    grouped.ordered_ids[2:array_length(grouped.ordered_ids, 1)] AS duplicate_ids,
    grouped.ordered_ids[1] AS keep_id
  FROM grouped
  WHERE array_length(grouped.ordered_ids, 1) > 1;
$$;

CREATE OR REPLACE FUNCTION public.decrement_posts_count(
  user_id INTEGER,
  amount INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.users
  SET posts_count = GREATEST(0, posts_count - GREATEST(amount, 0))
  WHERE id = user_id;
END;
$$;
