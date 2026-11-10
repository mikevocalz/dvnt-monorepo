const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const rpcMigration=fs.readFileSync(__dirname+'/../apps/mobile/supabase/migrations/20261110010200_profile_social_graph_rpc.sql','utf8');
const gateMigration=fs.readFileSync(__dirname+'/../apps/mobile/supabase/migrations/20261110010300_private_follow_graph_read_gate.sql','utf8');
const follow=fs.readFileSync(__dirname+'/../apps/mobile/supabase/migrations/20261109110000_private_follow_requests.sql','utf8');
async function setup(applyGate=true){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE media(id bigint PRIMARY KEY,url text);
 CREATE TABLE users(id bigint PRIMARY KEY,auth_id text UNIQUE,is_private boolean,username text,first_name text,verified boolean,avatar_id bigint REFERENCES media);
 CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb);
 CREATE TABLE blocks(blocker_id bigint,blocked_id bigint);
 CREATE TABLE follows(id serial PRIMARY KEY,follower_id bigint REFERENCES users,following_id bigint REFERENCES users,UNIQUE(follower_id,following_id));
 CREATE FUNCTION viewer_user_id() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT id FROM users WHERE auth_id=NULLIF(current_setting('request.jwt.claim.sub',true),'') $$;
 INSERT INTO users VALUES(1,'viewer',false,'viewer','Viewer',false,null),(2,'private',true,'private','Private',false,null),(3,'public',false,'public','Public',false,null),(4,'outsider',false,'outsider','Outsider',false,null);
 INSERT INTO follows(follower_id,following_id) VALUES(1,2),(3,2),(2,3),(4,3);
 ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
 CREATE POLICY old_everyone ON follows FOR SELECT USING(true);
 GRANT SELECT ON follows TO anon,authenticated;
 GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
 await db.exec(follow);
 await db.exec(`INSERT INTO follow_legacy_access SELECT id,'private-follow-v1' FROM follows;
 UPDATE follow_access_cutovers SET ready=true,read_gate_version=1,captured_at=now(),relationship_count=4;`);
 await db.exec(rpcMigration);
 if(applyGate) await db.exec(gateMigration);
 return db;
}
async function rpc(db,viewer,target,direction='followers'){
 await db.exec('SET ROLE service_role');
 try{return (await db.query('SELECT get_profile_social_graph($1,$2,$3,20,0) result',[viewer,target,direction])).rows[0].result;}
 finally{await db.exec('RESET ROLE');}
}
async function raw(db,subject,role='authenticated'){
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[subject||'']);await db.exec('SET ROLE '+role);
 try{return (await db.query('SELECT follower_id,following_id FROM follows ORDER BY id')).rows.map(r=>[Number(r.follower_id),Number(r.following_id)]);}
 finally{await db.exec('RESET ROLE');}
}
test('atomic social-list RPC: private/public/owner/preserved/approval/block and restricted callers',async()=>{
 const db=await setup();try{
  for(const direction of ['followers','following']){
   assert.equal((await rpc(db,null,2,direction)).allowed,false);
   assert.equal((await rpc(db,4,2,direction)).allowed,false);
   assert.equal((await rpc(db,1,2,direction)).allowed,true);
   assert.equal((await rpc(db,2,2,direction)).allowed,true);
   assert.equal((await rpc(db,null,3,direction)).allowed,true);
  }
  const list=await rpc(db,1,2);assert.equal(list.docs.length,2);assert.equal(list.totalDocs,2);assert.equal(list.docs[0].id,'1');
  await db.query("SELECT mutate_follow_relationship(4,2,'follow')");assert.equal((await rpc(db,4,2)).allowed,false);
  await db.query("SELECT mutate_follow_relationship(2,4,'approve')");assert.equal((await rpc(db,4,2)).allowed,true);
  await db.exec('INSERT INTO blocks VALUES(2,4)');assert.equal((await rpc(db,4,2)).allowed,false);
  await db.exec('DELETE FROM blocks');await db.exec('INSERT INTO blocks VALUES(4,2)');assert.equal((await rpc(db,4,2)).allowed,false);
  await db.exec('DELETE FROM blocks');await db.query("SELECT mutate_follow_relationship(4,2,'unfollow')");assert.equal((await rpc(db,4,2)).allowed,false);
  for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(()=>db.query("SELECT get_profile_social_graph(2,2,'followers',20,0)"),e=>e.code==='42501');await db.exec('RESET ROLE');}
  const def=(await db.query("SELECT provolatile,prosecdef,pg_get_functiondef(oid) body FROM pg_proc WHERE proname='get_profile_social_graph'")).rows[0];
  assert.equal(def.provolatile,'s');assert.equal(def.prosecdef,true);assert.match(def.body,/WITH access AS/);
 }finally{await db.close();}
});
test('restrictive raw policy defeats permissive everyone policy and preserves own verified rows',async()=>{
 const db=await setup();try{
  assert.deepEqual(await raw(db,null,'anon'),[[4,3]],'private endpoint edges cannot be enumerated through the opposite public endpoint');
  assert.deepEqual(await raw(db,'outsider'),[[4,3]]);
  assert.deepEqual(await raw(db,'viewer'),[[1,2],[3,2],[2,3],[4,3]]);
  assert.deepEqual(await raw(db,'private'),[[1,2],[3,2],[2,3],[4,3]]);
  await db.exec('INSERT INTO blocks VALUES(1,2)');
  assert.deepEqual(await raw(db,'viewer'),[[1,2],[4,3]],'own relation readable but blocked third-party graph concealed');
  await db.exec('DELETE FROM blocks');await db.query("SELECT mutate_follow_relationship(1,2,'unfollow')");
  assert.deepEqual(await raw(db,'viewer'),[[4,3]],'revocation removes private graph access');
 }finally{await db.close();}
});

test('additive RPC ships before raw gate without changing legacy reads',async()=>{
 const db=await setup(false);try{
  assert.equal((await rpc(db,null,2)).allowed,false,'new handlers have guarded RPC before gate');
  assert.equal((await rpc(db,1,2)).allowed,true);
  assert.equal((await raw(db,null,'anon')).length,4,'additive phase preserves legacy behavior, not full privacy');
  assert.equal((await db.query("SELECT count(*) n FROM pg_policies WHERE policyname='private_social_graph_gate'")).rows[0].n,0);
  await db.exec(gateMigration);
  assert.deepEqual(await raw(db,null,'anon'),[[4,3]],'separately approved gate closes legacy bypass');
  assert.equal((await rpc(db,1,2)).allowed,true);
 }finally{await db.close();}
});
