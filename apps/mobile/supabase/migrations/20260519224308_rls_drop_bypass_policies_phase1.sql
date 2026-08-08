-- Recovered from supabase_migrations.schema_migrations on the linked
-- project (20260519224308 :: rls_drop_bypass_policies_phase1). This migration was applied to production
-- out-of-band and had no file in this directory; the SQL below is the
-- statement array the ledger recorded, so the repo now replays to the
-- schema production actually runs. Already recorded as applied.

-- Phase 1 of the RLS bypass cleanup. The JWT bridge is live and the
-- proper host-id-checking policies fire correctly, so the role-specific
-- qual=true bypasses can come out.
--
-- All 117 policies in this migration are *pure duplicates* — the table
-- already has a `public`-targeted sibling policy granting the same
-- access (or stricter, in the case of ticket_types where the public
-- sibling has the host_id check). PostgreSQL OR's RLS policies, so
-- dropping the qual=true bypass tightens to the public sibling's
-- actual rule. Verified end-to-end on device:
--   - reads still return data (posts, events, ticket_types, users)
--   - host writes succeed via JWT-bridge sub claim
--     (audit134239 inserted ticket_type on event 39 → 201)

DROP POLICY IF EXISTS anon_select ON public.ads_config;
DROP POLICY IF EXISTS anon_select ON public.bookmarks;
DROP POLICY IF EXISTS bookmarks_delete_anon ON public.bookmarks;
DROP POLICY IF EXISTS bookmarks_insert_anon ON public.bookmarks;
DROP POLICY IF EXISTS bookmarks_select_all ON public.bookmarks;
DROP POLICY IF EXISTS bookmarks_select_anon ON public.bookmarks;
DROP POLICY IF EXISTS anon_select ON public.checkins;
DROP POLICY IF EXISTS anon_select ON public.cities;
DROP POLICY IF EXISTS anon_select ON public.comment_likes;
DROP POLICY IF EXISTS comment_likes_delete_anon ON public.comment_likes;
DROP POLICY IF EXISTS comment_likes_insert_anon ON public.comment_likes;
DROP POLICY IF EXISTS comment_likes_select_all ON public.comment_likes;
DROP POLICY IF EXISTS comment_likes_select_anon ON public.comment_likes;
DROP POLICY IF EXISTS anon_select ON public.comments;
DROP POLICY IF EXISTS comments_delete_anon ON public.comments;
DROP POLICY IF EXISTS comments_insert_anon ON public.comments;
DROP POLICY IF EXISTS comments_select_all ON public.comments;
DROP POLICY IF EXISTS comments_select_anon ON public.comments;
DROP POLICY IF EXISTS anon_select ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_anon ON public.conversations;
DROP POLICY IF EXISTS conversations_insert_authenticated ON public.conversations;
DROP POLICY IF EXISTS conversations_select_all ON public.conversations;
DROP POLICY IF EXISTS conversations_select_anon ON public.conversations;
DROP POLICY IF EXISTS anon_select ON public.conversations_rels;
DROP POLICY IF EXISTS conv_rels_insert_anon ON public.conversations_rels;
DROP POLICY IF EXISTS conv_rels_insert_authenticated ON public.conversations_rels;
DROP POLICY IF EXISTS conv_rels_select_all ON public.conversations_rels;
DROP POLICY IF EXISTS conv_rels_select_anon ON public.conversations_rels;
DROP POLICY IF EXISTS anon_select ON public.event_co_organizers;
DROP POLICY IF EXISTS coorg_select_anon ON public.event_co_organizers;
DROP POLICY IF EXISTS anon_select ON public.event_comment_tags;
DROP POLICY IF EXISTS event_comments_delete_anon ON public.event_comments;
DROP POLICY IF EXISTS event_comments_insert_anon ON public.event_comments;
DROP POLICY IF EXISTS event_comments_insert_authenticated ON public.event_comments;
DROP POLICY IF EXISTS anon_select ON public.event_invites;
DROP POLICY IF EXISTS event_reviews_insert_anon ON public.event_reviews;
DROP POLICY IF EXISTS event_reviews_insert_authenticated ON public.event_reviews;
DROP POLICY IF EXISTS event_reviews_update_anon ON public.event_reviews;
DROP POLICY IF EXISTS anon_select ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_insert_anon ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_insert_authenticated ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_select_all ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_select_anon ON public.event_rsvps;
DROP POLICY IF EXISTS event_rsvps_update_anon ON public.event_rsvps;
DROP POLICY IF EXISTS anon_select ON public.events;
DROP POLICY IF EXISTS events_insert_authenticated ON public.events;
DROP POLICY IF EXISTS events_select_all ON public.events;
DROP POLICY IF EXISTS events_select_anon ON public.events;
DROP POLICY IF EXISTS anon_select ON public.follows;
DROP POLICY IF EXISTS follows_delete_anon ON public.follows;
DROP POLICY IF EXISTS follows_insert_anon ON public.follows;
DROP POLICY IF EXISTS follows_select_all ON public.follows;
DROP POLICY IF EXISTS follows_select_anon ON public.follows;
DROP POLICY IF EXISTS anon_select ON public.likes;
DROP POLICY IF EXISTS likes_delete_anon ON public.likes;
DROP POLICY IF EXISTS likes_insert_anon ON public.likes;
DROP POLICY IF EXISTS likes_select_all ON public.likes;
DROP POLICY IF EXISTS likes_select_anon ON public.likes;
DROP POLICY IF EXISTS anon_select ON public.messages;
DROP POLICY IF EXISTS messages_insert_anon ON public.messages;
DROP POLICY IF EXISTS messages_insert_authenticated ON public.messages;
DROP POLICY IF EXISTS messages_select_all ON public.messages;
DROP POLICY IF EXISTS messages_select_anon ON public.messages;
DROP POLICY IF EXISTS anon_select ON public.order_timeline;
DROP POLICY IF EXISTS anon_select ON public.orders;
DROP POLICY IF EXISTS anon_select ON public.organizer_accounts;
DROP POLICY IF EXISTS anon_select ON public.organizer_branding;
DROP POLICY IF EXISTS anon_select ON public.payouts;
DROP POLICY IF EXISTS anon_select ON public.post_tags;
DROP POLICY IF EXISTS post_tags_delete_anon ON public.post_tags;
DROP POLICY IF EXISTS post_tags_insert_anon ON public.post_tags;
DROP POLICY IF EXISTS post_tags_select_anon ON public.post_tags;
DROP POLICY IF EXISTS post_tags_update_anon ON public.post_tags;
DROP POLICY IF EXISTS anon_select ON public.posts;
DROP POLICY IF EXISTS posts_delete_anon ON public.posts;
DROP POLICY IF EXISTS posts_insert_anon ON public.posts;
DROP POLICY IF EXISTS posts_select_all ON public.posts;
DROP POLICY IF EXISTS posts_select_anon ON public.posts;
DROP POLICY IF EXISTS posts_update_anon ON public.posts;
DROP POLICY IF EXISTS anon_select ON public.posts_media;
DROP POLICY IF EXISTS posts_media_insert_anon ON public.posts_media;
DROP POLICY IF EXISTS posts_media_select_all ON public.posts_media;
DROP POLICY IF EXISTS anon_select ON public.rate_limit_attempts;
DROP POLICY IF EXISTS anon_select ON public.refund_requests;
DROP POLICY IF EXISTS anon_select ON public.room_comments;
DROP POLICY IF EXISTS room_comments_select_all ON public.room_comments;
DROP POLICY IF EXISTS anon_select ON public.sneaky_access;
DROP POLICY IF EXISTS anon_select ON public.stories;
DROP POLICY IF EXISTS stories_insert_anon ON public.stories;
DROP POLICY IF EXISTS stories_select_all ON public.stories;
DROP POLICY IF EXISTS stories_select_anon ON public.stories;
DROP POLICY IF EXISTS story_views_insert_anon ON public.story_views;
DROP POLICY IF EXISTS story_views_insert_authenticated ON public.story_views;
DROP POLICY IF EXISTS anon_select ON public.stripe_customers;
DROP POLICY IF EXISTS anon_select ON public.ticket_holds;
DROP POLICY IF EXISTS anon_select ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_insert_anon ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_insert_authenticated ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_select_all ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_select_anon ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_update_anon ON public.ticket_types;
DROP POLICY IF EXISTS ticket_types_update_authenticated ON public.ticket_types;
DROP POLICY IF EXISTS anon_select ON public.tickets;
DROP POLICY IF EXISTS tickets_select_all ON public.tickets;
DROP POLICY IF EXISTS anon_select ON public.user_presence;
DROP POLICY IF EXISTS anon_select ON public.users;
DROP POLICY IF EXISTS users_select_all ON public.users;
DROP POLICY IF EXISTS users_select_anon ON public.users;
DROP POLICY IF EXISTS users_update_anon ON public.users;
DROP POLICY IF EXISTS users_update_authenticated ON public.users;
DROP POLICY IF EXISTS anon_select ON public.video_rate_limits;
DROP POLICY IF EXISTS anon_select ON public.video_room_bans;
DROP POLICY IF EXISTS video_room_bans_select_all ON public.video_room_bans;
DROP POLICY IF EXISTS anon_select ON public.video_room_events;
DROP POLICY IF EXISTS video_room_events_select_all ON public.video_room_events;
DROP POLICY IF EXISTS anon_select ON public.video_room_tokens;
DROP POLICY IF EXISTS video_room_tokens_select_all ON public.video_room_tokens;
DROP POLICY IF EXISTS video_rooms_select_all ON public.video_rooms;;
