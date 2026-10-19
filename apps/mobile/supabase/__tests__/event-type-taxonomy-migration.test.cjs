const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// CI reads only definitions that were already published in repository migrations.
// Exact deployed definitions may be tested locally via an OUTSIDE-checkout file;
// they must never be committed, emitted to CI logs, or uploaded as artifacts.
function repositoryDefinitions() {
  const sources = [
    ['get_event_detail(integer,integer)', '20261013220000_event_comments_member_boundary.sql'],
    ['get_events_for_you(integer,integer,integer)', '20261003120000_discovery_rpcs_return_event_tz.sql'],
    ['get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)', '20261003110000_event_hide_and_publish_at.sql'],
    ['get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text,boolean)', '20261003120000_discovery_rpcs_return_event_tz.sql'],
  ];
  return {functions: sources.map(([signature, file]) => {
    const source = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
    const name = signature.slice(0, signature.indexOf('('));
    const start = new RegExp('^CREATE OR REPLACE FUNCTION public\\.' + name + '\\(', 'm').exec(source)?.index;
    assert.notEqual(start, undefined, `${file}: missing published ${name}`);
    const end = source.indexOf('\n$function$;', start);
    assert.ok(end > start, `${file}: missing published function terminator`);
    return {signature, definition: source.slice(start, end + '\n$function$;'.length)};
  })};
}
if (process.env.CI && process.env.EVENT_RPC_PRIVATE_FIXTURE) {
  throw new Error('Private RPC fixtures are local-only and must not be loaded in CI');
}
const snapshot = process.env.EVENT_RPC_PRIVATE_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.EVENT_RPC_PRIVATE_FIXTURE, 'utf8'))
  : repositoryDefinitions();
const fixtureOrigin = process.env.EVENT_RPC_PRIVATE_FIXTURE ? 'local private snapshot' : 'published repository RPCs';
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261019050000_event_type_taxonomy.sql'), 'utf8');
const patches = JSON.parse(migration.match(/\$patches\$\s*([\s\S]*?)\s*\$patches\$::jsonb/)[1]);
const home10 = 'public.get_events_home(20::integer,0::integer,1::integer,NULL::integer,NULL::boolean,false::boolean,false::boolean,NULL::text,$1::text,\'soonest\'::text)';
const home11 = 'public.get_events_home(20,0,1,NULL,NULL,false,false,NULL,$1,\'soonest\',NULL)';
const metadataSql = `SELECT p.oid::regprocedure::text AS signature,
  to_jsonb(p) - ARRAY['prosrc','proargdefaults','prosqlbody'] AS metadata,
  pg_get_function_arguments(p.oid) AS arguments,
  pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN ('get_events_home','get_events_for_you','get_event_detail')
  ORDER BY p.proname,p.pronargs`;

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    CREATE TYPE enum_events_category AS ENUM ('music','sports','art','food','tech','business','health','other');
    CREATE TABLE events (
      id integer PRIMARY KEY, title text, description text, start_date timestamptz, end_date timestamptz,
      location text, cover_image_url text, image text, images jsonb, flyer_image_url text,
      video_flyer_url text, video_poster_url text, youtube_video_url text, price numeric,
      total_attendees integer DEFAULT 0, max_attendees integer, host_id text, location_lat numeric,
      location_lng numeric, location_name text, location_type text, visibility text DEFAULT 'public',
      ticketing_enabled boolean DEFAULT true, category enum_events_category,
      event_type text CHECK (event_type IS NULL OR event_type IN ('virtual_session','party','picnic','game_night','panel','happy_hour','wine_down','kickback','ball','kiki','pool_party','spoken_word','open_mic','karaoke','bike_ride','walk_run','fitness_training','yoga','meditation','bate_session','sex_party','kink_fetish_party','training','cooking_class','mixology','dance_class','other')),
      age_restriction text, nsfw boolean DEFAULT false, share_slug text, dress_code text,
      door_policy text, entry_window text, lineup text, perks text, status text DEFAULT 'active',
      cancelled_at timestamptz, is_online boolean DEFAULT false, event_tz text, lynk_room_id uuid,
      is_hidden boolean DEFAULT false, publish_at timestamptz, created_at timestamptz
    );
    ALTER TABLE events ENABLE ROW LEVEL SECURITY;
    CREATE TABLE media (id integer PRIMARY KEY,url text);
    CREATE TABLE users (id integer PRIMARY KEY,auth_id text,username text,first_name text,avatar_id integer,verified boolean,followers_count integer);
    CREATE TABLE "user" (id text PRIMARY KEY,name text);
    CREATE TABLE event_likes (id integer PRIMARY KEY,event_id integer,user_id integer);
    CREATE TABLE event_rsvps (event_id integer,user_id text,status text,created_at timestamptz);
    CREATE TABLE follows (follower_id integer,following_id integer);
    CREATE TABLE ticket_types (id integer,event_id integer,name text,description text,price_cents integer,
      quantity_total integer,quantity_sold integer,max_per_user integer,sale_start timestamptz,sale_end timestamptz,
      perks jsonb,original_price_cents integer,tier text,glow_color text,is_active boolean);
    CREATE TABLE event_reviews (id integer,event_id integer,user_id integer,rating integer,comment text,created_at timestamptz);
    CREATE TABLE event_comments (id integer,event_id integer,author_id integer,content text,created_at timestamptz);
    CREATE FUNCTION public.can_view_event(integer) RETURNS boolean LANGUAGE sql STABLE AS
      $$SELECT EXISTS(SELECT 1 FROM events WHERE id=$1 AND (visibility='public' OR auth.jwt()->>'role'='service_role'))$$;
    CREATE FUNCTION public.get_event_attendee_avatars(integer) RETURNS json LANGUAGE sql STABLE AS $$SELECT '[]'::json$$;
    CREATE FUNCTION public.can_read_event_comments(integer) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
    INSERT INTO users(id,auth_id,username,first_name,verified,followers_count) VALUES(1,'viewer','Viewer','Viewer',true,4);
    INSERT INTO "user" VALUES('viewer','Viewer');
    INSERT INTO events(id,title,category,event_type,start_date,end_date,host_id,price,created_at) VALUES
      (1,'Party A','other','party',now()+interval '3 days',now()+interval '3 days 6 hours','viewer',25,now()-interval '10 days'),
      (2,'Party B','music','party',now()+interval '4 days',now()+interval '4 days 6 hours','viewer',35,now()-interval '10 days'),
      (3,'Game','other','game_night',now()+interval '5 days',now()+interval '5 days 6 hours','viewer',0,now()-interval '10 days'),
      (4,'Legacy Music','music',NULL,now()+interval '6 days',now()+interval '6 days 6 hours','viewer',0,now()-interval '10 days'),
      (5,'Legacy Other','other',NULL,now()+interval '7 days',now()+interval '7 days 6 hours','viewer',0,now()-interval '10 days'),
      (6,'Hidden Party','other','party',now()+interval '3 days',now()+interval '3 days 6 hours','viewer',25,now()-interval '10 days'),
      (7,'Scheduled Party','other','party',now()+interval '3 days',now()+interval '3 days 6 hours','viewer',25,now()-interval '10 days'),
      (8,'Private Party','other','party',now()+interval '3 days',now()+interval '3 days 6 hours','viewer',25,now()-interval '10 days'),
      (9,'Cancelled Party','other','party',now()+interval '3 days',now()+interval '3 days 6 hours','viewer',25,now()-interval '10 days');
    UPDATE events SET is_hidden=true WHERE id=6;
    UPDATE events SET publish_at=now()+interval '1 day' WHERE id=7;
    UPDATE events SET visibility='private' WHERE id=8;
    UPDATE events SET status='cancelled' WHERE id=9;
    INSERT INTO event_likes VALUES(1,1,1),(2,4,1);
    INSERT INTO ticket_types(id,event_id,name,price_cents,quantity_total,quantity_sold,is_active) VALUES
      (1,1,'Paid admission',2500,10,4,true),(2,1,'Hidden tier',9999,5,0,false);
  `);
  for (const item of snapshot.functions) {
    await db.exec(item.definition);
    await db.exec(`REVOKE ALL ON FUNCTION public.${item.signature} FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.${item.signature} TO authenticated,service_role;`);
  }
  return db;
}
async function call(db, expression, args=[]) {
  return (await db.query(`SELECT ${expression} AS result`, args)).rows[0].result;
}
function withoutType(value) {
  if (Array.isArray(value)) return value.map(withoutType);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='event_type').map(([key,v])=>[key,withoutType(v)]));
  return value;
}

// Real PostgreSQL executes published repository definitions by default. Optional
// local private snapshots are separate. Auth helpers/data are synthetic fixtures.
test(`upgrade ${fixtureOrigin} atomically and idempotently without changing rows, enums, ACLs or metadata`, async()=>{
  const db=await database();
  try {
    const before=(await db.query(metadataSql)).rows;
    const rows=(await db.query('SELECT to_jsonb(e) AS row FROM events e ORDER BY id')).rows;
    const enums=(await db.query("SELECT enumlabel FROM pg_enum WHERE enumtypid='enum_events_category'::regtype ORDER BY enumsortorder")).rows;
    const detail=await call(db,'get_event_detail(1,1)');
    const publicHome=await call(db,home11,[null]);
    await db.exec(migration);
    const after=(await db.query(metadataSql)).rows;
    assert.equal(after.length,4);
    for(let i=0;i<before.length;i++) {
      assert.equal(after[i].signature,before[i].signature);
      assert.equal(after[i].arguments,before[i].arguments);
      assert.deepEqual(after[i].metadata,before[i].metadata);
      const spec=patches.find(p=>p.signature==='public.'+before[i].signature);
      let expected=before[i].definition;
      for(const patch of spec.replacements) {
        assert.equal(expected.split(patch.before).length-1,patch.expected);
        expected=expected.split(patch.before).join(patch.after);
      }
      assert.equal(after[i].definition,expected); // nothing else in any input body changed
    }
    assert.deepEqual((await db.query('SELECT to_jsonb(e) AS row FROM events e ORDER BY id')).rows,rows);
    assert.deepEqual((await db.query("SELECT enumlabel FROM pg_enum WHERE enumtypid='enum_events_category'::regtype ORDER BY enumsortorder")).rows,enums);
    assert.deepEqual(withoutType(await call(db,'get_event_detail(1,1)')),detail);
    assert.deepEqual(withoutType(await call(db,home11,[null])),publicHome);
    await db.exec(migration);
    assert.deepEqual((await db.query(metadataSql)).rows,after);
    // Restoring the input definitions proves the isolated upgrade is reversible.
    for(const f of snapshot.functions) await db.exec(f.definition);
    assert.deepEqual((await db.query(metadataSql)).rows,before);
  } finally {await db.close();}
});

test('both home overloads filter authoritative types with legacy fallback; visibility and pagination remain intact',async()=>{
  const db=await database();
  try {
    await db.exec(migration);
    // Both published overloads have defaults, so a 10-argument SQL call is already
    // ambiguous. Keep production signatures untouched; execute that exact upgraded
    // body under a test-only alias, while the 11-arg overload uses real dispatch.
    const legacy=(await db.query("SELECT pg_get_functiondef('public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)'::regprocedure) AS definition")).rows[0].definition;
    await db.exec(legacy.replace('FUNCTION public.get_events_home(', 'FUNCTION public.fixture_home10('));
    for(const expression of [home10.replace('get_events_home(', 'fixture_home10('),home11]) {
      const party=await call(db,expression,['party']);
      assert.ok(party.some(e=>e.id===1));assert.ok(party.some(e=>e.id===2));
      assert.ok(party.every(e=>e.event_type==='party'));
      assert.ok(!party.some(e=>[6,7,8].includes(e.id)));
      assert.deepEqual((await call(db,expression,['music'])).map(e=>e.id),[4]);
      assert.deepEqual((await call(db,expression,['other'])).map(e=>e.id),[5]);
      assert.deepEqual((await call(db,expression,['game_night'])).map(e=>e.id),[3]);
    }
    assert.deepEqual((await call(db,home11,['party'])).map(e=>e.id),[1,2]);
    assert.deepEqual((await call(db,"get_events_home(1,1,1,NULL,NULL,false,false,NULL,'party','soonest',NULL)")).map(e=>e.id),[2]);
    assert.equal((await call(db,'get_event_detail(1,1)')).event.event_type,'party');
    assert.equal(await call(db,'get_event_detail(8,1)'),null);
    const tiers=(await call(db,'get_event_detail(1,1)')).ticket_tiers;
    assert.equal(tiers.length,1);assert.equal(tiers[0].price_cents,2500);assert.equal(tiers[0].remaining,6);
    assert.deepEqual((await db.query('SELECT id,event_type,category::text FROM events WHERE id=5')).rows,[{id:5,event_type:null,category:'other'}]);
  } finally {await db.close();}
});

test('for-you affinity uses authoritative type rather than grouping every legacy Other event together',async()=>{
  const db=await database();
  try {
    await db.exec(migration);
    const list=await call(db,'get_events_for_you(1,20,0)');
    const byId=new Map(list.map(e=>[e.id,e]));
    assert.equal(byId.get(2).event_type,'party');
    assert.equal(byId.get(2).score-byId.get(3).score,15);
    assert.equal(byId.get(4).score-byId.get(3).score,15);
    assert.ok(!list.some(e=>[6,7,8,9].includes(e.id)));
    assert.equal((await call(db,'get_events_for_you(1,1,1)')).length,1);
  } finally {await db.close();}
});

test('unexpected function drift fails before any target changes; partially upgraded targets are supported',async()=>{
  const db=await database();
  try {
    const target=snapshot.functions.find(f=>f.signature.startsWith('get_events_for_you('));
    await db.exec(target.definition.replace('e2.category = e.category','e2.category::text = e.category::text'));
    const before=(await db.query(metadataSql)).rows;
    await assert.rejects(db.exec(migration),/definition drift/);
    assert.deepEqual((await db.query(metadataSql)).rows,before);
    await db.exec(target.definition);
    const detail=snapshot.functions.find(f=>f.signature.startsWith('get_event_detail('));
    const patch=patches.find(p=>p.signature.startsWith('public.get_event_detail(')).replacements[0];
    await db.exec(detail.definition.replace(patch.before,patch.after));
    await db.exec(migration);
    assert.equal((await call(db,'get_event_detail(1,1)')).event.event_type,'party');
  } finally {await db.close();}
});

test('a missing event_type column or RPC signature fails rather than installing guessed schema',async()=>{
  const db=await database();
  try {
    await db.exec('ALTER TABLE events DROP COLUMN event_type');
    await assert.rejects(db.exec(migration),/Expected existing events.event_type/);
    await db.exec('ALTER TABLE events ADD COLUMN event_type text');
    await db.exec('DROP FUNCTION get_events_for_you(integer,integer,integer)');
    await assert.rejects(db.exec(migration),/Missing verified event RPC/);
    assert.doesNotMatch(migration,/ALTER\s+TYPE|UPDATE\s+public\.events|UPDATE\s+events|DROP\s+(?:TYPE|COLUMN|FUNCTION)|GRANT\s+|REVOKE\s+/i);
  } finally {await db.close();}
});
