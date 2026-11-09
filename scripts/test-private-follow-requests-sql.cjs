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
   for (const action of ['approve', 'follow', 'unfollow', 'toggle', 'status']) {
    await assert.rejects(()=>call(db,2,1,action),e=>e.code==='42501');
   }
   await assert.rejects(()=>db.query('SELECT * FROM follow_requests'),e=>e.code==='42501');
   await db.exec('RESET ROLE');
  }
  await assert.rejects(()=>call(db,1,1,'follow'));
  await assert.rejects(()=>call(db,1,999,'follow'));
  await assert.rejects(()=>call(db,1,2,'unknown'));
  await assert.rejects(()=>call(db,1,2,null),e=>e.code==='22023');
 }finally{await db.close();}
});

test('legacy public toggles alternate while explicit writes stay idempotent', async () => {
 const db=await setup();try {
  await db.exec('SET ROLE service_role');
  for (let i=0;i<6;i++) {
   const following=i%2===0;
   assert.deepEqual(await call(db,1,3,'toggle'), {
    following,followRequestStatus:'none',notifyFollow:following,
   });
  }
  assert.equal((await call(db,1,3,'follow')).following,true);
  assert.equal((await call(db,1,3,'follow')).notifyFollow,false);
  assert.equal((await call(db,1,3,'unfollow')).following,false);
  assert.equal((await call(db,1,3,'unfollow')).following,false);
  assert.equal((await call(db,1,3,'toggle')).following,true);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int n FROM follow_requests')).rows[0].n,0);
 }finally{await db.close();}
});

test('legacy private toggles request, cancel pending, and revoke approved relationships', async () => {
 const db=await setup();try {
  // Use a new relationship; setup also retains a separate historical follow.
  for (let i=0;i<6;i++) {
   const pending=i%2===0;
   assert.deepEqual(await call(db,4,2,'toggle'), {
    following:false,followRequestStatus:pending?'pending':'none',notifyFollow:false,
   });
   assert.equal((await db.query('SELECT count(*)::int n FROM follows WHERE follower_id=4')).rows[0].n,0);
  }
  await call(db,4,2,'toggle');
  await call(db,4,2,'follow');
  assert.equal((await call(db,4,2,'status')).followRequestStatus,'pending','explicit follow does not cancel');
  await call(db,4,2,'approve'); // Requester cannot approve its own outbound request.
  await call(db,3,4,'approve'); // A different recipient cannot approve it either.
  assert.equal((await call(db,4,2,'status')).following,false);
  await assert.rejects(()=>call(db,4,4,'toggle'),e=>e.code==='22023');
  await assert.rejects(()=>call(db,4,4,'approve'),e=>e.code==='22023');
  await call(db,2,4,'approve');
  assert.equal((await call(db,4,2,'status')).following,true);
  assert.deepEqual(await call(db,4,2,'toggle'),{following:false,followRequestStatus:'none',notifyFollow:false});
  await call(db,2,4,'approve');
  assert.equal((await call(db,4,2,'status')).following,false,'approval cannot resurrect cancelled intent');
  assert.equal((await call(db,4,2,'toggle')).followRequestStatus,'pending','new follow must request approval again');
  await call(db,2,4,'decline');
  assert.equal((await call(db,4,2,'toggle')).followRequestStatus,'pending');
 }finally{await db.close();}
});

test('legacy historical and privacy-transition toggles never manufacture approval', async () => {
 const db=await setup();try {
  // An old client saw this raw follow. Toggling it cancels, never approves it.
  assert.deepEqual(await call(db,1,2,'toggle'),{following:false,followRequestStatus:'none',notifyFollow:false});
  assert.equal((await call(db,1,2,'toggle')).followRequestStatus,'pending');
  assert.equal((await call(db,1,2,'status')).following,false);
  assert.equal((await call(db,1,2,'toggle')).followRequestStatus,'none');
  await call(db,1,3,'toggle');
  await db.exec('UPDATE users SET is_private=true WHERE id=3');
  assert.equal((await call(db,1,3,'status')).following,false);
  assert.equal((await call(db,1,3,'toggle')).followRequestStatus,'none');
  assert.equal((await call(db,1,3,'toggle')).followRequestStatus,'pending');
  await db.exec('UPDATE users SET is_private=false WHERE id=3');
  assert.equal((await call(db,1,3,'toggle')).following,false,'pending intent cancels even after target becomes Public');
  assert.equal((await call(db,1,3,'toggle')).following,true);
  assert.equal((await call(db,1,3,'status')).followRequestStatus,'none');
  await db.exec(`INSERT INTO user_settings VALUES('public','{"privacy":{"privateAccount":"invalid"}}')`);
  await call(db,1,3,'toggle');
  assert.equal((await call(db,1,3,'toggle')).followRequestStatus,'pending','malformed privacy remains fail-closed');
  assert.equal((await db.query("SELECT count(*)::int n FROM follow_requests WHERE status='approved'")).rows[0].n,0);
 }finally{await db.close();}
});
