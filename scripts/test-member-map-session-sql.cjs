const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
async function fixture(fn) {
 const db=new PGlite();
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/member-map/schema.sql'),'utf8'));
  await db.exec('CREATE TABLE public.session(id text PRIMARY KEY,"userId" text REFERENCES public."user"(id),"expiresAt" timestamptz); GRANT SELECT ON public.session TO service_role;');
  await db.exec("ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now()");
  const legacy=fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261011203000_legacy_adult_access.sql'),'utf8');
  await db.exec(legacy.slice(0,legacy.indexOf('CREATE OR REPLACE FUNCTION public.viewer_is_verified_adult'))+'COMMIT;');
  for(const file of ['20261024164346_member_map_explicit_consent.sql','20261029041500_member_map_legacy_approval.sql','20261029051500_member_map_self_avatar.sql','20261029205205_member_map_four_hour_sharing.sql','20261109050000_member_map_session_consent.sql']) await db.exec(fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations',file),'utf8'));
  await db.exec(`INSERT INTO session VALUES ('viewer-signin','viewer',now()+interval '2 days'),('viewer-other','viewer',now()+interval '3 days'),('near-signin','near',now()+interval '2 days');`);
  await fn(db);
 }finally{await db.close();}
}
const call=async(db,sql,args=[]) => (await db.query('SELECT '+sql+' value',args)).rows[0].value;
const enable=(db,user='viewer',session='viewer-signin',revision=0)=>call(db,"member_map_update_session($1,$2,$3,true,true,'events-map-session-v2')",[user,session,revision]);
const publish=(db,user='viewer',session='viewer-signin',revision=1)=>call(db,'member_map_publish_session($1,$2,$3,40,-74,now())',[user,session,revision]);
test('new explicit consent binds the verified session, retains original expiry, never extends old grants',()=>fixture(async db=>{
 const settings=await enable(db);
 assert.equal(settings.eventsMapEnabled,true);
 assert.equal(settings.sessionKey,'viewer-signin');
 assert.ok(Date.parse(settings.shareUntil)-Date.now()>24*3600000,'replaces four-hour cap with bounded sign-in expiry');
 await assert.rejects(()=>enable(db,'near','viewer-signin'),/Live sign-in/);
 await assert.rejects(()=>call(db,"member_map_update_session('near','near-signin',0,true,true,'events-map-v1')"),/consent/);
 await publish(db);
 await assert.rejects(()=>publish(db,'viewer','viewer-other'),/off or expired/);
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-other')")).eventsMapEnabled,false);
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-other')")).center,null);
 await db.exec(`UPDATE session SET "expiresAt"=now()+interval '4 days' WHERE id='viewer-signin'`);
 assert.equal((await call(db,"member_map_session_settings('viewer','viewer-signin')")).shareUntil,settings.shareUntil,'token/session refresh never extends consent');
 await call(db,"member_map_update_settings_four_hours('near',0,true,true,'events-map-v1')");
 const old=await call(db,"member_map_get_settings('near')");
 assert.ok(Date.parse(old.shareUntil)-Date.now()<4*3600000+1000,'legacy consent remains capped');
}));
test('expired or revoked target/viewer sessions cannot expose stale presence',()=>fixture(async db=>{
 await enable(db);await enable(db,'near','near-signin');await publish(db);await publish(db,'near','near-signin');
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-signin')")).members.length,1);
 await db.exec(`UPDATE session SET "expiresAt"=now()-interval '1 second' WHERE id='near-signin'`);
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-signin')")).members.length,0);
 assert.equal((await call(db,"member_map_session_settings('near','near-signin')")).eventsMapEnabled,false);
 await assert.rejects(()=>publish(db,'near','near-signin'),/off or expired/);
 await db.exec(`DELETE FROM session WHERE id='viewer-signin'`);
 assert.equal((await db.query("SELECT count(*)::int n FROM member_map_presence WHERE user_id='viewer'")).rows[0].n,0);
 assert.equal((await call(db,"member_map_get_settings('viewer')")).eventsMapEnabled,false);
 assert.equal((await call(db,"member_map_nearby_session('viewer','viewer-signin')")).center,null);
}));
test('session source checks keep revision, observation, coarse minimization and permission safeguards',()=>fixture(async db=>{
 await enable(db);await publish(db);
 assert.equal((await db.query("SELECT latitude FROM member_map_presence")).rows[0].latitude,40);
 await assert.rejects(()=>call(db,"member_map_publish_session('viewer','viewer-signin',1,40,-74,now()-interval '2 minutes')"),/Fresh/);
 await call(db,"member_map_revoke('viewer',true)");
 await assert.rejects(()=>publish(db),/off or expired/);
 for(const role of ['anon','authenticated']){
  await db.exec('SET ROLE '+role);
  await assert.rejects(()=>call(db,"member_map_session_settings('viewer','viewer-signin')"),/permission denied/);
  await db.exec('RESET ROLE');
 }
}));
