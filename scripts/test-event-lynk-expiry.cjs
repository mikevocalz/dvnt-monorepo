#!/usr/bin/env node
/** Synthetic SQL execution only. --sql emits for disposable native Postgres;
 * --pglite runs the same fixture locally. --baseline must fail, proving that
 * the pre-fix generic sweep prematurely ends scheduled event rooms. */
const fs = require('node:fs');
const path = require('node:path');
const migrations = path.join(__dirname, '../apps/mobile/supabase/migrations');
const previous = fs.readFileSync(path.join(migrations, '20261006220500_call_session_limit_five_minutes.sql'), 'utf8');
const baselineFunction = previous.slice(previous.indexOf('CREATE OR REPLACE FUNCTION public.end_expired_video_rooms()'), previous.indexOf('COMMENT ON COLUMN public.video_rooms.ends_at'));
const prerequisite = fs.readFileSync(path.join(migrations, '20261029145200_event_lynk_lifecycle_guards.sql'), 'utf8');
const fix = fs.readFileSync(path.join(migrations, '20261029145300_event_lynk_scheduled_expiry.sql'), 'utf8');
const sql = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.video_rooms (
 id integer PRIMARY KEY, uuid uuid UNIQUE DEFAULT gen_random_uuid(), room_kind text DEFAULT 'lynk',
 status text DEFAULT 'open', ends_at timestamptz, created_by text DEFAULT 'fixture-host',
 ended_at timestamptz, participant_count integer DEFAULT 1, created_at timestamptz DEFAULT now(), is_public boolean DEFAULT false
);
CREATE TABLE public.events(id integer PRIMARY KEY, lynk_room_id uuid, start_date timestamptz, end_date timestamptz, host_id text DEFAULT 'fixture-host', status text DEFAULT 'active');
CREATE TABLE public.video_room_tokens(room_id integer, revoked boolean DEFAULT false);
CREATE TABLE public.event_lynk_lifecycle(event_id integer, state text DEFAULT 'scheduled', ended_at timestamptz, updated_at timestamptz);
CREATE TABLE public.video_room_members(room_id integer, status text DEFAULT 'active', left_at timestamptz, hand_raised boolean DEFAULT true);
CREATE TABLE public.video_room_events(room_id integer, type text, actor_id text, payload jsonb);
INSERT INTO video_rooms(id, room_kind, ends_at, status) VALUES
 (1,'lynk',now()-interval '1 hour','open'),
 (2,'lynk',now()-interval '1 hour','open'),
 (3,'call',now()-interval '1 hour','open'),
 (4,'lynk',now()+interval '1 hour','open'),
 (5,'lynk',NULL,'open'),
 (6,'lynk',now()-interval '1 hour','ended');
INSERT INTO events(id,lynk_room_id,start_date) SELECT id,uuid,now()+interval '1 day' FROM video_rooms WHERE id IN (2,3);
INSERT INTO video_room_members(room_id) SELECT id FROM video_rooms;
${prerequisite}
${process.argv.includes('--baseline') ? baselineFunction : fix}
DO $$ DECLARE n integer; BEGIN
 n := public.end_expired_video_rooms();
 IF n <> 2 THEN RAISE EXCEPTION 'Expected only ordinary expired room and connected call to end; ended %', n; END IF;
 IF EXISTS (SELECT 1 FROM video_rooms WHERE id IN (2,4,5) AND status <> 'open') THEN
  RAISE EXCEPTION 'Scheduled event, unexpired or unlimited room was prematurely ended';
 END IF;
 IF EXISTS (SELECT 1 FROM video_rooms WHERE id IN (1,3) AND (status <> 'ended' OR participant_count <> 0 OR ended_at IS NULL)) THEN
  RAISE EXCEPTION 'Ordinary/call expiry cleanup regressed';
 END IF;
 IF EXISTS (SELECT 1 FROM video_room_members WHERE room_id IN (1,3) AND (status <> 'left' OR left_at IS NULL OR hand_raised)) THEN
  RAISE EXCEPTION 'Expired members were not cleaned up';
 END IF;
 IF (SELECT status FROM video_room_members WHERE room_id=2) <> 'active' THEN
  RAISE EXCEPTION 'Scheduled event member was evicted';
 END IF;
 IF (SELECT count(*) FROM video_room_events) <> 2 THEN RAISE EXCEPTION 'Wrong event audit count'; END IF;
 IF public.end_expired_video_rooms() <> 0 THEN RAISE EXCEPTION 'Sweep is not idempotent'; END IF;
 IF has_function_privilege('anon','public.end_expired_video_rooms()','execute') OR
    has_function_privilege('authenticated','public.end_expired_video_rooms()','execute') OR
    NOT has_function_privilege('service_role','public.end_expired_video_rooms()','execute') THEN
  RAISE EXCEPTION 'Service-only execution changed';
 END IF;
END $$;
-- The linked room's original deadline is past, but its shifted event deadline
-- is still tomorrow. Then move the synthetic schedule past its five-minute cap.
UPDATE video_rooms SET created_at=now()-interval '2 hours', ends_at=now()-interval '115 minutes' WHERE id=2;
INSERT INTO video_room_tokens VALUES(2,false);
INSERT INTO event_lynk_lifecycle(event_id) VALUES(2);
DO $$ BEGIN
 IF public.expire_event_lynk_room(2) THEN RAISE EXCEPTION 'Future event prematurely expired'; END IF;
END $$;
UPDATE events SET start_date=now()-interval '1 hour', end_date=now()+interval '2 hours' WHERE id=2;
DO $$ BEGIN
 IF NOT public.expire_event_lynk_room(2) THEN RAISE EXCEPTION 'Shifted five-minute cap not enforced'; END IF;
 IF public.expire_event_lynk_room(2) THEN RAISE EXCEPTION 'Event expiry is not idempotent'; END IF;
 IF (SELECT count(*) FROM video_room_events WHERE room_id=2) <> 1 THEN RAISE EXCEPTION 'Event audit duplicated'; END IF;
 IF EXISTS (SELECT 1 FROM video_room_members WHERE room_id=2 AND status='active') OR
    EXISTS (SELECT 1 FROM video_room_tokens WHERE room_id=2 AND revoked=false) OR
    EXISTS (SELECT 1 FROM video_rooms WHERE id=2 AND participant_count<>0) OR
    EXISTS (SELECT 1 FROM event_lynk_lifecycle WHERE event_id=2 AND state<>'ended') THEN
  RAISE EXCEPTION 'Atomic event expiry cleanup incomplete';
 END IF;
 IF has_function_privilege('authenticated','public.expire_event_lynk_room(integer)','execute') OR
    NOT has_function_privilege('service_role','public.expire_event_lynk_room(integer)','execute') THEN
  RAISE EXCEPTION 'Event expiry must remain service-only';
 END IF;
END $$;
-- Legacy nullable status cannot be treated as cancellation; explicit
-- cancellation still cleans up a malformed legacy schedule.
INSERT INTO video_rooms(id,ends_at) VALUES(11,NULL),(12,NULL);
INSERT INTO events(id,lynk_room_id,start_date,status) SELECT 11,uuid,now()+interval '1 hour',NULL FROM video_rooms WHERE id=11;
INSERT INTO events(id,lynk_room_id,start_date,status) SELECT 12,uuid,NULL,'cancelled' FROM video_rooms WHERE id=12;
DO $$ BEGIN
 IF public.expire_event_lynk_room(11) THEN RAISE EXCEPTION 'Nullable legacy status was treated as cancelled'; END IF;
 IF NOT public.expire_event_lynk_room(12) THEN RAISE EXCEPTION 'Cancelled malformed schedule was not cleaned'; END IF;
END $$;
INSERT INTO video_rooms(id,is_public,created_by,room_kind) VALUES
 (13,true,'fixture-host','lynk'),(14,false,'other-host','lynk'),(15,false,'fixture-host','call');
DO $$ DECLARE room_id integer; BEGIN
 FOREACH room_id IN ARRAY ARRAY[13,14,15] LOOP
  BEGIN
   INSERT INTO events(id,lynk_room_id,start_date) SELECT room_id,uuid,now() FROM video_rooms WHERE id=room_id;
   RAISE EXCEPTION 'Public, other-host or call room attachment accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
END $$;
-- New-link validation is authoritative; unchanged linked-event edits survive.
UPDATE events SET host_id=host_id WHERE id=2;
INSERT INTO video_rooms(id,ends_at) VALUES(7,now()+interval '5 minutes'),(8,now()-interval '1 minute');
INSERT INTO events(id,lynk_room_id,start_date) SELECT 7,uuid,now()+interval '1 day' FROM video_rooms WHERE id=7;
DO $$ BEGIN
 BEGIN
  INSERT INTO events(id,lynk_room_id,start_date) SELECT 8,uuid,now() FROM video_rooms WHERE id=8;
  RAISE EXCEPTION 'Expired new link was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO events(id,lynk_room_id,start_date) SELECT 9,uuid,now() FROM video_rooms WHERE id=7;
  RAISE EXCEPTION 'Duplicate room link was accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO events(id,lynk_room_id,start_date) SELECT 10,uuid,now() FROM video_rooms WHERE id=2;
  RAISE EXCEPTION 'Ended new link was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
`;
if (process.argv.includes('--sql')) process.stdout.write(sql);
else if (process.argv.includes('--pglite')) {
  const { PGlite } = require('@electric-sql/pglite');
  (async () => { const db = new PGlite(); try { await db.exec(sql); console.log('event Lynk scheduled-expiry SQL: all assertions pass'); } finally { await db.close(); } })().catch(error => { console.error(error.message); process.exitCode = 1; });
} else { console.error('Use --sql or --pglite (isolated fixture only).'); process.exitCode = 2; }
