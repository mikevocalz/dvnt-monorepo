-- Add thumbnail_id column to stories table for video story preview images
-- References media table (same as media_id)
ALTER TABLE stories ADD COLUMN IF NOT EXISTS thumbnail_id INTEGER REFERENCES media(id) ON DELETE SET NULL;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_stories_thumbnail_id ON stories(thumbnail_id) WHERE thumbnail_id IS NOT NULL;
