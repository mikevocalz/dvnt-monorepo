-- Add metadata JSONB column to messages table
-- Used for story reply context (storyId, storyMediaUrl, storyUsername, storyAvatar, isExpired)
-- and future extensibility (reactions, link previews, etc.)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- Index for querying messages with specific metadata types
CREATE INDEX IF NOT EXISTS idx_messages_metadata_type ON messages ((metadata->>'type')) WHERE metadata IS NOT NULL;
