const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = readFileSync(__dirname + '/../apps/mobile/supabase/migrations/20261109110000_private_follow_requests.sql', 'utf8');
const cutover = readFileSync(__dirname + '/../docs/security/private-follow-preservation-cutover.sql', 'utf8');
async function setup(existingPublic = false) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE users(id bigint PRIMARY KEY,auth_id text UNIQUE,is_private boolean);
    CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb);
    CREATE TABLE blocks(blocker_id bigint,blocked_id bigint);
    CREATE TABLE follows(id serial PRIMARY KEY, follower_id bigint REFERENCES users(id) ON DELETE CASCADE,following_id bigint REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz DEFAULT now(), UNIQUE(follower_id,following_id));
    INSERT INTO users VALUES(1,'viewer',false),(2,'private',true),(3,'public',false),(4,'outsider',false);
    INSERT INTO user_settings VALUES('private','{"privacy":{"privateAccount":true}}');
    INSERT INTO follows(follower_id,following_id) VALUES(1,2);`);
  if (existingPublic) await db.exec("INSERT INTO follows(follower_id,following_id) VALUES(1,3)");
  await db.exec(migration);
  // Relationship-only fixture; full post policies and real privacy trigger are
  // exercised independently by test-weekly-post-follow-sql.cjs.
  await db.exec(`UPDATE follow_access_cutovers SET read_gate_version=1; CREATE FUNCTION post_follow_hidden(bigint) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION fixture_privacy_sync() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
      UPDATE users SET is_private=(NEW.settings#>>'{privacy,privateAccount}')::boolean WHERE auth_id=NEW.auth_id; RETURN NEW; END$$;
    CREATE TRIGGER user_settings_sync_account_privacy AFTER INSERT OR UPDATE ON user_settings
      FOR EACH ROW WHEN(NEW.settings#>'{privacy,privateAccount}' IN ('true'::jsonb,'false'::jsonb)) EXECUTE FUNCTION fixture_privacy_sync();`);
  await db.exec(cutover);
  return db;
}
async function call(db, actor, target, action) { return (await db.query('SELECT mutate_follow_relationship($1,$2,$3) AS result',[actor,target,action])).rows[0].result; }
test('pending, approval ownership, cancellation, repeat and historical follows', async () => {
 const db=await setup(); try {
  assert.equal((await call(db,1,2,'status')).following,true);
  assert.equal((await call(db,1,2,'follow')).followRequestStatus,'none');
  await call(db,1,2,'unfollow');
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
test('public follows retain acceptance across privacy transitions without owner approval', async () => {
 const db=await setup();try {
  assert.equal((await call(db,1,3,'follow')).following,true);
  assert.equal((await call(db,1,3,'follow')).notifyFollow,false);
  await db.exec('UPDATE users SET is_private=true WHERE id=3');
  assert.equal((await call(db,1,3,'status')).following,true);
  assert.equal((await call(db,1,3,'status')).followRequestStatus,'none');
  await db.exec(`INSERT INTO user_settings VALUES('public','{"privacy":{"privateAccount":"invalid"}}')`);
  assert.equal((await call(db,1,3,'status')).following,true,'malformed private still permits accepted existing follower');
  await call(db,1,3,'unfollow');
  assert.equal((await call(db,1,3,'follow')).followRequestStatus,'pending');
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
  assert.equal((await call(db,1,3,'status')).following,true);
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


test('one-shot preservation keeps every pre-cutover incarnation without claiming owner approval', async () => {
 const db=await setup(true);try {
  const before=(await db.query('SELECT * FROM follows ORDER BY id')).rows;
  assert.equal((await call(db,1,2,'status')).following,true);
  assert.equal((await call(db,1,2,'follow')).followRequestStatus,'none');
  assert.equal((await call(db,1,2,'follow')).notifyFollow,false);
  await db.exec('UPDATE users SET is_private=true WHERE id=3');
  assert.equal((await call(db,1,3,'status')).following,true,'existing Public relationships survive Private transition');
  assert.equal((await db.query('SELECT count(*)::int n FROM follow_requests')).rows[0].n,0);
  assert.deepEqual((await db.query('SELECT * FROM follows ORDER BY id')).rows,before,'no follow rewrites/count-trigger events');
  const batch=(await db.query('SELECT * FROM follow_access_cutovers')).rows[0];
  assert.equal(Number(batch.relationship_count),2);assert.equal(batch.provenance,'legacy_access_preservation');
  await call(db,1,2,'unfollow');
  await db.exec("INSERT INTO follows(id,follower_id,following_id,created_at) VALUES(1,1,2,'2000-01-01')");
  await db.exec(migration);
  assert.equal((await db.query('SELECT ready FROM follow_access_cutovers')).rows[0].ready,true,'additive migration rerun never reopens compatibility');
  await db.exec(cutover);
  assert.equal((await call(db,1,2,'status')).following,false,'same id/backdated reinsert and rerun cannot resurrect');
  assert.equal((await db.query('SELECT count(*)::int n FROM follow_legacy_access')).rows[0].n,1);
  assert.equal((await call(db,4,2,'follow')).followRequestStatus,'pending');
 }finally{await db.close();}
});

test('identity mutations and owner removal retire grants and real approvals permanently', async () => {
 const db=await setup();try {
  await db.exec('UPDATE follows SET id=101 WHERE follower_id=1');
  assert.equal((await call(db,1,2,'status')).following,false);
  await db.exec('UPDATE follows SET id=1 WHERE follower_id=1');
  assert.equal((await call(db,1,2,'status')).following,false);
  await call(db,1,2,'follow');await call(db,2,1,'approve');
  assert.equal((await call(db,1,2,'status')).following,true);
  await db.exec('UPDATE follows SET follower_id=4 WHERE id=1');
  assert.equal((await call(db,4,2,'status')).following,false);
  await db.exec('UPDATE follows SET follower_id=1 WHERE id=1');
  assert.equal((await call(db,1,2,'status')).following,false);
  await call(db,1,2,'follow');await call(db,2,1,'approve');
  await db.exec('DELETE FROM follows WHERE id=1; INSERT INTO follows(id,follower_id,following_id) VALUES(1,1,2)');
  assert.equal((await call(db,1,2,'status')).following,false,'direct owner removal clears approval too');
  assert.equal((await db.query("SELECT count(*)::int n FROM follow_requests WHERE status='approved'")).rows[0].n,0);
 }finally{await db.close();}
});

test('client writes cannot manufacture grants, readiness, or raw follows; service cannot resnapshot', async () => {
 const db=await setup();try {
  for(const role of ['anon','authenticated']) {
   await db.exec(`SET ROLE ${role}`);
   for(const sql of ['SELECT * FROM follow_legacy_access','SELECT * FROM follow_access_cutovers',
    'INSERT INTO follows(follower_id,following_id) VALUES(4,2)','UPDATE follows SET id=99','DELETE FROM follows',
    'SELECT private_follow_authorized(1,2)','SELECT * FROM post_relationship_access(1,ARRAY[2]::bigint[])'])
     await assert.rejects(db.exec(sql),e=>e.code==='42501');
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  for(const sql of ["INSERT INTO follow_legacy_access VALUES(999,'private-follow-v1')",'DELETE FROM follow_access_cutovers','UPDATE follow_access_cutovers SET ready=true','UPDATE follow_access_cutovers SET ready=false'])
   await assert.rejects(db.exec(sql),e=>e.code==='42501');
  await db.exec('RESET ROLE');
  await db.exec('DELETE FROM users WHERE id=2');
  assert.equal((await db.query('SELECT count(*)::int n FROM follow_legacy_access')).rows[0].n,0);
 }finally{await db.close();}
});
