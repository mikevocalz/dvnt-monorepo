-- Empty, synthetic PostgreSQL fixture. No production connection or credentials.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TYPE public.enum_posts_visibility AS ENUM ('public', 'followers', 'private');
CREATE TABLE public.users (id integer PRIMARY KEY, username text, first_name text, verified boolean DEFAULT false);
INSERT INTO public.users VALUES (1, 'fixture', 'Fixture', false);
CREATE TABLE public.posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id integer REFERENCES public.users(id), content text NOT NULL DEFAULT '',
  post_kind text NOT NULL DEFAULT 'media', text_theme text DEFAULT 'graphite',
  location text, is_nsfw boolean DEFAULT false,
  visibility public.enum_posts_visibility DEFAULT 'public',
  likes_count integer DEFAULT 0, comments_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.posts_media (
  id text PRIMARY KEY, _parent_id bigint NOT NULL REFERENCES public.posts(id),
  type text NOT NULL CHECK (type IN ('image','video','gif','livePhoto','thumbnail')),
  url text NOT NULL, _order integer NOT NULL,
  mime_type text, live_photo_video_url text
);
CREATE TABLE public.post_text_slides (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES public.posts(id), slide_index integer NOT NULL, content text NOT NULL
);
