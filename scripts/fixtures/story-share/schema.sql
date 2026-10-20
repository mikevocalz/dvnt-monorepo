-- Synthetic, isolated PostgreSQL fixture; no production accounts or network.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TYPE enum_posts_visibility AS ENUM ('public','followers','private');
CREATE TYPE enum_stories_visibility AS ENUM ('public','followers','close_friends');
CREATE TYPE enum_media_type AS ENUM ('image','video');
CREATE TABLE media(id serial PRIMARY KEY,url text NOT NULL,type enum_media_type,mime_type text,filename text UNIQUE);
CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE,username text,first_name text,avatar_id integer REFERENCES media(id),is_private boolean DEFAULT false,banned_at timestamptz);
CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb NOT NULL DEFAULT '{}');
CREATE TABLE posts(id integer PRIMARY KEY,author_id integer REFERENCES users(id),visibility enum_posts_visibility DEFAULT 'public',content text,post_kind text DEFAULT 'media',is_nsfw boolean DEFAULT false,moderation_status text DEFAULT 'approved',deleted_at timestamptz,is_hidden boolean DEFAULT false);
CREATE TABLE posts_media(id text PRIMARY KEY,_parent_id integer REFERENCES posts(id) ON DELETE CASCADE,_order integer,type text,url text,thumbnail text);
CREATE TABLE post_text_slides(id serial PRIMARY KEY,post_id integer REFERENCES posts(id) ON DELETE CASCADE,slide_index integer,content text);
CREATE TABLE events(id integer PRIMARY KEY,host_id text,title text,cover_image_url text,visibility text DEFAULT 'public',status text DEFAULT 'active',is_hidden boolean DEFAULT false,publish_at timestamptz);
CREATE TABLE blocks(blocker_id integer,blocked_id integer);
CREATE TABLE follows(follower_id integer,following_id integer);
CREATE TABLE stories(id serial PRIMARY KEY,author_id text,media_id integer NOT NULL REFERENCES media(id),thumbnail_id integer REFERENCES media(id),expires_at timestamptz NOT NULL,visibility enum_stories_visibility DEFAULT 'public',created_at timestamptz DEFAULT now());
CREATE TABLE stories_stickers(id text PRIMARY KEY,_parent_id integer REFERENCES stories(id) ON DELETE CASCADE,_order integer,type text,data jsonb);
CREATE TABLE conversations(id serial PRIMARY KEY,is_group boolean DEFAULT false,last_message_at timestamptz);
CREATE TABLE conversations_rels(id serial PRIMARY KEY,parent_id integer REFERENCES conversations(id) ON DELETE CASCADE,users_id text,path text);
CREATE TABLE messages(id serial PRIMARY KEY,conversation_id integer REFERENCES conversations(id),sender_id integer REFERENCES users(id),content text NOT NULL,metadata jsonb,created_at timestamptz DEFAULT now(),read_at timestamptz);
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
-- Deliberately permissive legacy client grants exercise the new boundary.
GRANT SELECT,INSERT,UPDATE ON stories,messages TO anon,authenticated;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_story_read ON stories FOR SELECT USING(true);
CREATE POLICY legacy_story_insert ON stories FOR INSERT WITH CHECK(true);
CREATE POLICY legacy_story_update ON stories FOR UPDATE USING(true) WITH CHECK(true);
INSERT INTO users(id,auth_id,username,first_name) VALUES
  (1,'fixture-sharer','sharer','Sharer'),(2,'fixture-author','author','Author'),
  (3,'fixture-host','host','Host'),(4,'fixture-other','other','Other');
INSERT INTO user_settings VALUES ('fixture-author','{"messages":{"allowAll":true}}'),('fixture-host','{"messages":{"allowAll":true}}');
INSERT INTO posts(id,author_id,content) VALUES(101,2,'Canonical caption'),(102,1,'Own post'),(103,2,'Another post');
INSERT INTO posts(id,author_id,content,post_kind) VALUES(104,2,'Text caption','text'),(105,2,'Animated post','media');
INSERT INTO post_text_slides(post_id,slide_index,content) VALUES(104,0,'First canonical text slide'),(104,1,'Second slide');
INSERT INTO posts_media VALUES('101_0',101,0,'image','https://fixture.invalid/post.jpg',NULL),('103_0',103,0,'video','https://fixture.invalid/post.mp4','https://fixture.invalid/post-thumb.jpg');
INSERT INTO events(id,host_id,title,cover_image_url) VALUES(201,'fixture-host','Canonical event','https://fixture.invalid/event.jpg'),(202,'fixture-host','No cover',NULL);
INSERT INTO posts_media VALUES('105_0',105,0,'animated_video','https://fixture.invalid/animated.mp4','https://fixture.invalid/animated.jpg');
