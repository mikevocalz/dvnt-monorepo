\set ON_ERROR_STOP on
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.events(id integer PRIMARY KEY);
\ir ../apps/mobile/supabase/migrations/20261011204000_event_ticket_widgets.sql
INSERT INTO events VALUES(1);
INSERT INTO event_ticket_widgets(event_id,allowed_origin,published,updated_by) VALUES(1,'https://merchant.example.com',true,'fixture-owner');
DO $$ BEGIN
 IF has_table_privilege('anon','event_ticket_widgets','SELECT') OR has_table_privilege('authenticated','event_ticket_widgets','UPDATE') THEN RAISE EXCEPTION 'settings exposed'; END IF;
 IF NOT has_table_privilege('service_role','event_ticket_widgets','SELECT,INSERT,UPDATE') THEN RAISE EXCEPTION 'service role unavailable'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.event_ticket_widgets'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 BEGIN INSERT INTO event_ticket_widgets(event_id,allowed_origin,published,updated_by) VALUES(1,'https://merchant.example.com',true,'fixture-owner');RAISE EXCEPTION 'duplicate event permitted';EXCEPTION WHEN unique_violation THEN NULL;END;
 BEGIN UPDATE event_ticket_widgets SET revision=0 WHERE event_id=1;RAISE EXCEPTION 'invalid revision permitted';EXCEPTION WHEN check_violation THEN NULL;END;
 DELETE FROM events WHERE id=1;
 IF EXISTS(SELECT 1 FROM event_ticket_widgets) THEN RAISE EXCEPTION 'deleted event left public widget'; END IF;
END $$;
SELECT 'PASS: actual widget migration, constraints, role privileges and deletion';
