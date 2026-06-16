-- ============================================================
-- MIGRATION: Add Structured Location Columns to Posts
-- Timestamp: 20260321_posts_location_columns
-- ============================================================
-- Purpose: Enable Instagram-level location features by storing
-- structured place data alongside loose location strings
-- ============================================================

-- ═══════════════════════════════════════════════════════════════
-- PART 1: Add Columns (Idempotent - safe to re-run)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE posts 
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS location_formatted_address text,
  ADD COLUMN IF NOT EXISTS location_lat double precision,
  ADD COLUMN IF NOT EXISTS location_lng double precision,
  ADD COLUMN IF NOT EXISTS location_city text,
  ADD COLUMN IF NOT EXISTS location_country text,
  ADD COLUMN IF NOT EXISTS location_state text,
  ADD COLUMN IF NOT EXISTS location_neighborhood text;

-- ═══════════════════════════════════════════════════════════════
-- PART 2: Performance Indexes
-- ═══════════════════════════════════════════════════════════════

-- For looking up posts by place (location discovery screen)
CREATE INDEX IF NOT EXISTS idx_posts_place_id ON posts(place_id) 
  WHERE place_id IS NOT NULL;

-- For city-based filtering (search by city)
CREATE INDEX IF NOT EXISTS idx_posts_location_city ON posts(location_city) 
  WHERE location_city IS NOT NULL;

-- For country-based filtering
CREATE INDEX IF NOT EXISTS idx_posts_location_country ON posts(location_country) 
  WHERE location_country IS NOT NULL;

-- Geospatial index for "posts near me" queries
CREATE INDEX IF NOT EXISTS idx_posts_location_lat_lng ON posts(location_lat, location_lng) 
  WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;

-- Composite index for location-based queries with recency
CREATE INDEX IF NOT EXISTS idx_posts_location_created ON posts(location_city, created_at DESC) 
  WHERE location_city IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- PART 3: Backfill Legacy Data (Best Effort)
-- Parse existing location strings to extract city names
-- This is a one-time migration - future posts will have full data
-- ═══════════════════════════════════════════════════════════════

-- Create a function to extract city from location string
-- Handles patterns like "Venue Name, City, State" or "Venue, City"
CREATE OR REPLACE FUNCTION extract_city_from_location(loc text)
RETURNS text AS $$
DECLARE
  parts text[];
  city text;
BEGIN
  IF loc IS NULL OR loc = '' THEN
    RETURN NULL;
  END IF;
  
  -- Split by comma
  parts := string_to_array(loc, ',');
  
  -- If 3+ parts: "Venue, City, State" -> City is parts[2]
  -- If 2 parts: "Venue, City" -> City is parts[2]
  -- If 1 part: Just venue name, no city info
  IF array_length(parts, 1) >= 2 THEN
    city := trim(parts[2]);
    RETURN city;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill city data from existing location strings
-- Only updates rows where location_city is null but location has content
UPDATE posts 
SET location_city = extract_city_from_location(location)
WHERE location_city IS NULL 
  AND location IS NOT NULL 
  AND location != '';

-- Clean up the helper function
DROP FUNCTION IF EXISTS extract_city_from_location(text);

-- ═══════════════════════════════════════════════════════════════
-- PART 4: RLS Policy Updates
-- Posts inherit from existing posts policies - no changes needed
-- New columns are covered by existing SELECT/INSERT/UPDATE policies
-- ═══════════════════════════════════════════════════════════════

-- Verify RLS is enabled
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Grant usage on new columns to authenticated users
GRANT SELECT (place_id, location_name, location_formatted_address, 
              location_lat, location_lng, location_city, location_country,
              location_state, location_neighborhood) 
ON posts TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- PART 5: Verification Queries (for post-migration check)
-- ═══════════════════════════════════════════════════════════════

-- Count posts with structured location vs legacy
-- SELECT 
--   COUNT(*) FILTER (WHERE place_id IS NOT NULL) as structured_count,
--   COUNT(*) FILTER (WHERE place_id IS NULL AND location IS NOT NULL) as legacy_count,
--   COUNT(*) as total_posts
-- FROM posts;

-- Sample posts with new location fields
-- SELECT id, location, place_id, location_name, location_city 
-- FROM posts 
-- WHERE place_id IS NOT NULL 
-- LIMIT 5;

-- Check index usage (should show index scans for location queries)
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM posts WHERE place_id = 'ChIJ...';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK PLAN (if needed):
-- To rollback this migration:
-- 1. ALTER TABLE posts DROP COLUMN IF EXISTS place_id;
-- 2. ALTER TABLE posts DROP COLUMN IF EXISTS location_name;
-- 3. ALTER TABLE posts DROP COLUMN IF EXISTS location_formatted_address;
-- 4. ALTER TABLE posts DROP COLUMN IF EXISTS location_lat;
-- 5. ALTER TABLE posts DROP COLUMN IF EXISTS location_lng;
-- 6. ALTER TABLE posts DROP COLUMN IF EXISTS location_city;
-- 7. ALTER TABLE posts DROP COLUMN IF EXISTS location_country;
-- 8. ALTER TABLE posts DROP COLUMN IF EXISTS location_state;
-- 9. ALTER TABLE posts DROP COLUMN IF EXISTS location_neighborhood;
-- ═══════════════════════════════════════════════════════════════
