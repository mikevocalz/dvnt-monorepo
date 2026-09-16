-- A member could not read their own non-public post, so they could not open it,
-- and a post you cannot open is one you cannot edit or delete. The SELECT policy
-- only ever admitted public/NULL rows; nothing gave the author their own row
-- back. Found by creating a private post and getting "Post not found" as its
-- author. No production post is non-public today, so this closes the trap before
-- someone falls into it rather than repairing damage.
--
-- 'followers' visibility still resolves to owner-only here: the follow rule is
-- not written yet, and admitting nobody is the safe direction to be wrong in.
ALTER POLICY "Public posts are viewable by everyone" ON public.posts
USING (
  visibility = 'public'::enum_posts_visibility
  OR visibility IS NULL
  OR author_id = (
    SELECT u.id FROM public.users u
    WHERE u.auth_id = (NULLIF(current_setting('request.jwt.claims', true), '')::json ->> 'sub')
  )
);
