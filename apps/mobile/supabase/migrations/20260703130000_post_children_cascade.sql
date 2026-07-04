-- comments.post_id and bookmarks.post_id were ON DELETE SET NULL onto NOT NULL
-- columns — deleting any post that had a comment or bookmark THREW
-- ("null value in column post_id violates not-null constraint"). A comment /
-- bookmark belongs to its post, so it should die with it: switch to CASCADE.
ALTER TABLE comments  DROP CONSTRAINT comments_post_id_posts_id_fk;
ALTER TABLE comments  ADD  CONSTRAINT comments_post_id_posts_id_fk
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE bookmarks DROP CONSTRAINT bookmarks_post_id_posts_id_fk;
ALTER TABLE bookmarks ADD  CONSTRAINT bookmarks_post_id_posts_id_fk
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
