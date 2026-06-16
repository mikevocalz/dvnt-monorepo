-- Verify: additive text-post and threaded-comment schema is active

SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('posts', 'comments')
  AND column_name IN ('post_kind', 'text_theme', 'parent_id', 'root_id', 'depth')
ORDER BY table_name, ordinal_position;

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

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_posts_post_kind_created_at',
    'idx_comments_post_top_level_created_at',
    'idx_comments_root_created_at',
    'idx_comments_parent_id'
  )
ORDER BY indexname;

SELECT tgname
FROM pg_trigger
WHERE tgrelid = 'public.comments'::regclass
  AND tgname = 'comments_enforce_thread_shape_before_write';

SELECT post_kind, text_theme, count(*)
FROM public.posts
GROUP BY post_kind, text_theme
ORDER BY post_kind, text_theme;

SELECT depth, count(*)
FROM public.comments
GROUP BY depth
ORDER BY depth;

