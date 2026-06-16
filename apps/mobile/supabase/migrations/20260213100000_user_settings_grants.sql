-- Grant service_role access to user_settings (Edge Functions need this)
GRANT ALL ON user_settings TO service_role;
GRANT USAGE, SELECT ON SEQUENCE user_settings_id_seq TO service_role;
GRANT SELECT ON user_settings TO anon, authenticated;

-- Grant service_role access to close_friends (Edge Functions need this)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'close_friends' AND table_schema = 'public') THEN
    EXECUTE 'GRANT ALL ON close_friends TO service_role';
    EXECUTE 'GRANT SELECT ON close_friends TO anon, authenticated';
  END IF;
END $$;
