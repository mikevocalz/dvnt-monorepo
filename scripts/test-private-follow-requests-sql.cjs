const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = readFileSync(__dirname + '/../apps/mobile/supabase/migrations/20261109110000_private_follow_requests.sql', 'utf8');
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE users(id bigint PRIMARY KEY,auth_id text UNIQUE,is_private boolean);
    CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb);
    CREATE TABLE follows(follower_id bigint REFERENCES users(id),following_id bigint REFERENCES users(id), UNIQUE(follower_id,following_id));
    INSERT INTO users VALUES(1,'viewer',false),(2,'private',true),(3,'public',false),(4,'outsider',false);
    INSERT INTO user_settings VALUES('private','{"privacy":{"privateAccount":true}}');
    INSERT INTO follows VALUES(1,2);`);
  await db.exec(migration);
  return db;
}
async function call(db, actor, target, action) { return (await db.query('SELECT mutate_follow_relationship($1,$2,$3) AS result',[actor,target,action])).rows[0].result; }
test('pending, approval ownership, cancellation, repeat and historical follows', async () => {
 const db=await setup(); try {
  assert.equal((await call(db,1,2,'status')).following,false);
  assert.equal((await call(db,1,2,'follow')).followRequestStatus,'pending');
  await call(db,1,2,'follow');
  assert.equal((await db.query('SELECT count(*)::int n FROM follow_requests')).rows[0].n,1);
  await call(db,4,1,'approve');
  assert.equal((await call(db,1,2,'status')).following,false);
  await call(db,2,1,'approve'); await call(db,2,1,'approve');
  assert.equal((await call(db,1,2,'status')).following,true);
  await call(db,1,2,'unfollow'); await call(db,2,1,'approve');
  assert.equal((await call(db,1,2,'status')).following,false);
  assert.equal((await db.query('SELECT count(*)::int n FROM follows')).rows[0].n,0);
  await call(db,1,2,'follow'); await call(db,2,1,'decline'); await call(db,2,1,'approve');
  assert.equal((await call(db,1,2,'status')).followRequestStatus,'none');
  await call(db,1,2,'follow');
  assert.equal((await call(db,1,2,'status')).followRequestStatus,'pending');
 } finally {await db.close();}
});
test('public follows and transitions never manufacture private approval', async () => {
 const db=await setup();try {
  assert.equal((await call(db,1,3,'follow')).following,true);
  assert.equal((await call(db,1,3,'follow')).notifyFollow,false);
  await db.exec('UPDATE users SET is_private=true WHERE id=3');
  assert.equal((await call(db,1,3,'status')).following,false);
  await call(db,1,3,'follow');
  await db.exec('UPDATE users SET is_private=false WHERE id=3');
  assert.equal((await call(db,1,3,'follow')).following,true);
  assert.equal((await call(db,1,3,'status')).followRequestStatus,'none');
  await db.exec(`INSERT INTO user_settings VALUES('public','{"privacy":{"privateAccount":"invalid"}}')`);
  assert.equal((await call(db,1,3,'status')).following,false);
 } finally {await db.close();}
});
test('untrusted roles cannot forge actor, read requests or approve themselves', async () => {
 const db=await setup();try {
  for(const role of ['anon','authenticated']) {
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(()=>call(db,2,1,'approve'),e=>e.code==='42501');
   await assert.rejects(()=>db.query('SELECT * FROM follow_requests'),e=>e.code==='42501');
   await db.exec('RESET ROLE');
  }
  await assert.rejects(()=>call(db,1,1,'follow'));
  await assert.rejects(()=>call(db,1,999,'follow'));
  await assert.rejects(()=>call(db,1,2,'toggle'));
 }finally{await db.close();}
});
