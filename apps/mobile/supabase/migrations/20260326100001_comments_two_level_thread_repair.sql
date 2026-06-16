-- Normalize DVNT post comments to a strict 2-level thread model:
-- top-level comments (depth 0) + direct replies (depth 1).
-- This migration only repairs rows with high-confidence structural linkage.

BEGIN;

-- 1) Repair high-confidence flattened rows:
-- parent_id is null, but root_id already points at a real top-level parent.
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

-- 2) Normalize every linked reply onto the top-level parent.
-- This safely collapses historical reply-to-reply rows into the allowed level-1 reply band.
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

-- 3) Normalize true top-level rows without any linkage.
UPDATE public.comments
SET
  root_id = NULL,
  depth = 0
WHERE parent_id IS NULL
  AND root_id IS NULL
  AND depth IS DISTINCT FROM 0;

-- 4) Tighten the write-path trigger so replies to replies are snapped to the thread root.
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

-- 5) Tighten the constraint after repairs are complete.
ALTER TABLE public.comments
  DROP CONSTRAINT IF EXISTS comments_depth_check;

ALTER TABLE public.comments
  ADD CONSTRAINT comments_depth_check
  CHECK (depth >= 0 AND depth <= 1);

COMMIT;
