const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261024164346_member_map_explicit_consent.sql'),'utf8');
async function dbRun(fn) {
 const db=new PGlite();
 try {
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/member-map/schema.sql'),'utf8'));
  // Execute the real existing legacy entitlement definition, not a permissive stub.
  await db.exec("ALTER TABLE public.users ADD COLUMN created_at timestamptz DEFAULT now()");
  const legacy=fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261011203000_legacy_adult_access.sql'),'utf8');
  await db.exec(legacy.slice(0,legacy.indexOf('CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult'))+'COMMIT;');
  await db.exec(migration);
  await db.exec(fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261029041500_member_map_legacy_approval.sql'),'utf8'));
  await fn(db);
 } finally {await db.close();}
}
async function call(db,expression,args=[]) {return (await db.query('SELECT '+expression+' AS value',args)).rows[0].value;}
async function enable(db,user) {return call(db,"member_map_update_settings($1,0,true,true,'events-map-v1')",[user]);}
async function publish(db,user,lat=40.71281,lng=-74.00602,revision=1) {
 return call(db,'member_map_publish($1,$2,$3,$4,now())',[user,revision,lat,lng]);
}
test('off by default, explicit independent consent, revision conflicts and atomic revoke',()=>dbRun(async db=>{
 assert.deepEqual(await call(db,"member_map_get_settings('viewer')"),{locationEnabled:false,eventsMapEnabled:false,revision:0,shareUntil:null});
 await assert.rejects(()=>call(db,"member_map_update_settings('viewer',0,true,true,NULL)"),/consent/);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
 const s=await enable(db,'viewer');assert.equal(s.revision,1);assert.equal(s.eventsMapEnabled,true);
 await publish(db,'viewer');
 await assert.rejects(()=>call(db,"member_map_update_settings('viewer',0,true,false,NULL)"),/changed/);
 const revoked=await call(db,"member_map_revoke('viewer')");assert.equal(revoked.eventsMapEnabled,false);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
 assert.equal((await db.query("SELECT count(*)::int n FROM member_map_presence")).rows[0].n,0);
 assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members,[]);
}));
test('coarse cells, observation freshness, finite coordinates and max retention',()=>dbRun(async db=>{
 await enable(db,'viewer');await publish(db,'viewer');
 const p=(await db.query("SELECT * FROM member_map_presence")).rows[0];
 assert.equal(p.latitude,40.71);assert.notEqual(p.longitude,-74.00602);
 assert.ok(Date.parse(p.expires_at)-Date.parse(p.observed_at)<=900000);
 await assert.rejects(()=>call(db,"member_map_publish('viewer',1,40,-74,now()-interval '2 minutes')"),/Fresh valid/);
 await assert.rejects(()=>call(db,"member_map_publish('viewer',1,40,-74,now()+interval '1 minute')"),/Fresh valid/);
 for(const [lat,lng] of [[null,0],[86,0],[0,181],['NaN',0],['Infinity',0]])
  await assert.rejects(()=>call(db,"member_map_publish('viewer',1,$1,$2,now())",[lat,lng]),/Fresh valid/);
}));
test('nearby excludes blocked both ways, private, minors, denied, expired and far profiles',()=>dbRun(async db=>{
 for(const u of ['viewer','near','far','private','blocked','minor','expired','denied']) {await enable(db,u);await publish(db,u,u==='far'?1:40.71281);}
 await db.exec("UPDATE users SET is_private=true WHERE auth_id='private'; UPDATE identity_verifications SET date_of_birth=CURRENT_DATE-interval '17 years' WHERE user_id='minor'; UPDATE verified_admission_policy SET denylist=ARRAY['denied']; UPDATE member_map_presence SET expires_at=now()-interval '1 second' WHERE user_id='expired'; INSERT INTO blocks SELECT b.id,v.id FROM users b,users v WHERE b.auth_id='blocked' AND v.auth_id='viewer';");
 const result=await call(db,"member_map_nearby('viewer')");
 assert.deepEqual(result.members.map(m=>m.username),['near']);
 assert.ok(result.center);assert.ok(result.members[0].expiresAt);
 assert.deepEqual(Object.keys(result.members[0]).sort(),['id','username','displayName','avatarUrl','latitude','longitude','expiresAt'].sort());
 await db.exec("DELETE FROM blocks; INSERT INTO blocks SELECT v.id,b.id FROM users b,users v WHERE b.auth_id='blocked' AND v.auth_id='viewer';");
 assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members.map(m=>m.username),['near']);
 await db.exec("UPDATE member_map_settings SET share_until=now()-interval '1 second' WHERE user_id='viewer'");
 assert.deepEqual(await call(db,"member_map_nearby('viewer')"),{members:[],center:null,expiresAt:null});
}));
test('overall off deletes legacy presence and trigger refuses late old-client upsert',()=>dbRun(async db=>{
 await enable(db,'viewer');await publish(db,'viewer');
 await db.exec("INSERT INTO member_proximity_presence VALUES('viewer',40,-74)");
 await call(db,"member_map_update_settings('viewer',1,false,false,NULL)");
 assert.equal((await db.query("SELECT count(*)::int n FROM member_proximity_presence")).rows[0].n,0);
 await assert.rejects(()=>db.exec("INSERT INTO member_proximity_presence VALUES('viewer',40,-74)"),/disabled/);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
}));
test('anon and authenticated cannot read/write points or invoke spoofable service RPCs',()=>dbRun(async db=>{
 await enable(db,'viewer');await publish(db,'viewer');
 for(const role of ['anon','authenticated']) {
  await db.exec('SET ROLE '+role);
  for(const sql of ["SELECT * FROM member_map_presence","SELECT * FROM member_map_settings","SELECT member_map_nearby('viewer')","SELECT member_map_revoke('viewer')","INSERT INTO member_map_settings(user_id) VALUES('near')"])
   await assert.rejects(()=>db.exec(sql),/permission denied/);
  await db.exec('RESET ROLE');
 }
 await db.exec('SET ROLE service_role');
 assert.equal((await call(db,"member_map_get_settings('viewer')")).eventsMapEnabled,true);
 assert.ok((await call(db,"member_map_nearby('viewer')")).center);
}));
test('app bans, auth bans and moderation restrictions hide targets and refuse viewer access',()=>dbRun(async db=>{
 await enable(db,'viewer');await enable(db,'near');await publish(db,'viewer');await publish(db,'near');
 assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,1);
 for(const restriction of [
  "UPDATE users SET banned_at=now() WHERE auth_id='near'",
  "UPDATE \"user\" SET banned=true WHERE id='near'",
  "INSERT INTO payload.members VALUES((SELECT id::text FROM users WHERE auth_id='near'),'shadow_banned')"
 ]) {
  await db.exec(restriction);
  assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,0);
  await db.exec("UPDATE users SET banned_at=NULL; UPDATE \"user\" SET banned=false; DELETE FROM payload.members;");
 }
 await db.exec("UPDATE \"user\" SET banned=true WHERE id='viewer'");
 assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members,[]);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
 assert.equal((await call(db,"member_map_revoke('viewer')")).eventsMapEnabled,false);
}));
test('emergency overall revoke is unconditional, invalidates revisions and removes legacy points',()=>dbRun(async db=>{
 await enable(db,'viewer');await publish(db,'viewer');
 await db.exec("INSERT INTO member_proximity_presence VALUES('viewer',40,-74)");
 const result=await call(db,"member_map_revoke('viewer',true)");
 assert.equal(result.locationEnabled,false);assert.equal(result.eventsMapEnabled,false);assert.equal(result.revision,2);
 assert.equal((await db.query("SELECT count(*)::int n FROM member_proximity_presence")).rows[0].n,0);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
 assert.equal((await call(db,"member_map_revoke('viewer',true)")).locationEnabled,false);
}));
test('actual Settings private flag closes discovery even with legacy users.is_private=false',()=>dbRun(async db=>{
 await enable(db,'viewer');await enable(db,'near');await publish(db,'viewer');await publish(db,'near');
 await db.exec(`INSERT INTO user_settings VALUES('near','{"privacy":{"privateAccount":true}}');`);
 assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,0);
 await db.exec(`UPDATE user_settings SET settings='{"privacy":{"privateAccount":false}}';`);
 assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,1);
 await db.exec(`UPDATE user_settings SET settings='{"privacy":{"privateAccount":"invalid"}}';`);
 assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,0);
 await db.exec(`INSERT INTO user_settings VALUES('viewer','{"privacy":{"privateAccount":true}}');`);
 assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members,[]);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
}));
test('moderation boolean is service-only without exposing the private payload schema',()=>dbRun(async db=>{
 const payloadOid=(await db.query("SELECT 'payload.members'::regclass::oid AS oid")).rows[0].oid;
 const nearId=(await db.query("SELECT id FROM public.users WHERE auth_id='near'")).rows[0].id;
 const viewerId=(await db.query("SELECT id FROM public.users WHERE auth_id='viewer'")).rows[0].id;
 const def=(await db.query("SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.member_map_moderation_clear(integer)'::regprocedure")).rows[0];
 assert.equal(def.prosecdef,true);assert.deepEqual(def.proconfig,['search_path=pg_catalog, pg_temp']);
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc JOIN pg_namespace ns ON ns.oid=pronamespace WHERE ns.nspname='public' AND proname LIKE 'member_map_%' AND prosecdef AND proname<>'member_map_moderation_clear'")).rows[0].n,0);
 await db.exec('SET ROLE service_role');
 assert.equal(await call(db,"has_schema_privilege(current_user,'payload','USAGE')"),false);
 assert.equal(await call(db,"has_table_privilege(current_user,$1::oid,'SELECT')",[payloadOid]),false);
 await assert.rejects(()=>db.exec('SELECT * FROM payload.members'),/permission denied/);
 assert.equal(await call(db,'member_map_moderation_clear(NULL)'),false);
 assert.equal(await call(db,'member_map_moderation_clear(-1)'),false);
 assert.equal(await call(db,'member_map_moderation_clear($1)',[nearId]),true);
 await enable(db,'viewer');await enable(db,'near');await publish(db,'viewer');await publish(db,'near');
 assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,1);
 await db.exec('RESET ROLE');
 for(const status of ['banned','suspended','shadow_banned']) {
  await db.query('INSERT INTO payload.members VALUES($1,$2)',[String(nearId),status]);
  await db.exec('SET ROLE service_role');
  assert.equal(await call(db,'member_map_moderation_clear($1)',[nearId]),false);
  assert.equal(await call(db,'member_map_moderation_clear($1)',[viewerId]),true);
  assert.equal((await call(db,"member_map_nearby('viewer')")).members.length,0);
  await assert.rejects(()=>publish(db,'near'),/off or expired/);
  await db.exec('RESET ROLE; DELETE FROM payload.members');
  await db.query('INSERT INTO payload.members VALUES($1,$2)',[String(viewerId),status]);
  await db.exec('SET ROLE service_role');
  assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members,[]);
  await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
  await db.exec('RESET ROLE; DELETE FROM payload.members');
 }
 for(const role of ['anon','authenticated']) {
  await db.exec('SET ROLE '+role);
  await assert.rejects(()=>call(db,'member_map_moderation_clear($1)',[nearId]),/permission denied/);
  await assert.rejects(()=>db.exec('SELECT * FROM payload.members'),/permission denied/);
  await db.exec('RESET ROLE');
 }
}));

test('approved legacy adults can opt in without invented ID evidence; approval alone never shares',()=>dbRun(async db=>{
 await db.exec("DELETE FROM identity_verifications WHERE user_id IN ('viewer','near'); INSERT INTO legacy_adult_access(auth_id,profile_id,basis,approved_by,note) SELECT auth_id,id,'pre_july_membership','fixture','Synthetic approved cohort' FROM users WHERE auth_id IN ('viewer','near');");
 await db.exec('SET ROLE service_role');
 assert.equal(await call(db,"member_map_eligible('viewer')"),true);
 assert.equal((await call(db,"member_map_get_settings('viewer')")).eventsMapEnabled,false);
 await assert.rejects(()=>publish(db,'viewer'),/off or expired/);
 await assert.rejects(()=>call(db,"member_map_update_settings('viewer',0,true,true,NULL)"),/consent/);
 await enable(db,'viewer');await enable(db,'near');await publish(db,'viewer');await publish(db,'near');
 assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members.map(x=>x.username),['near']);
 assert.equal(await call(db,"exists(select 1 from identity_verifications where user_id='viewer')"),false);
 await db.exec('RESET ROLE');
 for(const change of [
  "UPDATE legacy_adult_access SET revoked_at=now() WHERE auth_id='near'",
  "UPDATE legacy_adult_access SET profile_id=(SELECT id FROM users WHERE auth_id='far') WHERE auth_id='near'",
  "UPDATE users SET is_private=true WHERE auth_id='near'",
  "UPDATE users SET banned_at=now() WHERE auth_id='near'",
  `UPDATE "user" SET banned=true WHERE id='near'`,
  "INSERT INTO user_settings VALUES('near','{\"privacy\":{\"privateAccount\":true}}')",
  "INSERT INTO payload.members SELECT id::text,'suspended' FROM users WHERE auth_id='near'",
  "UPDATE verified_admission_policy SET denylist=ARRAY['near']",
  "INSERT INTO identity_verifications VALUES('near','passed',CURRENT_DATE-interval '17 years',NULL)",
  "INSERT INTO identity_verifications VALUES('near','failed',NULL,NULL)",
  "INSERT INTO identity_verifications VALUES('near','review',NULL,'duplicate_identity')"
 ]) {
  await db.exec('BEGIN;'+change);
  await db.exec('SET LOCAL ROLE service_role');
  assert.equal(await call(db,"member_map_eligible('near')"),false,change);
  assert.deepEqual((await call(db,"member_map_nearby('viewer')")).members,[],change);
  await assert.rejects(()=>publish(db,'near'),/off or expired/);
  await db.exec('ROLLBACK');
 }
 await call(db,"member_map_revoke('viewer',true)");
 assert.equal((await call(db,"member_map_get_settings('viewer')")).eventsMapEnabled,false);
}));
test('ordinary unapproved members cannot use legacy fallback',()=>dbRun(async db=>{
 await db.exec("DELETE FROM identity_verifications WHERE user_id='viewer'");
 assert.equal(await call(db,"member_map_eligible('viewer')"),false);
 await assert.rejects(()=>enable(db,'viewer'),/consent/);
}));
