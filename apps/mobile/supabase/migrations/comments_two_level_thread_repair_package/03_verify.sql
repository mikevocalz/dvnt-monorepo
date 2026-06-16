-- 1. Any row still claiming third-level depth should be zero after repair.
SELECT depth, count(*)
FROM public.comments
GROUP BY depth
ORDER BY depth;

-- 2. Any reply not anchored directly to a top-level parent should be zero.
SELECT count(*) AS invalid_reply_links
FROM public.comments child
LEFT JOIN public.comments parent ON parent.id = child.parent_id
WHERE child.parent_id IS NOT NULL
  AND (
    parent.id IS NULL
    OR parent.parent_id IS NOT NULL
    OR child.root_id IS DISTINCT FROM parent.id
    OR child.depth IS DISTINCT FROM 1
  );

-- 3. High-confidence flattened rows should be zero after repair.
SELECT count(*) AS flattened_rows_with_root_signal
FROM public.comments
WHERE parent_id IS NULL
  AND root_id IS NOT NULL;

-- 4. Ambiguous rows: left untouched on purpose for manual review.
SELECT
  id,
  post_id,
  author_id,
  created_at,
  content
FROM public.comments
WHERE parent_id IS NULL
  AND root_id IS NULL
  AND depth = 0
  AND content ~ '^@[A-Za-z0-9_]+'
ORDER BY created_at DESC
LIMIT 200;
