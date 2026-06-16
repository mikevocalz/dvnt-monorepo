-- Prove: inspect current post/comment shape before apply

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('posts', 'comments')
  AND column_name IN ('post_kind', 'text_theme', 'parent_id', 'root_id', 'depth')
ORDER BY table_name, ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'comments')
ORDER BY tablename, indexname;

SELECT conname, conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.posts'::regclass, 'public.comments'::regclass)
  AND conname IN (
    'posts_post_kind_check',
    'posts_text_theme_check',
    'comments_root_id_fk',
    'comments_depth_check'
  )
ORDER BY table_name, conname;

SELECT count(*) AS total_posts FROM public.posts;
SELECT count(*) AS total_comments FROM public.comments;
SELECT count(*) AS existing_replies FROM public.comments WHERE parent_id IS NOT NULL;

