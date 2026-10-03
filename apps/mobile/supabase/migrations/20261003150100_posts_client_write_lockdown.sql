-- Lock public.posts against direct client writes.
--
-- Before this migration, on production (pg_class.relacl and pg_policy, read
-- 2026-10-03):
--   relacl: anon=arw, authenticated=arw
--   "Anyone can create posts"     FOR INSERT TO public WITH CHECK (true)
--   "Users can update own posts"  FOR UPDATE TO public USING (true)
--   "Users can delete own posts"  FOR DELETE TO public USING (true)
--   verified_participation_boundary  RESTRICTIVE FOR INSERT TO anon, authenticated
--
-- The UPDATE policy's name says "own" but its predicate is `true`, and anon
-- holds UPDATE. With the anon key from any app bundle, anyone could
-- PATCH /rest/v1/posts?id=eq.N and rewrite content, flip is_nsfw or
-- visibility, reset moderation_status, or set author_id to someone else.
-- The INSERT policy let anyone post as any author_id (the restrictive
-- boundary only checks the caller's own admission, not the author_id).
-- DELETE was not granted, so that policy was inert, but it is the same
-- "anything goes" shape.
--
-- No client code writes posts. Every write runs in an edge function with
-- service_role, which bypasses RLS and keeps its grants:
--   create-post (via create_post_idempotent / create_post_with_dedupe,
--   both SECURITY DEFINER), update-post, delete-post, delete-account.
-- Counter maintenance on likes/comments runs from triggers. Three of those
-- trigger functions (maintain_likes_count, update_post_likes_count,
-- update_post_comments_count) are SECURITY INVOKER, so they keep working only
-- because likes and comments are also written by service_role. A client that
-- inserted into likes or comments directly would now fail at the posts
-- UPDATE inside the trigger. scripts/verify-lockdown.mjs scans for that.
--
-- SELECT and "Public posts are viewable by everyone" are untouched.

begin;

revoke insert, update, delete, truncate, references, trigger
  on table public.posts from anon, authenticated;

-- Column grants survive a table-level REVOKE. Production has none
-- (pg_attribute.attacl is null on every posts column); revoke by name anyway.
do $$
declare
  col text;
begin
  for col in
    select quote_ident(attname)
    from pg_attribute
    where attrelid = 'public.posts'::regclass
      and attnum > 0
      and not attisdropped
  loop
    execute format(
      'revoke insert (%1$s), update (%1$s), references (%1$s) on public.posts from anon, authenticated',
      col
    );
  end loop;
end
$$;

-- Inert without the grants, but a later blanket GRANT would revive them.
drop policy if exists "Anyone can create posts" on public.posts;
drop policy if exists "Users can update own posts" on public.posts;
drop policy if exists "Users can delete own posts" on public.posts;

commit;
