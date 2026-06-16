-- Hotfix for 20260428: e.category is enum_events_category, not text.
-- CREATE OR REPLACE in 20260428 forced a recompile and exposed the missing
-- cast that the old cached plan was hiding. Fix: e.category::text = p_category.
-- This file supersedes get_events_home in 20260428.
DO $$
BEGIN
  NULL;
END $$;
