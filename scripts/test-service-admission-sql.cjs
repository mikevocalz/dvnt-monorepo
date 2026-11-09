// Disposable PostgreSQL only. No network database, credentials, live scans or real QR values.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const {Pool}=require('pg');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261031142539_service_admission_read_boundaries.sql'),'utf8');
function serverBin(){for(const dir of [process.env.PG_BIN,process.env.POSTGRES_BIN,'',...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)){if(['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0))return dir;}throw Error('PostgreSQL required; service admission SQL tests DID NOT run');}
const schema=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('fixture.jwt',true),''),'{}')::jsonb$$;
CREATE TABLE events(id integer PRIMARY KEY,title text,status text,host_id text,perk_config jsonb,event_type text,category text,lynk_room_id text,show_attendees boolean);
CREATE TABLE tickets(id text PRIMARY KEY,event_id integer,user_id text,category text,status text,checked_in_at timestamptz);
CREATE TABLE event_rsvps(event_id integer,user_id text,status text);
CREATE TABLE event_co_organizers(event_id integer,user_id text,accepted boolean,role text);
CREATE TABLE users(id integer,auth_id text,username text,avatar_id integer);
CREATE TABLE media(id integer,url text);
CREATE TABLE membership_subscriptions(user_id text,status text,grace_period_ends_at timestamptz,cancel_at_period_end boolean,current_period_end timestamptz,plan_key text);
CREATE TABLE event_presence(event_id integer,ticket_id text,user_id text,state text,expires_at timestamptz);
CREATE FUNCTION can_view_event(integer) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
INSERT INTO events VALUES(7,'Synthetic service event','active','host','{}','sex_party',NULL,NULL,true);
INSERT INTO users VALUES(1,'admission-member','admitted',NULL),(2,'service-member','serviceonly',NULL),(3,'rsvp-member','rsvponly',NULL);
INSERT INTO tickets VALUES('admission-one',7,'admission-member','admission','active',NULL),('service-one',7,'service-member','service','active',NULL),('service-two',7,'service-member','service','scanned',now()),('product-one',7,'service-member','product','active',NULL),('admission-two',7,'guest-fixture','admission','scanned',now());
INSERT INTO event_co_organizers VALUES(7,'staff',true,'scanner');
`;
test(process.env.POSTGRES_SINGLE_USER?'real PostgreSQL single-user service admission assertions (concurrency NOT RUN)':'real SQL keeps service-only ownership separate from admission and attendance',{timeout:60000},async t=>{
 const bin=serverBin(),data=fs.mkdtempSync(path.join(os.tmpdir(),'dvnt-service-read-')),socket=fs.mkdtempSync(path.join(os.tmpdir(),'dvnt-service-read-sock-'));
 const run=(cmd,args)=>execFileSync(path.join(bin,cmd),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try{
  run('initdb',['-D',data,'-U','harness','--auth=trust','--no-sync']);
  if(process.env.POSTGRES_SINGLE_USER){
   const assertions=`
   CREATE FUNCTION fixture_assert(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'ASSERT: %',message;END IF;END;$$;
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"service-member"}',false);
   SELECT fixture_assert(NOT viewer_is_attending(7),'service alone not attending');
   SELECT fixture_assert(NOT event_attendees_visible(7),'service cannot view protected attendees');
   SELECT fixture_assert(get_event_attendee_page(7)::jsonb='[]'::jsonb,'service list empty');
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"admission-member"}',false);
   SELECT fixture_assert(viewer_is_attending(7),'admission attending');
   SELECT fixture_assert(event_attendees_visible(7),'admission may view opted in list');
   SELECT fixture_assert(get_event_attendee_page(7)::text LIKE '%admitted%' AND get_event_attendee_page(7)::text NOT LIKE '%serviceonly%','page includes admission not service buyer');
   SELECT fixture_assert(get_event_attendee_avatars(7)::text LIKE '%admitted%' AND get_event_attendee_avatars(7)::text NOT LIKE '%serviceonly%','avatars include admission not service buyer');
   INSERT INTO event_rsvps VALUES(7,'service-member','going');
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"service-member"}',false);
   SELECT fixture_assert(viewer_is_attending(7) AND event_attendees_visible(7),'explicit RSVP remains sufficient');
   DELETE FROM event_rsvps WHERE user_id='service-member';
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"host"}',false);
   SELECT fixture_assert(viewer_is_attending(7),'host privilege');
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"staff"}',false);
   SELECT fixture_assert(viewer_is_attending(7),'staff privilege');
   SELECT fixture_assert((watch_door_summary(7,'staff')->'summary'->>'expected')::int=2,'door expected admission only');
   SELECT fixture_assert((watch_door_summary(7,'staff')->'summary'->>'arrived')::int=1,'door arrived admission only');
   SELECT fixture_assert((watch_door_summary(7,'staff')->'summary'->>'remaining')::int=1,'door remaining admission only');
   UPDATE events SET show_attendees=false WHERE id=7;
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"admission-member"}',false);
   SELECT fixture_assert(NOT event_attendees_visible(7),'sensitive optout retained');
   SELECT set_config('fixture.jwt','{"role":"authenticated","sub":"stranger"}',false);
   SELECT fixture_assert(NOT viewer_is_attending(7),'stranger excluded');
   SELECT fixture_assert(NOT has_function_privilege('anon','public.watch_door_summary(bigint,text)','EXECUTE'),'anon no door counts');
   SELECT fixture_assert(has_function_privilege('service_role','public.watch_door_summary(bigint,text)','EXECUTE'),'service door counts');
   SELECT fixture_assert(NOT EXISTS((SELECT * FROM tickets EXCEPT ALL SELECT * FROM original_tickets) UNION ALL (SELECT * FROM original_tickets EXCEPT ALL SELECT * FROM tickets)),'original ticket rows unchanged');
   SELECT 'PASS: service admission single-user PostgreSQL assertions';
   `;
   const sql=schema+'CREATE TEMP TABLE original_tickets AS SELECT * FROM tickets;'+migration+migration+assertions;
   const r=spawnSync(path.join(bin,'postgres'),['--single','-j','-D',data,'postgres'],{encoding:'utf8',input:sql.replace(/\n\s*\n/g,'\n')+'\n\n',maxBuffer:8*1024*1024});
   assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stdout+r.stderr,/ERROR:|FATAL:/);assert.match(r.stdout+r.stderr,/PASS: service admission single-user PostgreSQL assertions/);return;
  }
  try{run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,'-w','-l',path.join(data,'server.log'),'start']);}catch(e){throw Error(e.message+'\n'+fs.readFileSync(path.join(data,'server.log'),'utf8'));}
  pool=new Pool({host:socket,user:'harness',database:'postgres'});
  await pool.query(schema);const original=(await pool.query('SELECT * FROM tickets ORDER BY id')).rows;
  await pool.query(migration);await pool.query(migration);
  assert.deepEqual((await pool.query('SELECT * FROM tickets ORDER BY id')).rows,original,'migration cannot rewrite historic tickets');
  const viewer=async id=>pool.query("SELECT set_config('fixture.jwt',$1,false)",[JSON.stringify({role:'authenticated',sub:id})]);
  await t.test('service-only member cannot view protected attendee list or become attendee',async()=>{
   await viewer('service-member');assert.equal((await pool.query('SELECT viewer_is_attending(7) AS yes')).rows[0].yes,false);
   assert.equal((await pool.query('SELECT event_attendees_visible(7) AS yes')).rows[0].yes,false);
   assert.deepEqual((await pool.query('SELECT get_event_attendee_page(7) AS people')).rows[0].people,[]);
  });
  await t.test('admission holder sees admission attendees, not service-only buyers',async()=>{
   await viewer('admission-member');assert.equal((await pool.query('SELECT viewer_is_attending(7) AS yes')).rows[0].yes,true);
   const people=(await pool.query('SELECT get_event_attendee_page(7) AS people,get_event_attendee_avatars(7) AS avatars')).rows[0];
   for(const rows of [people.people,people.avatars]){assert.ok(rows.some(x=>x.username==='admitted'));assert.ok(!rows.some(x=>x.username==='serviceonly'));}
  });
  await t.test('explicit RSVP remains independently sufficient; host/staff behavior unchanged',async()=>{
   await pool.query("INSERT INTO event_rsvps VALUES(7,'service-member','going')");
   await viewer('service-member');assert.equal((await pool.query('SELECT viewer_is_attending(7) AS yes,event_attendees_visible(7) AS visible')).rows[0].visible,true);
   for(const id of ['host','staff']){await viewer(id);assert.equal((await pool.query('SELECT viewer_is_attending(7) AS yes')).rows[0].yes,true);}
   await pool.query("DELETE FROM event_rsvps WHERE user_id='service-member'");
  });
  await t.test('service redemption does not inflate expected or admitted door summary',async()=>{
   const r=(await pool.query("SELECT watch_door_summary(7,'staff') AS r")).rows[0].r;
   assert.equal(r.ok,true);assert.equal(r.summary.expected,2);assert.equal(r.summary.arrived,1);assert.equal(r.summary.remaining,1);
  });
  await t.test('sensitive opt-out and stranger exclusion still apply',async()=>{
   await viewer('admission-member');await pool.query('UPDATE events SET show_attendees=false WHERE id=7');assert.equal((await pool.query('SELECT event_attendees_visible(7) AS yes')).rows[0].yes,false);
   await viewer('stranger');assert.equal((await pool.query('SELECT viewer_is_attending(7) AS yes')).rows[0].yes,false);
  });
  await t.test('door aggregate remains service-role-only and no credential rows changed',async()=>{
   assert.equal((await pool.query("SELECT has_function_privilege('anon','public.watch_door_summary(bigint,text)','EXECUTE') AS yes")).rows[0].yes,false);
   assert.equal((await pool.query("SELECT has_function_privilege('service_role','public.watch_door_summary(bigint,text)','EXECUTE') AS yes")).rows[0].yes,true);
   assert.deepEqual((await pool.query('SELECT * FROM tickets ORDER BY id')).rows,original);
  });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}fs.rmSync(data,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true});}
});
