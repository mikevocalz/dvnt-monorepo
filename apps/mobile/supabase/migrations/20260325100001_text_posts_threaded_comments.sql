-- Add text posts and 2-level threaded comments.
-- Idempotent, phased, non-destructive.

-- ── Posts: add additive text-post fields ────────────────────────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS post_kind TEXT;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS text_theme TEXT;

UPDATE public.posts
SET
  post_kind = COALESCE(post_kind, 'media'),
  text_theme = CASE
    WHEN text_theme IN ('graphite', 'cobalt', 'ember', 'sage') THEN text_theme
    ELSE 'graphite'
  END
WHERE post_kind IS NULL
   OR text_theme IS NULL
   OR text_theme NOT IN ('graphite', 'cobalt', 'ember', 'sage');

ALTER TABLE public.posts
  ALTER COLUMN post_kind SET DEFAULT 'media';

ALTER TABLE public.posts
  ALTER COLUMN text_theme SET DEFAULT 'graphite';

UPDATE public.posts SET post_kind = 'media' WHERE post_kind IS NULL;
UPDATE public.posts SET text_theme = 'graphite' WHERE text_theme IS NULL;

ALTER TABLE public.posts
  ALTER COLUMN post_kind SET NOT NULL;

ALTER TABLE public.posts
  ALTER COLUMN text_theme SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_post_kind_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_post_kind_check
      CHECK (post_kind IN ('media', 'text'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_text_theme_check'
      AND conrelid = 'public.posts'::regclass
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_text_theme_check
      CHECK (text_theme IN ('graphite', 'cobalt', 'ember', 'sage'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_post_kind_created_at
  ON public.posts (post_kind, created_at DESC);

-- ── Comments: add additive thread metadata ───────────────────────────────
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS root_id BIGINT;

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS depth SMALLINT;

UPDATE public.comments
SET depth = 0
WHERE depth IS NULL;

ALTER TABLE public.comments
  ALTER COLUMN depth SET DEFAULT 0;

ALTER TABLE public.comments
  ALTER COLUMN depth SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'comments_root_id_fk'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_root_id_fk
      FOREIGN KEY (root_id) REFERENCES public.comments(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'comments_depth_check'
      AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_depth_check
      CHECK (depth >= 0 AND depth <= 2);
  END IF;
END $$;

UPDATE public.comments
SET
  root_id = NULL,
  depth = 0
WHERE parent_id IS NULL;

UPDATE public.comments child
SET
  root_id = child.parent_id,
  depth = 1
FROM public.comments parent
WHERE child.parent_id = parent.id
  AND parent.parent_id IS NULL;

UPDATE public.comments child
SET
  root_id = COALESCE(parent.root_id, parent.parent_id, parent.id),
  depth = 2
FROM public.comments parent
WHERE child.parent_id = parent.id
  AND parent.parent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.comments_enforce_thread_shape()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_row public.comments%ROWTYPE;
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

  IF COALESCE(parent_row.depth, 0) >= 2 THEN
    RAISE EXCEPTION 'Comment replies are limited to 2 levels';
  END IF;

  NEW.root_id := COALESCE(parent_row.root_id, parent_row.id);
  NEW.depth := COALESCE(parent_row.depth, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comments_enforce_thread_shape_before_write
ON public.comments;

CREATE TRIGGER comments_enforce_thread_shape_before_write
BEFORE INSERT OR UPDATE OF parent_id, post_id
ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.comments_enforce_thread_shape();

CREATE INDEX IF NOT EXISTS idx_comments_post_top_level_created_at
  ON public.comments (post_id, created_at DESC)
  WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_comments_root_created_at
  ON public.comments (root_id, created_at ASC)
  WHERE root_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_parent_id
  ON public.comments (parent_id)
  WHERE parent_id IS NOT NULL;

