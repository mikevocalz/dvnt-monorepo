-- Bundled production apply migration for:
-- 1. Duplicate-post cleanup helper functions
-- 2. One-time duplicate-post cleanup
-- 3. Strict 2-level post comment threading repair

-- ── Duplicate-post helpers ──────────────────────────────────────────

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

-- ── One-time duplicate-post cleanup ────────────────────────────────

DO $cleanup$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'pg_temp'
      AND tablename = 'tmp_duplicate_posts'
  ) THEN
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
  END IF;
END;
$cleanup$;

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

-- ── Strict 2-level comment threading repair ────────────────────────

UPDATE public.comments child
SET
  parent_id = root.id,
  root_id = root.id,
  depth = 1
FROM public.comments root
WHERE child.parent_id IS NULL
  AND child.root_id IS NOT NULL
  AND root.id = child.root_id
  AND root.post_id = child.post_id
  AND root.parent_id IS NULL;

UPDATE public.comments child
SET
  parent_id = CASE
    WHEN parent.parent_id IS NULL THEN parent.id
    ELSE COALESCE(parent.root_id, parent.parent_id, parent.id)
  END,
  root_id = CASE
    WHEN parent.parent_id IS NULL THEN parent.id
    ELSE COALESCE(parent.root_id, parent.parent_id, parent.id)
  END,
  depth = 1
FROM public.comments parent
WHERE child.parent_id = parent.id
  AND child.post_id = parent.post_id
  AND (
    child.depth IS DISTINCT FROM 1
    OR child.root_id IS DISTINCT FROM CASE
      WHEN parent.parent_id IS NULL THEN parent.id
      ELSE COALESCE(parent.root_id, parent.parent_id, parent.id)
    END
    OR child.parent_id IS DISTINCT FROM CASE
      WHEN parent.parent_id IS NULL THEN parent.id
      ELSE COALESCE(parent.root_id, parent.parent_id, parent.id)
    END
  );

UPDATE public.comments
SET
  root_id = NULL,
  depth = 0
WHERE parent_id IS NULL
  AND root_id IS NULL
  AND depth IS DISTINCT FROM 0;

CREATE OR REPLACE FUNCTION public.comments_enforce_thread_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_row public.comments%ROWTYPE;
  normalized_root_id BIGINT;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.root_id := NULL;
    NEW.depth := 0;
    RETURN NEW;
  END IF;

  SELECT *
  INTO parent_row
  FROM public.comments
  WHERE id = NEW.parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent comment % not found', NEW.parent_id;
  END IF;

  IF parent_row.post_id IS DISTINCT FROM NEW.post_id THEN
    RAISE EXCEPTION 'Comment thread must stay on the same post';
  END IF;

  normalized_root_id := CASE
    WHEN parent_row.parent_id IS NULL THEN parent_row.id
    ELSE COALESCE(parent_row.root_id, parent_row.parent_id, parent_row.id)
  END;

  NEW.parent_id := normalized_root_id;
  NEW.root_id := normalized_root_id;
  NEW.depth := 1;
  RETURN NEW;
END;
$$;

ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_depth_check;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_depth_check
  CHECK (depth >= 0 AND depth <= 1);
