\set ON_ERROR_STOP on
-- Disposable CI database only. These are explicit schema fixtures, not a production restore.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA payload;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE TABLE public."user"(id text PRIMARY KEY,banned boolean);
CREATE TABLE public.users(id integer PRIMARY KEY,auth_id text,created_at timestamptz,banned_at timestamptz);
CREATE TABLE payload.members(app_user_id text,status text);
CREATE TABLE public.verified_admission_policy(id integer,denylist text[]);
CREATE TABLE public.identity_verifications(user_id text,status text,date_of_birth date,failure_code text);
INSERT INTO public."user" VALUES('legacy',false),('new',false),('other',false);
INSERT INTO public.users VALUES(1,'legacy','2026-01-01',null),(2,'new','2026-08-01',null),(3,'other','2026-08-01',null);
INSERT INTO public.verified_admission_policy VALUES(1,'{}');
\ir ../apps/mobile/supabase/migrations/20261011203000_legacy_adult_access.sql
DO $$ BEGIN
 IF NOT legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'legacy denied'; END IF;
 IF legacy_adult_content_access('new') OR legacy_adult_content_access(null) THEN RAISE EXCEPTION 'new/anon admitted'; END IF;
 IF has_table_privilege('anon','legacy_adult_access','SELECT') OR has_table_privilege('authenticated','legacy_adult_access','INSERT') OR has_function_privilege('authenticated','legacy_adult_content_access(text)','EXECUTE') THEN RAISE EXCEPTION 'grant exposure'; END IF;
 UPDATE users SET auth_id='other' WHERE id=1;
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'identity reassignment inherited access'; END IF;
 UPDATE users SET auth_id='legacy',banned_at=now() WHERE id=1;
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'banned admitted'; END IF;
 UPDATE users SET banned_at=null WHERE id=1;
 UPDATE public."user" SET banned=true WHERE id='legacy';
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'auth banned admitted'; END IF;
 UPDATE public."user" SET banned=false WHERE id='legacy';
 INSERT INTO payload.members VALUES('1','suspended');
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'moderation suspended admitted'; END IF;
 DELETE FROM payload.members;
 UPDATE verified_admission_policy SET denylist=ARRAY['legacy'];
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'denylist admitted'; END IF;
 UPDATE verified_admission_policy SET denylist='{}';
 INSERT INTO identity_verifications VALUES('legacy','failed','2015-01-01','underage');
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'underage admitted'; END IF;
 UPDATE identity_verifications SET date_of_birth='1990-01-01',failure_code='duplicate_identity';
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'duplicate admitted'; END IF;
 DELETE FROM identity_verifications;
 UPDATE legacy_adult_access SET revoked_at=now() WHERE auth_id='legacy';
 IF legacy_adult_content_access('legacy') THEN RAISE EXCEPTION 'revoked admitted'; END IF;
 UPDATE legacy_adult_access SET revoked_at=null WHERE auth_id='legacy';
 PERFORM set_config('request.jwt.claims','{"sub":"legacy","role":"authenticated"}',true);
 IF NOT viewer_is_verified_adult() THEN RAISE EXCEPTION 'viewer and writer disagree'; END IF;
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 IF viewer_is_verified_adult() THEN RAISE EXCEPTION 'anonymous viewer admitted'; END IF;
END $$;
SELECT 'PASS: legacy entitlement, revocation, identity isolation and access controls';
