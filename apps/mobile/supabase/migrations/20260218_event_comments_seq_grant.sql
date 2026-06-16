-- Grant sequence permissions for event_comments so anon key can insert
-- The table GRANT ALL was applied in 20260216 but the sequence was missed
GRANT USAGE, SELECT ON SEQUENCE event_comments_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE event_comments_id_seq TO authenticated;
GRANT ALL ON SEQUENCE event_comments_id_seq TO service_role;
