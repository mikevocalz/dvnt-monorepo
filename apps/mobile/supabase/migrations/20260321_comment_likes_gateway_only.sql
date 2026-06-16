-- Enforce gateway-only writes on comment_likes
-- All like/unlike goes through toggle-comment-like Edge Function (service role).
-- See: supabase/migrations/comment_likes_package/

REVOKE INSERT ON public.comment_likes FROM authenticated;
REVOKE DELETE ON public.comment_likes FROM authenticated;
