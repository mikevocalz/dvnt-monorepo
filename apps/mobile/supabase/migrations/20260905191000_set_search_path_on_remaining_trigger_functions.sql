-- Pin search_path on the last two functions the linter still flags.
--
-- Without a pinned search_path, a SECURITY DEFINER function resolves unqualified
-- names against the caller's search_path, so a caller can shadow a table or
-- operator and run their own code with the definer's rights.
--
-- send_call_push_notification was already pinned by
-- 20260518172819_v2_db_02_set_function_search_paths.sql; a later CREATE OR
-- REPLACE dropped the setting, which is why it came back. block_permanent_delete
-- was never in that list. Same convention as that migration: public, pg_temp.
--
-- After applying, the security advisor's two function_search_path_mutable
-- warnings are gone (41 lints -> 39). The remaining WARNs are the public
-- browsing RPCs (get_events_home, get_event_detail, get_spotlight_feed and
-- friends), which are anon-callable on purpose because logged-out users browse
-- events; revoking those would break the app, so they stay.

ALTER FUNCTION public.block_permanent_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.send_call_push_notification() SET search_path = public, pg_temp;
