-- Rollback: Restore direct client write access (if needed)
-- Use only if a legacy code path required authenticated INSERT/DELETE.

GRANT INSERT, DELETE ON public.comment_likes TO authenticated;
