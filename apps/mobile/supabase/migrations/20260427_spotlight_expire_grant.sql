-- ══════════════════════════════════════════════════════════════
-- Let clients invoke the spotlight expiry sweep
-- ══════════════════════════════════════════════════════════════
-- expire_spotlight_campaigns() was gated to postgres only, which
-- meant the only way to mark campaigns past their ends_at as
-- 'expired' was an external cron. Since the function is idempotent
-- (UPDATE ... WHERE ends_at < now() AND status = 'active') and
-- SECURITY DEFINER, it's safe to let any authenticated caller fire
-- it as a best-effort housekeeping step when they load the feed.
--
-- The RPCs that SERVE the feed already filter by `now() BETWEEN
-- starts_at AND ends_at`, so users never see expired campaigns
-- regardless — this just keeps the `status` column honest.

GRANT EXECUTE ON FUNCTION expire_spotlight_campaigns TO authenticated;

NOTIFY pgrst, 'reload schema';
