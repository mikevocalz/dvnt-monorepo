-- Apply: Enforce gateway-only writes on comment_likes
-- Idempotent. Safe to run multiple times.
-- Requires: 20260304_comment_likes and 20260305 already applied.

-- Revoke direct client write access. All likes go through toggle-comment-like Edge Function.
REVOKE INSERT ON public.comment_likes FROM authenticated;
REVOKE DELETE ON public.comment_likes FROM authenticated;

-- Ensure service_role retains full access (default, but explicit for docs)
GRANT ALL ON public.comment_likes TO service_role;
