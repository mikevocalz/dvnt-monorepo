-- Incident hardening: content-only duplicate cleanup can delete legitimate
-- media posts with blank captions. Duplicate detection must fingerprint the
-- full publish payload, and cached post counts must be reconciled from the
-- actual posts table instead of being decremented manually.

BEGIN;

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
  WITH post_fingerprints AS (
    SELECT
      p.id,
      p.author_id,
      p.content,
      p.post_kind,
      COALESCE(NULLIF(trim(p.content), ''), '') AS content_key,
      COALESCE(p.visibility, 'public') AS visibility_key,
      COALESCE(p.is_nsfw, false) AS nsfw_key,
      p.created_at,
      CASE
        WHEN p.post_kind = 'media' THEN COALESCE((
          SELECT string_agg(
            CONCAT_WS(':', COALESCE(pm.type::text, ''), COALESCE(pm.url, '')),
            '|'
            ORDER BY pm._order ASC, pm.type ASC, pm.url ASC
          )
          FROM public.posts_media pm
          WHERE pm._parent_id = p.id
        ), '')
        WHEN p.post_kind = 'text' THEN COALESCE((
          SELECT string_agg(
            CONCAT_WS(':', s.slide_index::TEXT, COALESCE(trim(s.content), '')),
            '|'
            ORDER BY s.slide_index ASC
          )
          FROM public.post_text_slides s
          WHERE s.post_id = p.id
        ), COALESCE(NULLIF(trim(p.content), ''), ''))
        ELSE COALESCE(NULLIF(trim(p.content), ''), '')
      END AS payload_signature
    FROM public.posts p
    WHERE p.created_at > now() - interval '7 days'
  ),
  eligible AS (
    SELECT *
    FROM post_fingerprints
    WHERE payload_signature <> ''
  ),
  ordered AS (
    SELECT
      e.*,
      CASE
        WHEN LAG(created_at) OVER (
          PARTITION BY
            author_id,
            post_kind,
            content_key,
            visibility_key,
            nsfw_key,
            payload_signature
          ORDER BY created_at ASC, id ASC
        ) IS NULL THEN 1
        WHEN created_at - LAG(created_at) OVER (
          PARTITION BY
            author_id,
            post_kind,
            content_key,
            visibility_key,
            nsfw_key,
            payload_signature
          ORDER BY created_at ASC, id ASC
        ) > make_interval(mins => GREATEST(minutes_window, 1)) THEN 1
        ELSE 0
      END AS starts_new_cluster
    FROM eligible e
  ),
  clustered AS (
    SELECT
      id,
      author_id,
      content,
      created_at,
      SUM(starts_new_cluster) OVER (
        PARTITION BY
          author_id,
          post_kind,
          content_key,
          visibility_key,
          nsfw_key,
          payload_signature
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
  UPDATE public.users u
  SET posts_count = COALESCE(actual.cnt, 0)
  FROM (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM public.posts
    WHERE author_id = user_id
  ) AS actual
  WHERE u.id = user_id;
END;
$$;

WITH actual_counts AS (
  SELECT author_id, COUNT(*)::INTEGER AS cnt
  FROM public.posts
  GROUP BY author_id
)
UPDATE public.users u
SET posts_count = COALESCE(actual_counts.cnt, 0)
FROM actual_counts
WHERE u.id = actual_counts.author_id
  AND COALESCE(u.posts_count, 0) IS DISTINCT FROM COALESCE(actual_counts.cnt, 0);

UPDATE public.users u
SET posts_count = 0
WHERE COALESCE(u.posts_count, 0) <> 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.posts p
    WHERE p.author_id = u.id
  );

COMMIT;
