-- ============================================
-- Fix: Grant anon role SELECT on comment_likes
-- 
-- Root cause: The 20260304_comment_likes migration only granted
-- SELECT to 'authenticated', but all client queries run as 'anon'
-- (Better Auth doesn't set auth.uid()). This caused the
-- comment_likes!left join in getComments to fail, which killed
-- the ENTIRE comments query — making comments disappear from
-- every post.
-- ============================================

GRANT SELECT ON public.comment_likes TO anon;
