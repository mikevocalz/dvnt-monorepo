-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260518175352 :: v2_db_03b_restore_service_role_grants). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- HOTFIX for V2-DB-03: the prior REVOKE ... FROM PUBLIC cascaded to service_role, which
-- breaks the 9 video edge functions (video_ban_user, video_kick_user, video_mute_peer,
-- video_mute_all, video_change_role, video_join_room, video_end_room, video_refresh_token,
-- video_set_room_mode) that call these RPCs via service_role.
GRANT EXECUTE ON FUNCTION public.can_user_moderate_room(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_room_role(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_user_banned_from_room(text, integer) TO service_role;

-- Same risk for the rate-limit helpers — they're called from edge functions via service_role.
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_rate_limit(text, text, text) TO service_role;

-- And info-disclosure helpers that edge functions may invoke.
GRANT EXECUTE ON FUNCTION public.count_active_participants(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_verification_status(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_campaigns(bigint, text) TO service_role;;
