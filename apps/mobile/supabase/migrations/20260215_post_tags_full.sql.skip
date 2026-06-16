-- ============================================================
-- Post Tags: Instagram-style user tagging on post images
-- ============================================================
-- Supports: multi-image tagging (media_index), normalized coords,
-- privacy-aware RLS, notification trigger, block enforcement.
-- ============================================================

-- 1) Table
CREATE TABLE IF NOT EXISTS post_tags (
  id            SERIAL PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tagged_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tagged_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x_position    REAL NOT NULL DEFAULT 0.5 CHECK (x_position >= 0 AND x_position <= 1),
  y_position    REAL NOT NULL DEFAULT 0.5 CHECK (y_position >= 0 AND y_position <= 1),
  media_index   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(post_id, tagged_user_id, media_index)
);

-- 2) Indexes
CREATE INDEX IF NOT EXISTS idx_post_tags_post_id
  ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_user_id_created
  ON post_tags(tagged_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_tags_tagged_user_post
  ON post_tags(tagged_user_id, post_id);

-- 3) Auto-update updated_at
CREATE OR REPLACE FUNCTION update_post_tags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_post_tags_updated_at ON post_tags;
CREATE TRIGGER trg_post_tags_updated_at
  BEFORE UPDATE ON post_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_post_tags_updated_at();

-- 4) Grants
GRANT ALL ON post_tags TO service_role;
GRANT USAGE, SELECT ON SEQUENCE post_tags_id_seq TO service_role;

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE post_tags ENABLE ROW LEVEL SECURITY;

-- Helper: check if viewer can see a post (public, or follower for private accounts)
-- Simplified: public posts visible to all; private-account posts visible to followers + owner
CREATE OR REPLACE FUNCTION can_view_post(p_post_id INTEGER, p_viewer_id INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  v_author_id INTEGER;
  v_visibility TEXT;
  v_is_private BOOLEAN;
BEGIN
  SELECT author_id, visibility INTO v_author_id, v_visibility
    FROM posts WHERE id = p_post_id;
  IF v_author_id IS NULL THEN RETURN FALSE; END IF;
  IF v_author_id = p_viewer_id THEN RETURN TRUE; END IF;
  IF v_visibility = 'public' THEN
    SELECT is_private INTO v_is_private FROM users WHERE id = v_author_id;
    IF v_is_private THEN
      RETURN EXISTS (
        SELECT 1 FROM follows
        WHERE follower_id = p_viewer_id AND following_id = v_author_id
      );
    END IF;
    RETURN TRUE;
  END IF;
  -- followers-only
  IF v_visibility = 'followers' THEN
    RETURN EXISTS (
      SELECT 1 FROM follows
      WHERE follower_id = p_viewer_id AND following_id = v_author_id
    );
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Helper: block check (either direction)
CREATE OR REPLACE FUNCTION is_blocked(u1 INTEGER, u2 INTEGER)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM blocks
    WHERE (blocker_id = u1 AND blocked_id = u2)
       OR (blocker_id = u2 AND blocked_id = u1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- SELECT: viewer can see tags only if they can see the post and no block
CREATE POLICY post_tags_select ON post_tags
  FOR SELECT USING (
    can_view_post(post_id, (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER)
    AND NOT is_blocked(
      tagged_user_id,
      (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER
    )
  );

-- INSERT: only post owner, no block with tagged user, tagged user can view post
CREATE POLICY post_tags_insert ON post_tags
  FOR INSERT WITH CHECK (
    tagged_by_user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER
    AND EXISTS (SELECT 1 FROM posts WHERE id = post_id AND author_id = tagged_by_user_id)
    AND NOT is_blocked(tagged_by_user_id, tagged_user_id)
    AND can_view_post(post_id, tagged_user_id)
  );

-- UPDATE: only post owner can reposition tags
CREATE POLICY post_tags_update ON post_tags
  FOR UPDATE USING (
    tagged_by_user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER
  ) WITH CHECK (
    tagged_by_user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER
  );

-- DELETE: post owner can remove tags, OR tagged user can remove their own tag
CREATE POLICY post_tags_delete ON post_tags
  FOR DELETE USING (
    tagged_by_user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER
    OR tagged_user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::INTEGER
  );

-- ============================================================
-- Notification trigger on tag insert
-- ============================================================
-- Creates a notification for the tagged user.
-- Deduplicates by (type, recipient_id, entity_id, actor_id).
-- Skips self-tags and blocked pairs.
CREATE OR REPLACE FUNCTION notify_on_post_tag()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip self-tag
  IF NEW.tagged_user_id = NEW.tagged_by_user_id THEN
    RETURN NEW;
  END IF;

  -- Skip if block exists
  IF is_blocked(NEW.tagged_by_user_id, NEW.tagged_user_id) THEN
    RETURN NEW;
  END IF;

  -- Deduplicate: don't re-notify for same actor tagging same user on same post
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE type = 'tag'
      AND recipient_id = NEW.tagged_user_id
      AND actor_id = NEW.tagged_by_user_id
      AND entity_type = 'post'
      AND entity_id = NEW.post_id::TEXT
  ) THEN
    INSERT INTO notifications (recipient_id, actor_id, type, entity_type, entity_id)
    VALUES (NEW.tagged_user_id, NEW.tagged_by_user_id, 'tag', 'post', NEW.post_id::TEXT);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_post_tag ON post_tags;
CREATE TRIGGER trg_notify_post_tag
  AFTER INSERT ON post_tags
  FOR EACH ROW
  EXECUTE FUNCTION notify_on_post_tag();
