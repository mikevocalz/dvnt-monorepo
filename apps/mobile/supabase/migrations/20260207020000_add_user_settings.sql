-- User settings table: single JSONB column per user for all preferences
-- Covers: notifications, privacy, messages, likes/comments, language, theme
-- Uses auth_id (TEXT) since Better Auth generates non-UUID IDs

CREATE TABLE IF NOT EXISTS user_settings (
  id SERIAL PRIMARY KEY,
  auth_id TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup by auth_id
CREATE INDEX IF NOT EXISTS idx_user_settings_auth_id ON user_settings (auth_id);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_settings_updated_at ON user_settings;
CREATE TRIGGER trg_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_settings_updated_at();
