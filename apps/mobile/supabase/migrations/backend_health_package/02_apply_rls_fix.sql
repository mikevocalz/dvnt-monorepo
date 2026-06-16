-- ============================================================================
-- DVNT Backend Health — RLS FIX for 66 unprotected tables
-- Safe to run: ENABLE RLS is non-destructive. Tables without policies
-- become invisible to authenticated/anon (service_role unaffected).
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: Enable RLS on ALL 66 unprotected tables
-- service_role bypasses RLS, so Edge Functions continue working
-- ═══════════════════════════════════════════════════════════════════════════

-- Better Auth tables (CRITICAL — session/user/account must not leak)
ALTER TABLE IF EXISTS public.session ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.passkey ENABLE ROW LEVEL SECURITY;

-- Core app tables missing RLS
ALTER TABLE IF EXISTS public.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.story_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hashtags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.close_friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.profiles_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.content_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.verification_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users_rels ENABLE ROW LEVEL SECURITY;

-- Messaging related
ALTER TABLE IF EXISTS public.reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages_rels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.messages_media ENABLE ROW LEVEL SECURITY;

-- Moderation & reports
ALTER TABLE IF EXISTS public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.device_bans ENABLE ROW LEVEL SECURITY;

-- Subscriptions & transactions
ALTER TABLE IF EXISTS public.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subscription_tiers_perks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.transactions ENABLE ROW LEVEL SECURITY;

-- Stories
ALTER TABLE IF EXISTS public.stories_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.stories_stickers ENABLE ROW LEVEL SECURITY;

-- Posts related
ALTER TABLE IF EXISTS public.posts_rels ENABLE ROW LEVEL SECURITY;

-- Media AI
ALTER TABLE IF EXISTS public.media_ai_tags ENABLE ROW LEVEL SECURITY;

-- Feature flags & settings
ALTER TABLE IF EXISTS public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;

-- Payload CMS tables (admin-only, no client access needed)
ALTER TABLE IF EXISTS public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_blocks_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_blocks_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_blocks_content_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_blocks_cta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_blocks_cta_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_blocks_media_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_hero_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages_rels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_version_hero_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_blocks_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_blocks_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_blocks_content_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_blocks_cta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_blocks_cta_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_blocks_media_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._pages_v_rels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.legal_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.legal_pages_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payload_locked_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payload_locked_documents_rels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payload_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payload_preferences_rels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payload_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payload_kv ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2: Add SELECT policies for tables that Edge Functions read
-- Without policies, RLS-enabled tables are invisible to authenticated.
-- service_role always bypasses RLS, so Edge Functions still work.
-- Only add SELECT policies for tables the CLIENT needs to read directly.
-- ═══════════════════════════════════════════════════════════════════════════

-- media: client reads media URLs for posts/avatars
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'media' AND policyname = 'media_select_authenticated') THEN
    CREATE POLICY media_select_authenticated ON public.media FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- event_likes: client reads to show like state
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_likes' AND policyname = 'event_likes_select_authenticated') THEN
    CREATE POLICY event_likes_select_authenticated ON public.event_likes FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- hashtags: client reads for autocomplete/display
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'hashtags' AND policyname = 'hashtags_select_authenticated') THEN
    CREATE POLICY hashtags_select_authenticated ON public.hashtags FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- categories: client reads for event filtering
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'categories' AND policyname = 'categories_select_authenticated') THEN
    CREATE POLICY categories_select_authenticated ON public.categories FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- feature_flags: client reads to check feature availability
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'feature_flags' AND policyname = 'feature_flags_select_authenticated') THEN
    CREATE POLICY feature_flags_select_authenticated ON public.feature_flags FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- story_tags: client reads tagged users in stories
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'story_tags' AND policyname = 'story_tags_select_authenticated') THEN
    CREATE POLICY story_tags_select_authenticated ON public.story_tags FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- profiles + profiles_links: client reads public profile data
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'profiles_select_authenticated') THEN
    CREATE POLICY profiles_select_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles_links' AND policyname = 'profiles_links_select_authenticated') THEN
    CREATE POLICY profiles_links_select_authenticated ON public.profiles_links FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- subscription_tiers: client reads available tiers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscription_tiers' AND policyname = 'sub_tiers_select_authenticated') THEN
    CREATE POLICY sub_tiers_select_authenticated ON public.subscription_tiers FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscription_tiers_perks' AND policyname = 'sub_perks_select_authenticated') THEN
    CREATE POLICY sub_perks_select_authenticated ON public.subscription_tiers_perks FOR SELECT TO authenticated USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: Orphaned data cleanup (run separately with destructive mode ON)
-- ═══════════════════════════════════════════════════════════════════════════
-- To clean 2 orphaned likes, run this separately:
-- DELETE FROM likes WHERE post_id NOT IN (SELECT id FROM posts);


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 4: Ensure service_role has full access to everything
-- ═══════════════════════════════════════════════════════════════════════════

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
