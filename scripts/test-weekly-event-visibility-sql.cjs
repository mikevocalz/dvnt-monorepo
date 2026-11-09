const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname,'../apps/mobile/supabase/migrations/20261109120000_weekly_event_visibility.sql'),'utf8');
test('adult classification, server discovery filtering and active buyer tiers preserve history', {timeout:120000}, async () => {
 const db = new PGlite();
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE TABLE events(id integer PRIMARY KEY,event_type text,category text,nsfw boolean,is_hidden boolean DEFAULT false);
   CREATE TABLE ticket_types(id integer PRIMARY KEY,event_id integer,is_active boolean,name text,unlock_code text);
   CREATE VIEW ticket_types_public WITH(security_invoker=true) AS SELECT id,event_id,is_active,name FROM ticket_types;
   CREATE TABLE tickets(id integer PRIMARY KEY,ticket_type_id integer REFERENCES ticket_types(id));
   GRANT SELECT ON ticket_types,ticket_types_public TO anon,authenticated;
   INSERT INTO events VALUES (1,'sex_party',null,false,false),(2,'party',null,false,false),(3,'bate_session',null,null,false),(4,'party',null,true,false),(5,null,'Kink / Play Party',false,false);
   INSERT INTO ticket_types VALUES(1,1,true,'Active','secret'),(2,1,false,'Removed','secret'),(3,1,null,'Unknown','secret');
   INSERT INTO tickets VALUES(1,2);`);
  const defs = [
   ['get_events_home','p_limit integer,p_offset integer,p_viewer_id integer,p_city_id integer,p_filter_online boolean,p_filter_tonight boolean,p_filter_weekend boolean,p_search text,p_category text,p_sort text,p_nsfw boolean','AND (p_nsfw IS NULL OR COALESCE(e.nsfw, false) = p_nsfw)'],
   ['get_events_home','p_limit integer,p_offset integer,p_viewer_id integer,p_city_id integer,p_filter_online boolean,p_filter_tonight boolean,p_filter_weekend boolean,p_search text,p_category text,p_sort text',''],
   ['get_events_for_you','p_viewer_id integer,p_limit integer,p_offset integer',''],
   ['get_spotlight_feed','p_city_id bigint',''],
   ['get_promoted_event_ids','p_city_id bigint',''],
  ];
  for (const [name,args,predicate] of defs) await db.exec(`CREATE FUNCTION ${name}(${args}) RETURNS json LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT json_agg(id ORDER BY id) FROM events e WHERE true AND NOT e.is_hidden ${predicate} $$`);
  const q = async (text,args=[]) => (await db.query(text,args)).rows;
  const history = await q('SELECT tickets.*,ticket_types.name FROM tickets JOIN ticket_types ON ticket_type_id=ticket_types.id');
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(await q('SELECT id FROM events WHERE nsfw ORDER BY id'),[{id:1},{id:3},{id:4},{id:5}]);
  await db.exec("UPDATE events SET nsfw=false WHERE id=1; INSERT INTO events(id,event_type,nsfw) VALUES(6,'glory_hole',false),(7,'cruising',false),(8,'cum_dump',false)");
  assert.equal((await q('SELECT nsfw FROM events WHERE id=1'))[0].nsfw,true);
  for (const mode of [false,null,true]) {
   const rows=await q('SELECT get_events_home(20,0,null,null,null,false,false,null,null,null,$1) AS result',[mode]);
   assert.deepEqual(rows[0].result,mode ? [1,3,4,5,6,7,8] : [2]);
  }
  for (const call of ['get_events_home(20,0,null,null,null,false,false,null,null,null)','get_events_for_you(1,20,0)','get_spotlight_feed(null)','get_promoted_event_ids(null)']) assert.deepEqual((await q(`SELECT ${call} AS result`))[0].result,[2]);
  for(const role of ['anon','authenticated']) {
   await db.exec(`SET ROLE ${role}`);
   assert.deepEqual(await q('SELECT * FROM ticket_types_public'),[{id:1,event_id:1,is_active:true,name:'Active'}]);
   await db.exec('RESET ROLE');
  }
  assert.equal((await q('SELECT * FROM ticket_types')).length,3,'organizer records remain intact');
  assert.deepEqual(await q('SELECT tickets.*,ticket_types.name FROM tickets JOIN ticket_types ON ticket_type_id=ticket_types.id'),history);
  await db.exec('UPDATE ticket_types SET is_active=false WHERE id=1');
  assert.deepEqual(await q('SELECT * FROM ticket_types_public'),[]);
 } finally { await db.close(); }
});

test('weekly migration patches actual current checked-in RPC definitions and preserves their metadata', {timeout:120000}, async () => {
 const db = new PGlite();
 const dir = path.join(__dirname,'../apps/mobile/supabase/migrations');
 const read = name => fs.readFileSync(path.join(dir,name),'utf8');
 const targets = new Set(['get_events_home','get_events_for_you','get_spotlight_feed','get_promoted_event_ids']);
 try {
  // Bodies are installed verbatim but not executed in this compatibility test.
  // Missing tables are deliberate: execution behavior is exercised above, and
  // this test checks the real pg_get_functiondef transformations and metadata.
  await db.exec(`SET check_function_bodies=off;
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TYPE public.enum_events_category AS ENUM('music','other');
   CREATE TABLE events(id integer PRIMARY KEY,event_type text,category enum_events_category,nsfw boolean,is_hidden boolean DEFAULT false);
   CREATE TABLE ticket_types(id integer PRIMARY KEY,event_id integer,is_active boolean,name text,unlock_code text);
   ALTER TABLE ticket_types ENABLE ROW LEVEL SECURITY;
   CREATE POLICY fixture_select ON ticket_types FOR SELECT USING(event_id <> 99);
   GRANT SELECT ON ticket_types TO anon,authenticated;
   INSERT INTO ticket_types VALUES(1,1,true,'Active','secret'),(2,1,false,'Removed','secret'),(3,99,true,'RLS hidden','secret');`);
  for (const name of ['20261003110000_event_hide_and_publish_at.sql','20261003120000_discovery_rpcs_return_event_tz.sql']) {
   const definitions = [...read(name).matchAll(/^CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?^\$function\$;/gm)];
   for (const match of definitions) if (targets.has(match[1])) await db.exec(match[0]);
  }
  // Apply the repository's subsequent narrow rewrites for these exact RPCs.
  // Other RPCs are excluded, not reimplemented; every target patch and guard
  // is taken unchanged from the source migration's JSON and DO statement.
  for (const name of ['20261019050000_event_type_taxonomy.sql','20261023231057_sensitive_event_attendee_privacy.sql']) {
   const source = read(name);
   const block = source.match(/DO \$migration\$[\s\S]*?\$migration\$;/)[0];
   const specs = JSON.parse(block.match(/\$patches\$([\s\S]*?)\$patches\$::jsonb/)[1]);
   const selected = specs.filter(s => targets.has(s.signature.match(/public\.(\w+)/)[1]));
   assert.equal(selected.length,3);
   await db.exec(block.replace(/\$patches\$[\s\S]*?\$patches\$::jsonb/,`$patches$${JSON.stringify(selected)}$patches$::jsonb`));
  }
  // Use the real buyer-view migration rather than an invented projection.
  await db.exec(read('20260806200000_ticket_types_public_view.sql'));
  const q = async (text,args=[]) => (await db.query(text,args)).rows;
  const snapshot = () => q(`SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) AS args,
    pg_get_function_arguments(p.oid) AS defaults,
    to_jsonb(p)-ARRAY['prosrc','proargdefaults','prosqlbody'] AS metadata,
    pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1) ORDER BY p.oid`,[[...targets]]);
  const before = await snapshot(); assert.equal(before.length,5);
  const projection = await q("SELECT column_name FROM information_schema.columns WHERE table_name='ticket_types_public' ORDER BY ordinal_position");
  assert.ok(!projection.some(c=>c.column_name==='unlock_code'));
  await db.exec(migration);
  const after = await snapshot();
  for(let i=0;i<before.length;i++) {
   const old=before[i],current=after[i];
   assert.deepEqual({...current,definition:null},{...old,definition:null},`${old.proname} metadata unchanged`);
   const mode = old.args.includes('p_nsfw');
   const original = mode ? '(p_nsfw IS NULL OR COALESCE(e.nsfw, false) = p_nsfw)' : 'AND NOT e.is_hidden';
   const replacement = mode ? '(COALESCE(e.nsfw, false) = COALESCE(p_nsfw, false))' : 'AND NOT COALESCE(e.nsfw, false) AND NOT e.is_hidden';
   assert.equal(old.definition.split(original).length-1,1,`${old.proname} has exactly one known source predicate`);
   assert.equal(current.definition,old.definition.replace(original,replacement));
  }
  assert.deepEqual(await q("SELECT column_name FROM information_schema.columns WHERE table_name='ticket_types_public' ORDER BY ordinal_position"),projection);
  for(const role of ['anon','authenticated']) {
   await db.exec(`SET ROLE ${role}`);
   assert.deepEqual(await q('SELECT * FROM ticket_types_public'),[{id:1,event_id:1,is_active:true,name:'Active'}]);
   await db.exec('RESET ROLE');
  }
  await db.exec(migration); assert.deepEqual(await snapshot(),after,'idempotent on actual definitions');
  const last = after.find(row=>row.proname==='get_promoted_event_ids');
  await db.exec(last.definition.replace('AND NOT COALESCE(e.nsfw, false) AND NOT e.is_hidden','AND e.is_hidden IS FALSE'));
  const drifted = await snapshot();
  await assert.rejects(db.exec(migration),/Unexpected visibility predicate/);
  await db.exec('ROLLBACK');
  assert.deepEqual(await snapshot(),drifted,'unexpected source drift aborts atomically');
 } finally { await db.close(); }
});
