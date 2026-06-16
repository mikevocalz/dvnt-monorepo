-- Rollback: remove additive text-post / threaded-comment schema.
-- Use only if the rollout must be reverted.

DROP TRIGGER IF EXISTS comments_enforce_thread_shape_before_write ON public.comments;
DROP FUNCTION IF EXISTS public.comments_enforce_thread_shape();

DROP INDEX IF EXISTS idx_comments_parent_id;
DROP INDEX IF EXISTS idx_comments_root_created_at;
DROP INDEX IF EXISTS idx_comments_post_top_level_created_at;
DROP INDEX IF EXISTS idx_posts_post_kind_created_at;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_depth_check;
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_root_id_fk;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_text_theme_check;
ALTER TABLE public.posts DROP CONSTRAINT IF EXISTS posts_post_kind_check;

ALTER TABLE public.comments DROP COLUMN IF EXISTS depth;
ALTER TABLE public.comments DROP COLUMN IF EXISTS root_id;
ALTER TABLE public.posts DROP COLUMN IF EXISTS text_theme;
ALTER TABLE public.posts DROP COLUMN IF EXISTS post_kind;

