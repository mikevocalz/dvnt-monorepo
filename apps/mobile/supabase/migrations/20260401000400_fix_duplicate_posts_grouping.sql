-- Fix duplicate audit grouping so separate payload partitions are never
-- collapsed together just because they share the same author/content pair.

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
      post_kind,
      visibility_key,
      nsfw_key,
      payload_signature,
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
      post_kind,
      visibility_key,
      nsfw_key,
      payload_signature,
      cluster_id,
      ARRAY_AGG(id ORDER BY created_at DESC, id DESC) AS ordered_ids
    FROM clustered
    GROUP BY
      author_id,
      content,
      post_kind,
      visibility_key,
      nsfw_key,
      payload_signature,
      cluster_id
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

COMMIT;
