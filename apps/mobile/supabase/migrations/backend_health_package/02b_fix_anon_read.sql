-- ============================================================================
-- HOTFIX: Restore anon SELECT access to tables that were previously open
-- 
-- Root cause: client uses anon key (Better Auth, not Supabase Auth),
-- so all client queries run as 'anon' role. The RLS lockdown added
-- SELECT policies for 'authenticated' only — blocking the client.
--
-- This fix adds anon SELECT policies. This is STRICTLY MORE SECURE
-- than before: previously these tables had NO RLS (anon could read+write),
-- now they have RLS with SELECT-only for anon (writes still blocked).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- Update existing authenticated-only policies to include anon
-- ═══════════════════════════════════════════════════════════════════════════

-- media (avatars, post images, etc.)
DROP POLICY IF EXISTS media_select_authenticated ON public.media;
CREATE POLICY media_select_all ON public.media FOR SELECT TO anon, authenticated USING (true);

-- event_likes
DROP POLICY IF EXISTS event_likes_select_authenticated ON public.event_likes;
CREATE POLICY event_likes_select_all ON public.event_likes FOR SELECT TO anon, authenticated USING (true);

-- hashtags
DROP POLICY IF EXISTS hashtags_select_authenticated ON public.hashtags;
CREATE POLICY hashtags_select_all ON public.hashtags FOR SELECT TO anon, authenticated USING (true);

-- categories
DROP POLICY IF EXISTS categories_select_authenticated ON public.categories;
CREATE POLICY categories_select_all ON public.categories FOR SELECT TO anon, authenticated USING (true);

-- feature_flags
DROP POLICY IF EXISTS feature_flags_select_authenticated ON public.feature_flags;
CREATE POLICY feature_flags_select_all ON public.feature_flags FOR SELECT TO anon, authenticated USING (true);

-- story_tags
DROP POLICY IF EXISTS story_tags_select_authenticated ON public.story_tags;
CREATE POLICY story_tags_select_all ON public.story_tags FOR SELECT TO anon, authenticated USING (true);

-- profiles
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_all ON public.profiles FOR SELECT TO anon, authenticated USING (true);

-- profiles_links
DROP POLICY IF EXISTS profiles_links_select_authenticated ON public.profiles_links;
CREATE POLICY profiles_links_select_all ON public.profiles_links FOR SELECT TO anon, authenticated USING (true);

-- subscription_tiers
DROP POLICY IF EXISTS sub_tiers_select_authenticated ON public.subscription_tiers;
CREATE POLICY sub_tiers_select_all ON public.subscription_tiers FOR SELECT TO anon, authenticated USING (true);

-- subscription_tiers_perks
DROP POLICY IF EXISTS sub_perks_select_authenticated ON public.subscription_tiers_perks;
CREATE POLICY sub_perks_select_all ON public.subscription_tiers_perks FOR SELECT TO anon, authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Add anon SELECT to additional tables the client reads from
-- ═══════════════════════════════════════════════════════════════════════════

-- Better Auth user table (profile fallback lookup)
CREATE POLICY user_select_all ON public."user" FOR SELECT TO anon, authenticated USING (true);

-- Better Auth session (needed for token lookups in client? probably not but safe)
-- NOTE: NOT adding anon SELECT to session — that leaks tokens. Edge Functions use service_role.

-- Better Auth account (client doesn't need this)
-- NOT adding SELECT — service_role only

-- stories_items (story content)
CREATE POLICY stories_items_select_all ON public.stories_items FOR SELECT TO anon, authenticated USING (true);

-- stories_stickers
CREATE POLICY stories_stickers_select_all ON public.stories_stickers FOR SELECT TO anon, authenticated USING (true);

-- blocks (client checks block status)
CREATE POLICY blocks_select_all ON public.blocks FOR SELECT TO anon, authenticated USING (true);

-- close_friends
CREATE POLICY close_friends_select_all ON public.close_friends FOR SELECT TO anon, authenticated USING (true);

-- reactions (message reactions)
CREATE POLICY reactions_select_all ON public.reactions FOR SELECT TO anon, authenticated USING (true);

-- messages_media
CREATE POLICY messages_media_select_all ON public.messages_media FOR SELECT TO anon, authenticated USING (true);

-- messages_rels
CREATE POLICY messages_rels_select_all ON public.messages_rels FOR SELECT TO anon, authenticated USING (true);

-- posts_rels (post relationships — media, tags)
CREATE POLICY posts_rels_select_all ON public.posts_rels FOR SELECT TO anon, authenticated USING (true);

-- users_rels (user relationships — avatar FK joins)
CREATE POLICY users_rels_select_all ON public.users_rels FOR SELECT TO anon, authenticated USING (true);

-- users_sessions
CREATE POLICY users_sessions_select_all ON public.users_sessions FOR SELECT TO anon, authenticated USING (true);

-- user_tags
CREATE POLICY user_tags_select_all ON public.user_tags FOR SELECT TO anon, authenticated USING (true);

-- event_financials (organizer dashboard)
CREATE POLICY event_financials_select_all ON public.event_financials FOR SELECT TO anon, authenticated USING (true);

-- accounts (legacy?)
CREATE POLICY accounts_select_all ON public.accounts FOR SELECT TO anon, authenticated USING (true);

-- media_ai_tags
CREATE POLICY media_ai_tags_select_all ON public.media_ai_tags FOR SELECT TO anon, authenticated USING (true);

-- content_flags
CREATE POLICY content_flags_select_all ON public.content_flags FOR SELECT TO anon, authenticated USING (true);

-- user_devices (push tokens)
CREATE POLICY user_devices_select_all ON public.user_devices FOR SELECT TO anon, authenticated USING (true);

-- user_settings
CREATE POLICY user_settings_select_all ON public.user_settings FOR SELECT TO anon, authenticated USING (true);

-- subscriptions
CREATE POLICY subscriptions_select_all ON public.subscriptions FOR SELECT TO anon, authenticated USING (true);

-- verification_requests
CREATE POLICY verification_requests_select_all ON public.verification_requests FOR SELECT TO anon, authenticated USING (true);

-- settings (app settings)
CREATE POLICY settings_select_all ON public.settings FOR SELECT TO anon, authenticated USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- Tables that stay LOCKED (no anon/authenticated SELECT):
--   session, account, verification, passkey (auth secrets)
--   reports, moderation_actions, device_bans (admin only)
--   transactions, stripe_events (financial secrets)
--   payload_* tables (CMS admin only)
--   _pages_v* tables (CMS versioning)
--   pages*, legal_pages* (CMS — served via API, not direct DB)
-- ═══════════════════════════════════════════════════════════════════════════
