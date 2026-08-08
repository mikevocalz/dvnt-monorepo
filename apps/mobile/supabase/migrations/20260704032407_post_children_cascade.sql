-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260704032407 :: post_children_cascade). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER TABLE comments  DROP CONSTRAINT comments_post_id_posts_id_fk;
ALTER TABLE comments  ADD  CONSTRAINT comments_post_id_posts_id_fk
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE bookmarks DROP CONSTRAINT bookmarks_post_id_posts_id_fk;
ALTER TABLE bookmarks ADD  CONSTRAINT bookmarks_post_id_posts_id_fk
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;;
