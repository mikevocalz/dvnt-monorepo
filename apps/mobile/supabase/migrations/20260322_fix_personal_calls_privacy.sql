-- Migration: Fix Personal Group Calls Privacy Violation
-- Date: 2026-03-22
-- Issue: Personal group calls from Messages were created as public (is_public=true)
--        causing them to appear in Sneaky Lynk public list
-- Fix: Mark all personal group calls as private (is_public=false)

-- First, let's see what we're about to change
DO $$
DECLARE
  affected_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO affected_count
  FROM video_rooms
  WHERE (title LIKE 'Group Call%' OR title LIKE '%Call' OR title = 'Audio Call' OR title = 'Video Call')
    AND is_public = true;
  
  RAISE NOTICE 'Found % personal calls that are incorrectly public', affected_count;
END $$;

-- Update all personal calls to be private
UPDATE video_rooms
SET 
  is_public = false,
  updated_at = NOW()
WHERE (
  title LIKE 'Group Call%' 
  OR title = 'Audio Call' 
  OR title = 'Video Call'
)
AND is_public = true;

-- Verify the fix
DO $$
DECLARE
  remaining_public INTEGER;
  now_private INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_public
  FROM video_rooms
  WHERE (title LIKE 'Group Call%' OR title = 'Audio Call' OR title = 'Video Call')
    AND is_public = true;
  
  SELECT COUNT(*) INTO now_private
  FROM video_rooms
  WHERE (title LIKE 'Group Call%' OR title = 'Audio Call' OR title = 'Video Call')
    AND is_public = false;
  
  RAISE NOTICE 'After migration:';
  RAISE NOTICE '  - Personal calls still public: %', remaining_public;
  RAISE NOTICE '  - Personal calls now private: %', now_private;
  
  IF remaining_public > 0 THEN
    RAISE WARNING 'Some personal calls are still public! Manual review needed.';
  ELSE
    RAISE NOTICE 'SUCCESS: All personal calls are now private.';
  END IF;
END $$;

-- Add a comment to the table for documentation
COMMENT ON COLUMN video_rooms.is_public IS 'Whether room appears in public Sneaky Lynk list. Personal calls (Group Call, Audio Call, Video Call) must be false.';
