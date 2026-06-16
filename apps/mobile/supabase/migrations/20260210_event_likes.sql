-- Event likes table: tracks which users have liked/saved which events
CREATE TABLE IF NOT EXISTS event_likes (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_likes_user ON event_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_event_likes_event ON event_likes(event_id);
