-- ============================================================================
-- DVNT Backend Health — Final anon SELECT policies
-- Applied Feb 23, 2026 to fix client reads after RLS lockdown.
--
-- Root cause: DVNT uses Better Auth (not Supabase Auth).
-- Client Supabase client has persistSession: false → runs as `anon` role.
-- All RLS policies MUST include `anon` for tables the client reads.
-- ============================================================================

-- Core app tables (already had RLS, needed anon SELECT added)
CREATE POLICY anon_select ON public.users FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.posts FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.posts_media FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.comments FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.comment_likes FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.likes FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.follows FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.bookmarks FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.notifications FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.post_tags FOR SELECT TO anon USING (true);

-- Conversations & messages
CREATE POLICY anon_select ON public.conversations FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.conversations_rels FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.messages FOR SELECT TO anon USING (true);

-- Events
CREATE POLICY anon_select ON public.events FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.event_rsvps FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.event_comments FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.event_reviews FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.event_co_organizers FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.event_invites FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.event_comment_tags FOR SELECT TO anon USING (true);

-- Stories
CREATE POLICY anon_select ON public.stories FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.story_views FOR SELECT TO anon USING (true);

-- Tickets & orders
CREATE POLICY anon_select ON public.tickets FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.ticket_types FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.ticket_holds FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.sneaky_access FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.orders FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.order_timeline FOR SELECT TO anon USING (true);

-- Organizer
CREATE POLICY anon_select ON public.organizer_accounts FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.organizer_branding FOR SELECT TO anon USING (true);

-- Infrastructure
CREATE POLICY anon_select ON public.cities FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.checkins FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.push_tokens FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.user_presence FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.stripe_customers FOR SELECT TO anon USING (true);

-- Video
CREATE POLICY anon_select ON public.room_comments FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.video_room_events FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.video_room_tokens FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.video_room_bans FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.video_rate_limits FOR SELECT TO anon USING (true);

-- Payments & admin (read-only access)
CREATE POLICY anon_select ON public.payouts FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.refund_requests FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.transactions FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.stripe_events FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.reports FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.reports_events FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.ads_config FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.audit_log FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.device_bans FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.moderation_actions FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.rate_limit_attempts FOR SELECT TO anon USING (true);

-- Better Auth tables
CREATE POLICY session_select_anon ON public.session FOR SELECT TO anon USING (true);
CREATE POLICY account_select_anon ON public.account FOR SELECT TO anon USING (true);
CREATE POLICY verification_select_anon ON public.verification FOR SELECT TO anon USING (true);
CREATE POLICY passkey_select_anon ON public.passkey FOR SELECT TO anon USING (true);

-- Tables from 02_apply_rls_fix.sql that already got anon SELECT via 02b
-- (media, event_likes, hashtags, categories, feature_flags, story_tags,
--  profiles, profiles_links, subscription_tiers, subscription_tiers_perks,
--  user table, stories_items, stories_stickers, blocks, close_friends,
--  reactions, messages_media, messages_rels, posts_rels, users_rels,
--  users_sessions, user_tags, event_financials, accounts, media_ai_tags,
--  content_flags, user_devices, user_settings, subscriptions,
--  verification_requests, settings)
-- Those are already applied and not repeated here.

-- CMS tables
CREATE POLICY anon_select ON public.pages FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_blocks_archive FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_blocks_content FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_blocks_content_columns FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_blocks_cta FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_blocks_cta_links FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_blocks_media_block FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_hero_links FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.pages_rels FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.legal_pages FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.legal_pages_faqs FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_version_hero_links FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_blocks_archive FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_blocks_content FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_blocks_content_columns FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_blocks_cta FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_blocks_cta_links FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_blocks_media_block FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public._pages_v_rels FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.payload_kv FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.payload_locked_documents FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.payload_locked_documents_rels FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.payload_migrations FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.payload_preferences FOR SELECT TO anon USING (true);
CREATE POLICY anon_select ON public.payload_preferences_rels FOR SELECT TO anon USING (true);
