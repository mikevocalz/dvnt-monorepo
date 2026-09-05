-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519201757 :: rls_initplan_wrap_auth_in_select). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Performance polish per Supabase advisor `auth_rls_initplan`.
-- Wraps the Better Auth `current_setting('request.jwt.claims')::json->>'sub'`
-- and `auth.uid()` calls in `(SELECT ...)` so PostgreSQL evaluates them
-- ONCE per query instead of re-evaluating per-row. Pure performance win:
-- the boolean result is identical, only the planner's caching changes.
-- 32 policies across 26 tables.

ALTER POLICY "cart_holds_select_owner" ON public.cart_holds USING ((EXISTS ( SELECT 1 FROM carts c WHERE ((c.id = cart_holds.cart_id) AND (c.user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "cart_line_items_select_owner" ON public.cart_line_items USING ((EXISTS ( SELECT 1 FROM carts c WHERE ((c.id = cart_line_items.cart_id) AND (c.user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "cart_line_refunds_select_owner" ON public.cart_line_refunds USING ((EXISTS ( SELECT 1 FROM carts c WHERE ((c.id = cart_line_refunds.cart_id) AND (c.user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "carts_select_owner" ON public.carts USING ((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "checkins_select_event_host" ON public.checkins USING ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = checkins.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "Users can delete own comment likes" ON public.comment_likes USING ((user_id = ( SELECT users.id FROM users WHERE (users.auth_id = (SELECT (auth.uid())::text)))));
ALTER POLICY "Users can insert own comment likes" ON public.comment_likes WITH CHECK ((user_id = ( SELECT users.id FROM users WHERE (users.auth_id = (SELECT (auth.uid())::text)))));
ALTER POLICY "content_reports_insert_own" ON public.content_reports WITH CHECK ((reporter_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "content_reports_select_own" ON public.content_reports USING ((reporter_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "coorg_select_involved" ON public.event_co_organizers USING (((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)) OR (EXISTS ( SELECT 1 FROM events e WHERE ((e.id = event_co_organizers.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)))))));
ALTER POLICY "event_invites_insert" ON public.event_invites WITH CHECK ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = event_invites.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "event_invites_select" ON public.event_invites USING (((invited_user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)) OR (EXISTS ( SELECT 1 FROM events e WHERE ((e.id = event_invites.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)))))));
ALTER POLICY "event_waitlist_select" ON public.event_waitlist USING (((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)) OR (EXISTS ( SELECT 1 FROM events e WHERE ((e.id = event_waitlist.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)))))));
ALTER POLICY "order_timeline_select_own" ON public.order_timeline USING ((EXISTS ( SELECT 1 FROM orders o WHERE ((o.id = order_timeline.order_id) AND (o.user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "orders_select_own" ON public.orders USING ((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "organizer_accounts_own" ON public.organizer_accounts USING ((host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "organizer_branding_own" ON public.organizer_branding USING ((host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "payouts_select_own" ON public.payouts USING ((host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "promo_codes_insert_host" ON public.promo_codes WITH CHECK ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = promo_codes.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "promo_codes_update_host" ON public.promo_codes USING ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = promo_codes.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "refund_requests_own" ON public.refund_requests USING ((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "reports_events_insert" ON public.reports_events WITH CHECK ((reporter_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "reports_video_rooms_insert" ON public.reports_video_rooms WITH CHECK ((reporter_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "sneaky_access_select_own" ON public.sneaky_access USING ((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "sneaky_subs_own" ON public.sneaky_subscriptions USING ((host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "stripe_customers_own" ON public.stripe_customers USING ((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "ticket_holds_own" ON public.ticket_holds USING ((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)));
ALTER POLICY "ticket_transfers_select" ON public.ticket_transfers USING (((from_user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)) OR (to_user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))));
ALTER POLICY "ticket_types_insert" ON public.ticket_types WITH CHECK ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = ticket_types.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "ticket_types_update" ON public.ticket_types USING ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = ticket_types.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));
ALTER POLICY "tickets_select_own" ON public.tickets USING (((user_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)) OR (EXISTS ( SELECT 1 FROM events e WHERE ((e.id = tickets.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text)))))));
ALTER POLICY "tickets_update_host" ON public.tickets USING ((EXISTS ( SELECT 1 FROM events e WHERE ((e.id = tickets.event_id) AND (e.host_id = (SELECT (current_setting('request.jwt.claims'::text, true))::json ->> 'sub'::text))))));;
