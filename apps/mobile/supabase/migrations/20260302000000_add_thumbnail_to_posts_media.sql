-- Add thumbnail column to posts_media for video post thumbnails
ALTER TABLE posts_media ADD COLUMN IF NOT EXISTS thumbnail text;
