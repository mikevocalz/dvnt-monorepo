-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260518173009 :: v2_db_03_lock_down_security_definer_rpcs). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- V2-DB-03: SECURITY DEFINER functions exposed via PostgREST /rpc/* to the `anon` role.
-- Revoke EXECUTE on functions that are NEVER meant to be called as RPCs (triggers, server-only,
-- and sensitive user-action functions). Public-feed RPCs (get_events_home, get_event_detail,
-- get_events_for_you, get_promoted_event_ids, get_spotlight_feed, viewer_can_see_nsfw) keep anon EXECUTE.

-- Trigger-only functions: never RPC, revoke from anon + authenticated.
REVOKE EXECUTE ON FUNCTION public.audit_comments_delete() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_likes_delete() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_posts_delete() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.maintain_event_total_attendees() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_call_push_notification() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nullify_notifications_on_post_delete() FROM anon, authenticated, PUBLIC;

-- Server-only (edge function / cron only): revoke from anon + authenticated.
REVOKE EXECUTE ON FUNCTION public.cart_apply_line_refund(uuid, uuid, text, integer, text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_promo_uses(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_spotlight_campaigns() FROM anon, authenticated, PUBLIC;

-- Maintenance / reconciliation: server-only.
REVOKE EXECUTE ON FUNCTION public.reconcile_counters() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_post_comments_count() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_user_posts_count() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_follow_counts() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_post_comments_count() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_post_likes_count() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_user_posts_count() FROM anon, authenticated, PUBLIC;

-- Sensitive user-action RPCs: revoke anon only (authenticated callers still work).
-- NOTE: architectural concern — these accept p_user_auth_id as a param rather than deriving from
-- session. A logged-in user could spoof another user's id. Defense-in-depth fix would be to route
-- through an edge function that validates Better Auth token. Tracked as follow-up.
REVOKE EXECUTE ON FUNCTION public.issue_rsvp_ticket(integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_verification_request(text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_event_attendees(integer) FROM anon, PUBLIC;

-- Moderation / room helpers: authenticated only.
REVOKE EXECUTE ON FUNCTION public.can_user_moderate_room(text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_user_banned_from_room(text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_room_role(text, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_active_participants(integer) FROM anon, PUBLIC;

-- Rate-limit machinery: server-only really, but some flows may be authenticated. Be conservative.
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, text, integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_rate_limit(text, text, text) FROM anon, PUBLIC;

-- Info disclosure: authenticated only.
REVOKE EXECUTE ON FUNCTION public.get_verification_status(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_event_campaigns(bigint, text) FROM anon, PUBLIC;;
