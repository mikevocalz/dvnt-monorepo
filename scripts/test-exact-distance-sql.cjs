const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('exact consent is empty on migration, service-only, cascades on sign-out, and cannot survive master withdrawal',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public."user" (id text PRIMARY KEY); CREATE TABLE public.session (id text PRIMARY KEY,"userId" text REFERENCES public."user", "expiresAt" timestamptz);
 CREATE TABLE public.member_map_settings(user_id text PRIMARY KEY,location_enabled boolean);
 CREATE TABLE public.member_proximity_presence(user_id text PRIMARY KEY REFERENCES public."user", share_until timestamptz DEFAULT now()+interval '1 day');
 INSERT INTO public."user" VALUES ('u'); INSERT INTO public.session VALUES ('s','u',now()+interval '2 days'); INSERT INTO member_proximity_presence(user_id) VALUES ('u'); INSERT INTO member_map_settings VALUES ('u',true);`);
 await db.exec(fs.readFileSync('apps/mobile/supabase/migrations/20261109143000_member_exact_distance_consent.sql','utf8'));
 const count=async t=>(await db.query('SELECT count(*)::int n FROM '+t)).rows[0].n;
 assert.equal(await count('member_exact_distance_consent'),0);
 await db.exec('SET ROLE authenticated');await assert.rejects(()=>count('member_exact_distance_consent'),/permission denied/);await db.exec('RESET ROLE');
 const consent=()=>db.exec(`INSERT INTO member_exact_distance_consent VALUES ('u','s',2,now(),now()+interval '1 day'); UPDATE member_proximity_presence SET exact_session_id='s',exact_observed_at=clock_timestamp() WHERE user_id='u';`);
 await assert.rejects(()=>db.exec("INSERT INTO member_exact_distance_consent VALUES ('u','s',2,now(),now()+interval '3 days')"),/Live owned/);
 await db.exec("INSERT INTO public.\"user\" VALUES ('other'); INSERT INTO session VALUES ('wrong','other',now()+interval '2 days')");
 await assert.rejects(()=>db.exec("INSERT INTO member_exact_distance_consent VALUES ('u','wrong',2,now(),now()+interval '1 day')"),/Live owned/);
 await consent();
 const point=(await db.query("SELECT exact_observed_at,share_until FROM member_proximity_presence WHERE user_id='u'")).rows[0];
 assert.ok(Date.parse(point.share_until)-Date.parse(point.exact_observed_at)<=15*60000);
 await assert.rejects(()=>db.exec("UPDATE member_proximity_presence SET share_until=now()+interval '1 day' WHERE user_id='u'"),/newer device observation/);
 for(const timestamp of ["NULL","'infinity'","'-infinity'","now()-interval '61 seconds'","now()+interval '6 seconds'"]) {
  await assert.rejects(()=>db.exec("UPDATE member_proximity_presence SET exact_observed_at="+timestamp+" WHERE user_id='u'"),/Fresh device observation/);
 }
 await db.exec("DELETE FROM member_exact_distance_consent WHERE user_id='u'");
 assert.equal(await count('member_proximity_presence'),0);
 await assert.rejects(()=>db.exec("INSERT INTO member_proximity_presence (user_id,exact_session_id) VALUES ('u','s')"),/Live exact/);
 await db.exec("INSERT INTO member_proximity_presence (user_id) VALUES ('u')");
 await consent();await db.exec("UPDATE member_map_settings SET location_enabled=false WHERE user_id='u'");
 assert.equal(await count('member_exact_distance_consent'),0);assert.equal(await count('member_proximity_presence'),0);
 await assert.rejects(()=>consent(),/Location is disabled/);
 await db.exec("UPDATE member_map_settings SET location_enabled=true");
 await db.exec("INSERT INTO member_proximity_presence (user_id) VALUES ('u')");await consent();await db.exec("DELETE FROM session WHERE id='s'");
 assert.equal(await count('member_exact_distance_consent'),0);assert.equal(await count('member_proximity_presence'),0);
 }finally{await db.close()}
});
