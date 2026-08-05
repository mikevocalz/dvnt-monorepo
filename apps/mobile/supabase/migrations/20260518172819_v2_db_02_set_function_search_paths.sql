-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260518172819 :: v2_db_02_set_function_search_paths). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

ALTER FUNCTION public.update_user_settings_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_post_likes(post_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_post_likes(post_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_posts_count(user_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_post_comments(post_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_post_comments(post_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_followers_count(user_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_followers_count(user_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_following_count(user_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_following_count(user_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.can_user_moderate_room(p_user_id text, p_room_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_comment_likes_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_room_role(p_user_id text, p_room_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.count_active_participants(p_room_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.toggle_comment_like(p_comment_id integer, p_user_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.reconcile_counters() SET search_path = public, pg_temp;
ALTER FUNCTION public.decrement_posts_count(user_id integer, amount integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.check_rate_limit(p_user_id text, p_action text, p_room_id text, p_max_attempts integer, p_window_seconds integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.send_call_push_notification() SET search_path = public, pg_temp;
ALTER FUNCTION public.maintain_likes_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_post_likes_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.comments_enforce_thread_shape() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_post_comments_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.find_duplicate_posts(minutes_window integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.record_post_like_history() SET search_path = public, pg_temp;
ALTER FUNCTION public.record_event_like_history() SET search_path = public, pg_temp;
ALTER FUNCTION public.increment_promo_uses(p_promo_id uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.record_rate_limit(p_user_id text, p_action text, p_room_id text) SET search_path = public, pg_temp;
ALTER FUNCTION public.is_user_banned_from_room(p_user_id text, p_room_id integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_posts_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_comments_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_likes_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.guard_bulk_content_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.reconcile_user_posts_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.reconcile_post_comments_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.issue_rsvp_ticket(p_event_id integer, p_user_auth_id text) SET search_path = public, pg_temp;
ALTER FUNCTION public.update_spotlight_campaign_timestamp() SET search_path = public, pg_temp;
ALTER FUNCTION public.maintain_event_total_attendees() SET search_path = public, pg_temp;
ALTER FUNCTION public.set_mixed_cart_updated_at() SET search_path = public, pg_temp;;
