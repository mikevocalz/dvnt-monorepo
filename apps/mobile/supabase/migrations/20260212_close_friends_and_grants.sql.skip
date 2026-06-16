-- Create close_friends table (if not exists)
CREATE TABLE IF NOT EXISTS close_friends (
  id SERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, friend_id)
);
CREATE INDEX IF NOT EXISTS idx_close_friends_owner ON close_friends(owner_id);
CREATE INDEX IF NOT EXISTS idx_close_friends_friend ON close_friends(friend_id);

-- Grant service_role access to user_settings (Edge Functions)
GRANT ALL ON user_settings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE user_settings_id_seq TO service_role;
GRANT SELECT ON user_settings TO anon, authenticated;

-- Grant service_role access to close_friends (Edge Functions)
GRANT ALL ON close_friends TO service_role;
GRANT USAGE, SELECT ON SEQUENCE close_friends_id_seq TO service_role;
GRANT SELECT ON close_friends TO anon, authenticated;
