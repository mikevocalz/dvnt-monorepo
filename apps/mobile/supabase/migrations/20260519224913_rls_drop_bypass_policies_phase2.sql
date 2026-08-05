-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519224913 :: rls_drop_bypass_policies_phase2). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Phase 2 cleanup. Either drop role-specific dupes that overlap a
-- public-targeted sibling (no behavior change), or — for tables that
-- never had a public sibling — drop all role-specific qual=true dupes
-- and create one canonical public-targeted policy in their place.

-- call_signals: public *_insert/select/update already cover; keep
-- "Anon can delete" as the only DELETE path (no other delete policy).
DROP POLICY IF EXISTS "Anon can insert call signals" ON public.call_signals;
DROP POLICY IF EXISTS "Anon can read call signals" ON public.call_signals;
DROP POLICY IF EXISTS "Anon can update call signals" ON public.call_signals;
DROP POLICY IF EXISTS "Users can insert call signals" ON public.call_signals;
DROP POLICY IF EXISTS "Users can read their own call signals" ON public.call_signals;
DROP POLICY IF EXISTS "Users can update call signals" ON public.call_signals;

-- categories: 3 role-specific select dups; no public sibling. Consolidate.
DROP POLICY IF EXISTS categories_select_all ON public.categories;
DROP POLICY IF EXISTS categories_select_anon ON public.categories;
DROP POLICY IF EXISTS categories_select_authenticated ON public.categories;
CREATE POLICY categories_select ON public.categories FOR SELECT TO public USING (true);

-- event_comments: 4 select dups, no public select sibling.
DROP POLICY IF EXISTS anon_select ON public.event_comments;
DROP POLICY IF EXISTS event_comments_select_all ON public.event_comments;
DROP POLICY IF EXISTS event_comments_select_anon ON public.event_comments;
DROP POLICY IF EXISTS event_comments_select_authenticated ON public.event_comments;
CREATE POLICY event_comments_select ON public.event_comments FOR SELECT TO public USING (true);

-- event_likes: no public sibling for SELECT/INSERT/DELETE; consolidate.
DROP POLICY IF EXISTS event_likes_select_all ON public.event_likes;
DROP POLICY IF EXISTS event_likes_select_anon ON public.event_likes;
DROP POLICY IF EXISTS event_likes_select_authenticated ON public.event_likes;
CREATE POLICY event_likes_select ON public.event_likes FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS event_likes_insert_anon ON public.event_likes;
DROP POLICY IF EXISTS event_likes_insert_authenticated ON public.event_likes;
CREATE POLICY event_likes_insert ON public.event_likes FOR INSERT TO public WITH CHECK (true);
DROP POLICY IF EXISTS event_likes_delete_anon ON public.event_likes;
DROP POLICY IF EXISTS event_likes_delete_own ON public.event_likes;
CREATE POLICY event_likes_delete ON public.event_likes FOR DELETE TO public USING (true);

-- event_reviews: 4 select dups, no public select sibling.
DROP POLICY IF EXISTS anon_select ON public.event_reviews;
DROP POLICY IF EXISTS event_reviews_select_all ON public.event_reviews;
DROP POLICY IF EXISTS event_reviews_select_anon ON public.event_reviews;
DROP POLICY IF EXISTS event_reviews_select_authenticated ON public.event_reviews;
CREATE POLICY event_reviews_select ON public.event_reviews FOR SELECT TO public USING (true);

-- event_rsvps: drop role-specific update + delete dups; keep public.
DROP POLICY IF EXISTS event_rsvps_update_own ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_delete_anon ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_delete_own ON public.event_rsvps;
CREATE POLICY event_rsvps_delete ON public.event_rsvps FOR DELETE TO public USING (true);

-- events: events_insert_own duplicates "Anyone can create events".
DROP POLICY IF EXISTS events_insert_own ON public.events;

-- feature_flags: 3 role-specific select dups; no public sibling.
DROP POLICY IF EXISTS feature_flags_select_all ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_select_anon ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_select_authenticated ON public.feature_flags;
CREATE POLICY feature_flags_select ON public.feature_flags FOR SELECT TO public USING (true);

-- hashtags: same pattern.
DROP POLICY IF EXISTS hashtags_select_all ON public.hashtags;
DROP POLICY IF EXISTS hashtags_select_anon ON public.hashtags;
DROP POLICY IF EXISTS hashtags_select_authenticated ON public.hashtags;
CREATE POLICY hashtags_select ON public.hashtags FOR SELECT TO public USING (true);

-- media: 3 role-specific select dups; consolidate. Also drop insert_anon (cleanup).
DROP POLICY IF EXISTS media_select_all ON public.media;
DROP POLICY IF EXISTS media_select_anon ON public.media;
DROP POLICY IF EXISTS media_select_authenticated ON public.media;
CREATE POLICY media_select ON public.media FOR SELECT TO public USING (true);

-- profiles: 3 select dups.
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
DROP POLICY IF EXISTS profiles_select_anon ON public.profiles;
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO public USING (true);

-- profiles_links: 3 select dups.
DROP POLICY IF EXISTS profiles_links_select_all ON public.profiles_links;
DROP POLICY IF EXISTS profiles_links_select_anon ON public.profiles_links;
DROP POLICY IF EXISTS profiles_links_select_authenticated ON public.profiles_links;
CREATE POLICY profiles_links_select ON public.profiles_links FOR SELECT TO public USING (true);

-- stories: "Public stories viewable by everyone" (narrower) is the
-- subset of "Stories visibility policy" (wider). The wider one
-- covers it. Drop the narrower. Also collapse update dups.
DROP POLICY IF EXISTS "Public stories viewable by everyone" ON public.stories;
DROP POLICY IF EXISTS stories_update_anon ON public.stories;
DROP POLICY IF EXISTS stories_update_own ON public.stories;
CREATE POLICY stories_update ON public.stories FOR UPDATE TO public USING (true) WITH CHECK (true);

-- story_tags: 3 select dups.
DROP POLICY IF EXISTS story_tags_select_all ON public.story_tags;
DROP POLICY IF EXISTS story_tags_select_anon ON public.story_tags;
DROP POLICY IF EXISTS story_tags_select_authenticated ON public.story_tags;
CREATE POLICY story_tags_select ON public.story_tags FOR SELECT TO public USING (true);

-- story_views: 3 select dups.
DROP POLICY IF EXISTS anon_select ON public.story_views;
DROP POLICY IF EXISTS story_views_select_all ON public.story_views;
DROP POLICY IF EXISTS story_views_select_anon ON public.story_views;
CREATE POLICY story_views_select ON public.story_views FOR SELECT TO public USING (true);

-- subscription_tiers: 3 select dups.
DROP POLICY IF EXISTS sub_tiers_select_anon ON public.subscription_tiers;
DROP POLICY IF EXISTS sub_tiers_select_authenticated ON public.subscription_tiers;
DROP POLICY IF EXISTS subscription_tiers_select_all ON public.subscription_tiers;
CREATE POLICY subscription_tiers_select ON public.subscription_tiers FOR SELECT TO public USING (true);

-- subscription_tiers_perks: 3 select dups.
DROP POLICY IF EXISTS sub_perks_select_anon ON public.subscription_tiers_perks;
DROP POLICY IF EXISTS sub_perks_select_authenticated ON public.subscription_tiers_perks;
DROP POLICY IF EXISTS subscription_tiers_perks_select_all ON public.subscription_tiers_perks;
CREATE POLICY subscription_tiers_perks_select ON public.subscription_tiers_perks FOR SELECT TO public USING (true);

-- video_room_members: keep public vrm_select; drop role-specific.
DROP POLICY IF EXISTS anon_read_video_room_members ON public.video_room_members;
DROP POLICY IF EXISTS authenticated_read_video_room_members ON public.video_room_members;

-- video_rooms: keep public video_rooms_select; drop role-specific.
DROP POLICY IF EXISTS anon_read_video_rooms ON public.video_rooms;
DROP POLICY IF EXISTS authenticated_read_video_rooms ON public.video_rooms;;
