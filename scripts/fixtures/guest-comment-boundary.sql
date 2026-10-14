-- Disposable local PostgreSQL only. All rows and identities are synthetic.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE public.events (id integer PRIMARY KEY, title text, description text, start_date timestamptz, end_date timestamptz,
location text, cover_image_url text, image text, images jsonb, flyer_image_url text, video_flyer_url text, video_poster_url text, youtube_video_url text,
price numeric, total_attendees integer, max_attendees integer, host_id text, location_lat numeric, location_lng numeric, location_name text, location_type text,
visibility text, ticketing_enabled boolean, category text, age_restriction text, nsfw boolean, share_slug text, dress_code text, door_policy text,
entry_window text, lineup text, perks text, status text, cancelled_at timestamptz, is_online boolean, event_tz text, lynk_room_id text, is_hidden boolean DEFAULT false, publish_at timestamptz);
CREATE TABLE public.users(id integer PRIMARY KEY, auth_id text, username text, first_name text, avatar_id integer, verified boolean, followers_count integer);
CREATE TABLE public.media(id integer PRIMARY KEY, url text);
CREATE TABLE public.event_likes(event_id integer, user_id integer);
CREATE TABLE public.event_rsvps(event_id integer, user_id text, status text);
CREATE TABLE public.ticket_types(id text, event_id integer, name text, description text, price_cents integer, quantity_total integer, quantity_sold integer,
max_per_user integer, sale_start timestamptz, sale_end timestamptz, perks text, original_price_cents integer, tier text, glow_color text, is_active boolean);
CREATE TABLE public.event_reviews(id integer, event_id integer, rating integer, comment text, created_at timestamptz, user_id integer);
CREATE TABLE public.event_comments(id integer, event_id integer, content text, created_at timestamptz, author_id integer);
CREATE TABLE public.event_co_organizers(event_id integer, user_id text);
CREATE TABLE public.event_invites(event_id integer, invited_user_id text, status text, invited_email text);
CREATE TABLE public."user"(id text, email text, "emailVerified" boolean);
CREATE TABLE public.tickets(event_id integer, user_id text, category text, status text);
CREATE FUNCTION public.get_event_attendee_avatars(integer) RETURNS json LANGUAGE sql AS $$ SELECT '[]'::json $$;
ALTER TABLE public.event_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_comments_select ON public.event_comments FOR SELECT TO public USING (true);
GRANT SELECT ON public.event_comments TO anon, authenticated;
INSERT INTO public.events (id,title,visibility,ticketing_enabled,host_id,status) VALUES (1,'Synthetic public event','public',true,'host','active'),(2,'Synthetic private event','private',true,'host','active'),(3,'Synthetic hidden event','public',true,'host','active');
UPDATE events SET is_hidden=true WHERE id=3;
INSERT INTO public.users VALUES(10,'member','synthetic_member','Member',1,false,0), (20,'host','synthetic_host','Host',NULL,false,0), (30,'invitee','synthetic_invitee','Invitee',NULL,false,0), (40,'coorg','synthetic_coorg','Coorg',NULL,false,0), (50,'holder','synthetic_holder','Holder',NULL,false,0);
INSERT INTO public.media VALUES(1,'https://fixture.invalid/avatar.png');
INSERT INTO public.event_comments VALUES(1,1,'SYNTHETIC MEMBERS ONLY COMMENT',now(),10),(2,2,'SYNTHETIC PRIVATE COMMENT',now(),10),(3,3,'SYNTHETIC HIDDEN COMMENT',now(),10);
INSERT INTO public.event_invites VALUES (2,'invitee','accepted',NULL);
INSERT INTO public.event_co_organizers VALUES (2,'coorg');
INSERT INTO public.tickets VALUES (2,'holder','admission','active');
INSERT INTO public.event_reviews VALUES (1,1,5,'SYNTHETIC PUBLIC REVIEW',now(),10);

-- FIXTURE_BASE_FUNCTIONS
CREATE POLICY event_private_boundary ON public.event_comments AS RESTRICTIVE
  FOR SELECT TO anon, authenticated USING (public.can_view_event(event_id));
GRANT SELECT ON public.event_comments TO service_role;
-- An existing verified-adult write gate must survive this read-only migration.
GRANT INSERT ON public.event_comments TO authenticated;
CREATE POLICY fixture_member_insert ON public.event_comments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY verified_participation_boundary ON public.event_comments AS RESTRICTIVE
  FOR INSERT TO anon, authenticated WITH CHECK (false);

-- Prove the pre-existing exposure, using the actual previous RPC definition.
SET ROLE anon;
SET request.jwt.claims='{"role":"anon"}';
DO $$ BEGIN
  IF public.get_event_detail(1,10)->'top_comments'->0->>'content' IS DISTINCT FROM 'SYNTHETIC MEMBERS ONLY COMMENT'
    OR (SELECT count(*) FROM public.event_comments) <> 1 THEN
    RAISE EXCEPTION 'baseline reproduction did not expose the synthetic public-event comment';
  END IF;
  IF public.get_event_detail(2,20) IS NOT NULL THEN RAISE EXCEPTION 'baseline private access control failed'; END IF;
END $$;
RESET ROLE;

-- BOUNDARY_MIGRATION

-- Authenticated and anonymous JWT fixtures both execute the same actual RPC.
CREATE FUNCTION pg_temp.assert_comments(p_event integer, p_expected integer, p_viewer integer DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE detail json; got integer;
BEGIN
  detail := public.get_event_detail(p_event,p_viewer);
  got := COALESCE(json_array_length(detail->'top_comments'),0);
  IF got <> p_expected THEN RAISE EXCEPTION 'RPC event % expected % comments, got %',p_event,p_expected,got; END IF;
  SELECT count(*) INTO got FROM public.event_comments WHERE event_id=p_event;
  IF got <> p_expected THEN RAISE EXCEPTION 'table event % expected % comments, got %',p_event,p_expected,got; END IF;
END $$;

SET ROLE anon;
SET request.jwt.claims='{"role":"anon"}';
SELECT pg_temp.assert_comments(1,0,20), pg_temp.assert_comments(2,0,20), pg_temp.assert_comments(3,0,20);
DO $$ BEGIN
  IF public.get_event_detail(1)->'event'->>'title' IS DISTINCT FROM 'Synthetic public event' THEN RAISE EXCEPTION 'public event vanished'; END IF;
  IF public.get_event_detail(1)->'top_reviews'->0->>'comment' IS DISTINCT FROM 'SYNTHETIC PUBLIC REVIEW' THEN RAISE EXCEPTION 'public reviews changed'; END IF;
  IF public.get_event_detail(1)::text LIKE '%SYNTHETIC MEMBERS ONLY COMMENT%' THEN RAISE EXCEPTION 'comment still appears elsewhere in payload'; END IF;
END $$;
-- An anon-role token cannot become a member merely by containing a subject.
SET request.jwt.claims='{"role":"anon","sub":"member"}';
SELECT pg_temp.assert_comments(1,0,10);
RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claims='{"role":"authenticated"}';
SELECT pg_temp.assert_comments(1,0,10);
SET request.jwt.claims='{"role":"authenticated","sub":""}';
SELECT pg_temp.assert_comments(1,0,10);
SET request.jwt.claims='{"role":"authenticated","sub":"unknown-profile"}';
SELECT pg_temp.assert_comments(1,0,20);

-- Ordinary members need no adult-verification row to read a public discussion.
SET request.jwt.claims='{"role":"authenticated","sub":"member"}';
SELECT pg_temp.assert_comments(1,1,20), pg_temp.assert_comments(2,0,20), pg_temp.assert_comments(3,0,20);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.event_comments VALUES (99,1,'SHOULD NOT BE WRITABLE',now(),10);
    RAISE EXCEPTION 'read migration bypassed participation INSERT gate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SET request.jwt.claims='{"role":"authenticated","sub":"host"}';
SELECT pg_temp.assert_comments(1,1), pg_temp.assert_comments(2,1), pg_temp.assert_comments(3,1);
SET request.jwt.claims='{"role":"authenticated","sub":"invitee"}';
SELECT pg_temp.assert_comments(2,1), pg_temp.assert_comments(3,0);
SET request.jwt.claims='{"role":"authenticated","sub":"coorg"}';
SELECT pg_temp.assert_comments(2,1);
SET request.jwt.claims='{"role":"authenticated","sub":"holder"}';
SELECT pg_temp.assert_comments(2,1);
RESET ROLE;
SET ROLE service_role;
SET request.jwt.claims='{"role":"service_role"}';
SELECT pg_temp.assert_comments(1,1), pg_temp.assert_comments(2,1), pg_temp.assert_comments(3,1);
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(p.proacl) a
    WHERE p.oid='public.can_read_event_comments(integer)'::regprocedure
      AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
    RAISE EXCEPTION 'helper unexpectedly grants PUBLIC execution';
  END IF;
  IF NOT has_function_privilege('anon','public.can_read_event_comments(integer)','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.can_read_event_comments(integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.can_read_event_comments(integer)','EXECUTE') THEN
    RAISE EXCEPTION 'helper missing required caller grant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='event_comments'
    AND policyname='verified_participation_boundary' AND cmd='INSERT' AND with_check='false') THEN
    RAISE EXCEPTION 'existing verified participation write gate was changed';
  END IF;
END $$;
SELECT 'PASS: member-only event comments, JWT identity, private access, reviews and write-gate preservation';
