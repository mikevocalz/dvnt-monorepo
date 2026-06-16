-- Grant INSERT/UPDATE on story_views to anon and authenticated roles
-- The anon key client needs INSERT to record views via upsert
-- RLS is disabled on this table; the composite key (story_id, user_id) prevents duplicates
GRANT INSERT, UPDATE ON story_views TO anon;
GRANT INSERT, UPDATE ON story_views TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE story_views_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE story_views_id_seq TO authenticated;
