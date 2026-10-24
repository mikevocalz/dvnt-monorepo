CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public."user"(id text PRIMARY KEY,banned boolean DEFAULT false);
CREATE TABLE public.media(id integer PRIMARY KEY,url text);
CREATE TABLE public.users(id integer PRIMARY KEY,auth_id text UNIQUE,username text,first_name text,is_private boolean DEFAULT false,avatar_id integer,banned_at timestamptz);
CREATE TABLE public.identity_verifications(user_id text PRIMARY KEY,status text,date_of_birth date,failure_code text);
CREATE TABLE public.verified_admission_policy(id integer PRIMARY KEY,denylist text[] DEFAULT '{}');
CREATE TABLE public.blocks(blocker_id integer,blocked_id integer);
CREATE TABLE public.member_proximity_presence(user_id text PRIMARY KEY,latitude double precision,longitude double precision);
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role;
INSERT INTO public.verified_admission_policy(id) VALUES(1);
INSERT INTO public."user"(id) SELECT unnest(ARRAY['viewer','near','far','private','blocked','minor','expired','denied']);
INSERT INTO public.users(id,auth_id,username,first_name)
 SELECT row_number() OVER()::integer,id,id,id FROM public."user";
INSERT INTO public.identity_verifications(user_id,status,date_of_birth)
 SELECT id,'passed',date '1990-01-01' FROM public."user";
CREATE SCHEMA payload; CREATE TABLE payload.members(app_user_id text,status text);
GRANT USAGE ON SCHEMA payload TO service_role; GRANT SELECT ON payload.members TO service_role;
CREATE TABLE public.user_settings(auth_id text PRIMARY KEY,settings jsonb);
GRANT SELECT ON public.user_settings TO service_role;
