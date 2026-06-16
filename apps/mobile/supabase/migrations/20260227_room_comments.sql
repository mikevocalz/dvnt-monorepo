-- Room comments for Sneaky Lynk rooms
-- Supports 2-level threading (root → reply → reply-to-reply)
-- Supports @mention metadata stored as JSONB

CREATE TABLE IF NOT EXISTS room_comments (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT NOT NULL,          -- video_rooms.uuid
  author_id     TEXT NOT NULL,          -- auth user id
  body          TEXT NOT NULL CHECK (char_length(body) <= 2000),
  parent_id     BIGINT REFERENCES room_comments(id) ON DELETE CASCADE,
  root_id       BIGINT REFERENCES room_comments(id) ON DELETE CASCADE,
  depth         SMALLINT NOT NULL DEFAULT 0 CHECK (depth >= 0 AND depth <= 2),
  mentions      JSONB DEFAULT '[]'::jsonb,  -- [{userId, username, start, end}]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_room_comments_room_id ON room_comments(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_comments_root_id ON room_comments(root_id) WHERE root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_room_comments_parent_id ON room_comments(parent_id) WHERE parent_id IS NOT NULL;

-- Grant access to authenticated users via anon role (Supabase convention)
GRANT SELECT, INSERT ON room_comments TO anon;
GRANT SELECT, INSERT ON room_comments TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE room_comments_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE room_comments_id_seq TO authenticated;

-- RLS
ALTER TABLE room_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can read comments for rooms they can see
CREATE POLICY "room_comments_select" ON room_comments
  FOR SELECT USING (true);

-- Authenticated users can insert their own comments
CREATE POLICY "room_comments_insert" ON room_comments
  FOR INSERT WITH CHECK (true);
