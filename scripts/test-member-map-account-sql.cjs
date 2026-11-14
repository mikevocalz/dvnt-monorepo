const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
async function fixture(fn, beforeMigration) {
 const db=new PGlite();
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/member-map/schema.sql'),'utf8'));
  await db.exec('CREATE TABLE public.session(id text PRIMARY KEY,"userId" text REFERENCES public."user"(id),"expiresAt" timestamptz); GRANT SELECT ON public.session TO service_role;');
  await db.exec("ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now()");
  const legacy=fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261011203000_legacy_adult_access.sql'),'utf8');
  await db.exec(legacy.slice(0,legacy.indexOf('CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult'))+'COMMIT;');
  for(const file of ['20261024164346_member_map_explicit_consent.sql','20261029041500_member_map_legacy_approval.sql','20261029051500_member_map_self_avatar.sql','20261029205205_member_map_four_hour_sharing.sql','20261109050000_member_map_session_consent.sql']) await db.exec(fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations',file),'utf8'));
  await db.exec(`INSERT INTO session VALUES ('viewer-signin','viewer',now()+interval '2 days'),('viewer-other','viewer',now()+interval '3 days'),('near-signin','near',now()+interval '2 days');`);
  if(beforeMigration) await beforeMigration(db);
  await db.exec(fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261114162937_member_map_account_consent.sql'),'utf8'));
  await fn(db);
 }finally{await db.close();}
}
const call=async(db,sql,args=[]) => (await db.query('SELECT '+sql+' value',args)).rows[0].value;

const enable=(db,user='viewer',session='viewer-signin',revision=0)=>call(db,"member_map_update_account($1,$2,$3,true,true,'events-map-account-v3')",[user,session,revision]);
const publish=(db,user='viewer',session='viewer-signin',revision=1)=>call(db,'member_map_publish_account($1,$2,$3,40.123456,-74.123456,now())',[user,session,revision]);
test('explicit durable account consent works on every valid account session without widening other grants',()=>fixture(async db=>{
 const settings=await enable(db);
 assert.equal(settings.consentVersion,'events-map-account-v3');
 assert.equal(settings.shareUntil,null);
 assert.equal(settings.eventsMapEnabled,true);
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-other')")).eventsMapEnabled,true);
 assert.equal((await call(db,"member_map_session_settings('viewer','near-signin')")).eventsMapEnabled,false);
 await assert.rejects(()=>enable(db,'near','viewer-signin'),/Live sign-in/);
 await assert.rejects(()=>call(db,"member_map_update_account('near','near-signin',0,true,true,'events-map-session-v2')"),/Explicit/);
 await call(db,"member_map_update_session('near','near-signin',0,true,true,'events-map-session-v2')");
 assert.equal((await call(db,"member_map_session_settings('near','near-signin')")).consentVersion,'events-map-session-v2');
 await assert.rejects(()=>publish(db,'near','near-signin'),/off or expired/);
 await publish(db,'viewer','viewer-other');
 const self=(await call(db,"member_map_nearby_session('viewer','viewer-signin')")).self;
 assert.ok(self);assert.equal(self.latitude,40.12);
 assert.ok(Date.parse(self.expiresAt)-Date.now()<=900000);
}));
test('deleting or expiring publisher sign-in removes point without revoking account preference',()=>fixture(async db=>{
 await enable(db); await enable(db,'near','near-signin');
 await publish(db);await publish(db,'near','near-signin');
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-other')")).members.length,1);
 await db.exec("UPDATE session SET \"expiresAt\"=now()-interval '1 second' WHERE id='near-signin'");
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-other')")).members.length,0);
 assert.equal((await call(db,"member_map_get_settings('near')")).eventsMapEnabled,true);
 await db.exec("DELETE FROM session WHERE id='viewer-signin'");
 assert.equal((await db.query("SELECT count(*)::int n FROM member_map_presence WHERE user_id='viewer'")).rows[0].n,0);
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-other')")).eventsMapEnabled,true);
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-signin')")).self,null);
 await publish(db,'viewer','viewer-other');
 assert.ok((await call(db,"member_map_nearby_session('viewer','viewer-other')")).self);
}));
test('detach only removes this publisher; explicit Stop sharing revokes account-wide and rejects stale writers',()=>fixture(async db=>{
 await enable(db);await publish(db,'viewer','viewer-other');
 await call(db,"member_map_detach_session('viewer','viewer-signin')");
 assert.ok((await call(db,"member_map_nearby_session('viewer','viewer-other')")).self);
 await call(db,"member_map_detach_session('viewer','viewer-other')");
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-other')")).self,null);
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-other')")).eventsMapEnabled,true);
 await publish(db);
 await call(db,"member_map_revoke('viewer',false)");
 for(const session of ['viewer-signin','viewer-other']){
 assert.equal((await call(db,"member_map_session_settings('viewer',$1)",[session])).eventsMapEnabled,false);
 await assert.rejects(()=>publish(db,'viewer',session),/off or expired/);
 }
 await assert.rejects(()=>enable(db,'viewer','viewer-other',1),/Settings changed/);
}));
test('overall off clears points and independent legacy proximity, old session logout remains bounded',()=>fixture(async db=>{
 await enable(db);await publish(db);await call(db,"member_map_revoke('viewer',true)");
 assert.equal((await call(db,"member_map_get_settings('viewer')")).locationEnabled,false);
 assert.equal((await db.query("SELECT count(*)::int n FROM member_map_presence")).rows[0].n,0);
 await call(db,"member_map_update_session('near','near-signin',0,true,true,'events-map-session-v2')");
 await call(db,"member_map_detach_session('near','near-signin')");
 assert.equal((await call(db,"member_map_get_settings('near')")).locationEnabled,false);
}));
test('expired observation and invalid revision fail; private or blocked peers stay hidden',()=>fixture(async db=>{
 await enable(db);await enable(db,'near','near-signin');await publish(db);await publish(db,'near','near-signin');
 await assert.rejects(()=>call(db,"member_map_publish_account('viewer','viewer-signin',1,40,-74,now()-interval '2 minutes')"),/Fresh/);
 await assert.rejects(()=>publish(db,'viewer','viewer-signin',0),/off or expired/);
 await db.exec("UPDATE users SET is_private=true WHERE auth_id='near'");
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-signin')")).members.length,0);
 await assert.rejects(()=>publish(db,'near','near-signin'),/off or expired/);
 await db.exec("UPDATE users SET is_private=false WHERE auth_id='near'; INSERT INTO blocks(blocker_id,blocked_id) SELECT a.id,b.id FROM users a,users b WHERE a.auth_id='viewer' AND b.auth_id='near'");
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-signin')")).members.length,0);
}));
test('new RPCs remain service-only and no SQL migration enables accounts implicitly',()=>fixture(async db=>{
 assert.equal((await call(db,"member_map_get_settings('viewer')")).eventsMapEnabled,false);
 for(const role of ['anon','authenticated']){
  await db.exec('SET ROLE '+role);
  for(const sql of ["member_map_update_account('viewer','viewer-signin',0,true,true,'events-map-account-v3')","member_map_publish_account('viewer','viewer-signin',1,40,-74,now())","member_map_detach_session('viewer','viewer-signin')","member_map_presence_live('viewer')","member_map_presence_expiry('viewer')"])
   await assert.rejects(()=>call(db,sql),/permission denied/);
  await db.exec('RESET ROLE');
 }
}));

test('migration preserves pre-existing v1 and v2 grants byte-for-byte',()=>fixture(async db=>{
 const rows=(await db.query("SELECT user_id,consent_version,consent_session_id,share_until::text,revision FROM member_map_settings ORDER BY user_id")).rows;
 assert.deepEqual(rows,db.beforeGrants);
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-other')")).eventsMapEnabled,false);
},async db=>{
 await call(db,"member_map_update_session('viewer','viewer-signin',0,true,true,'events-map-session-v2')");
 await call(db,"member_map_update_settings_four_hours('near',0,true,true,'events-map-v1')");
 db.beforeGrants=(await db.query("SELECT user_id,consent_version,consent_session_id,share_until::text,revision FROM member_map_settings ORDER BY user_id")).rows;
}));
test('authorized service role can enable, publish, read and detach without broader role grants',()=>fixture(async db=>{
 await db.exec('SET ROLE service_role');
 await enable(db); await publish(db);
 assert.ok((await call(db,"member_map_nearby_session('viewer','viewer-other')")).self);
 await call(db,"member_map_detach_session('viewer','viewer-signin')");
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-other')")).eventsMapEnabled,true);
 await call(db,"member_map_revoke('viewer',false)");
 await db.exec('RESET ROLE');
}));
