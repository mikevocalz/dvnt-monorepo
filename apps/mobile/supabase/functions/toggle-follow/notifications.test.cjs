const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../../../../..');
const migration = name => fs.readFileSync(path.join(__dirname, '../../migrations', name), 'utf8');

async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TYPE enum_notifications_type AS ENUM ('follow');
    CREATE TYPE enum_notifications_entity_type AS ENUM ('user');
    CREATE TABLE users(id bigint PRIMARY KEY,auth_id text UNIQUE,is_private boolean,username text);
    CREATE TABLE user_settings(auth_id text PRIMARY KEY,settings jsonb);
    CREATE TABLE follows(id serial PRIMARY KEY,follower_id bigint,following_id bigint,UNIQUE(follower_id,following_id));
    CREATE TABLE blocks(blocker_id bigint,blocked_id bigint);
    CREATE TABLE notifications(id serial PRIMARY KEY,recipient_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,actor_id integer REFERENCES users(id) ON DELETE CASCADE,
      type enum_notifications_type NOT NULL,entity_type enum_notifications_entity_type,entity_id varchar,
      created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),entity_payload jsonb);
    INSERT INTO users VALUES(1,'actor',false,'requester'),(2,'owner',true,'owner'),(3,'legacy',false,'legacy'),(4,'public',false,'public');
    INSERT INTO follows(follower_id,following_id) VALUES(3,2),(3,4);`);
  await db.exec(migration('20261109110000_private_follow_requests.sql'));
  await db.exec(`UPDATE follow_access_cutovers SET read_gate_version=1;
    CREATE FUNCTION post_follow_hidden(bigint) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE FUNCTION fixture_privacy_sync() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
    CREATE TRIGGER user_settings_sync_account_privacy AFTER UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION fixture_privacy_sync();`);
  await db.exec(fs.readFileSync(path.join(root, 'docs/security/private-follow-preservation-cutover.sql'), 'utf8'));
  await db.exec(migration('20261110010000_follow_request_notification_types.sql'));
  await db.exec(migration('20261110010100_follow_request_notifications.sql'));
  const act = async (actor, target, action) => (await db.query('SELECT mutate_follow_relationship($1,$2,$3) AS value', [actor,target,action])).rows[0].value;
  const notices = async () => (await db.query('SELECT recipient_id,actor_id,type::text,entity_id,entity_payload FROM notifications ORDER BY id')).rows;
  return { db, act, notices };
}

test('requests and approvals have distinct transactional activity; repeats do not duplicate', async () => {
  const {db,act,notices} = await fixture();
  try {
    const first = await act(1,2,'follow');
    assert.equal(first.following,false); assert.equal(first.notifyRequest,true); assert.equal(first.notifyFollow,false);
    assert.ok(first.notificationVersion);
    assert.equal((await act(1,2,'follow')).notifyRequest,false);
    assert.deepEqual((await notices()).map(n => [n.type,n.recipient_id,n.actor_id,n.entity_payload.url]), [
      ['follow_request',2,1,'/settings/privacy#follow-requests'],
    ]);
    const approved = await act(2,1,'approve');
    assert.equal(approved.notifyApproval,true); assert.ok(approved.notificationVersion);
    assert.equal((await act(2,1,'approve')).notifyApproval,false);
    assert.deepEqual((await notices()).map(n => [n.type,n.recipient_id,n.actor_id,n.entity_payload.url]), [
      ['follow_request_approved',1,2,undefined],
    ]);
    assert.equal((await act(1,2,'status')).following,true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM follow_legacy_access')).rows[0].n,2);
    assert.equal((await act(3,2,'follow')).notifyRequest,false);
    assert.equal((await notices()).length,1,'preserved followers never need a new approval or notification');
  } finally { await db.close(); }
});

test('cancel/decline retire actionable activity; cancel-before-approve grants no access; re-request is new', async () => {
  const {db,act,notices} = await fixture();
  try {
    const first = await act(1,2,'follow');
    await act(1,2,'unfollow');
    assert.deepEqual(await notices(),[]);
    assert.equal((await act(2,1,'approve')).notifyApproval,false);
    assert.equal((await act(1,2,'status')).following,false);
    const second = await act(1,2,'follow');
    assert.equal(second.notifyRequest,true); assert.notEqual(first.notificationVersion,second.notificationVersion);
    await act(2,1,'decline');
    assert.deepEqual(await notices(),[]);
    await act(1,2,'follow'); await act(2,1,'approve'); await act(1,2,'unfollow');
    assert.equal((await act(1,2,'status')).following,false,'approve-before-cancel is retired by the later cancellation');
    assert.equal((await notices()).filter(n=>n.type==='follow_request').length,0);
  } finally { await db.close(); }
});

test('blocks reject new requests and approvals; rollback emits no activity or grants', async () => {
  const {db,act,notices} = await fixture();
  try {
    await db.exec('INSERT INTO blocks VALUES(2,1)');
    await assert.rejects(act(1,2,'follow'),/unavailable/);
    assert.deepEqual(await notices(),[]);
    await db.exec('DELETE FROM blocks'); await act(1,2,'follow');
    await db.exec('INSERT INTO blocks VALUES(1,2)');
    await assert.rejects(act(2,1,'approve'),/unavailable/);
    assert.equal((await act(1,2,'status')).following,false);
    assert.equal((await notices()).filter(n=>n.type==='follow_request_approved').length,0);
    await act(2,1,'decline');
    assert.deepEqual(await notices(),[]);
    await db.exec('DELETE FROM blocks; BEGIN'); await act(1,2,'follow'); await db.exec('ROLLBACK');
    assert.deepEqual(await notices(),[]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM follows')).rows[0].n,2);
  } finally { await db.close(); }
});

function pushHarness({request=true,blocked=false,errorTable=null,fetchFailure=false,relationship,username='fixture'}={}) {
  const calls=[],sent=[]; let handler;
  const db={rpc:async()=>({data:relationship}),from(table){const filters=[]; const q={
    select(){return q;},eq(k,v){filters.push([k,v]);return q;},or(value){filters.push(['or',value]);return q;},limit(){return q;},
    maybeSingle:async()=>({data:request?{status:'pending'}:null,error:errorTable===table?{}:null}),
    single:async()=>({data:{username},error:errorTable===table?{}:null}),
    then(resolve){calls.push({table,filters});return Promise.resolve({data:table==='blocks'?(blocked?[{}]:[]):[{token:'fixture-token'}],error:errorTable===table?{}:null}).then(resolve);},
  }; calls.push({table,filters});return q;}};
  const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'index.ts'),'utf8')+'\nexports.__push = sendFollowRequestPush;',{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const exported={};
  const requireStub=name=>name.includes('supabase-js')?{createClient:()=>db}
    :name.includes('verify-session')?{verifySessionDetailed:async()=>({ok:true,userId:'actor'})}
    :name.includes('resolve-user')?{resolveOrProvisionUser:async()=>({id:2})}
    :{checkRateLimit:()=>({allowed:true}),WRITE_LIMIT:{}};
  new Function('require','exports','Deno','fetch',source)(requireStub,exported,{serve(fn){handler=fn;},env:{get:()=> 'fixture'}},async(_url,options)=>{
    assert.ok(options.signal, 'best-effort push has a bounded timeout');
    sent.push(JSON.parse(options.body));return {ok:!fetchFailure,status:503};
  });
  return {calls,sent,push:(transition)=>exported.__push(db,2,1,transition),invoke:async(action)=>(await handler(new Request('https://offline.test',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({targetUserId:1,action})}))).json()};
}

test('push routes and recipients match transitions, never insert duplicate activity',async()=>{
  for(const approved of [false,true]) {
    const h=pushHarness();
    await h.push({notifyRequest:!approved,notifyApproval:approved,notificationVersion:'2026-11-10T00:00:00Z'});
    assert.equal(h.sent.length,1);
    assert.equal(h.sent[0][0].data.type,approved?'follow_request_approved':'follow_request');
    assert.equal(h.sent[0][0].data.url,approved?'https://dvntapp.live/profile/fixture':'https://dvntapp.live/settings/privacy#follow-requests');
    assert.ok(h.calls.find(c=>c.table==='follow_requests').filters.some(([k,v])=>k==='updated_at'&&v==='2026-11-10T00:00:00Z'));
    assert.ok(!h.calls.some(c=>c.table==='notifications'));
  }
});

test('push fails closed for retired requests, blocks and read errors; provider failure is explicit',async()=>{
  for(const config of [{request:false},{blocked:true},{errorTable:'follow_requests'},{errorTable:'blocks'},{errorTable:'users'},{errorTable:'push_tokens'}]) {
    const h=pushHarness(config);await h.push({notifyRequest:true,notificationVersion:'version'});assert.deepEqual(h.sent,[]);
  }
  const noVersion=pushHarness(); await noVersion.push({notifyRequest:true});assert.deepEqual(noVersion.sent,[]);
  const failed=pushHarness({fetchFailure:true});await assert.rejects(failed.push({notifyApproval:true,notificationVersion:'version'}),/503/);
});


test('successful request/approval stays successful when push provider fails; no decline/cancel/repeat push',async()=>{
  for(const action of ['follow','approve']) {
    const h=pushHarness({fetchFailure:true,relationship:{following:false,followRequestStatus:'pending',notifyRequest:action==='follow',notifyApproval:action==='approve',notificationVersion:'version'}});
    assert.equal((await h.invoke(action)).ok,true); assert.equal(h.sent.length,1);
    assert.ok(h.calls.find(c=>c.table==='push_tokens').filters.some(([k,v])=>k==='user_id'&&v===1),'push goes to the other account');
    const filters=h.calls.find(c=>c.table==='follow_requests').filters;
    assert.ok(filters.some(([k,v])=>k==='follower_id'&&v===(action==='approve'?1:2)));
    assert.ok(filters.some(([k,v])=>k==='following_id'&&v===(action==='approve'?2:1)));
  }
  for(const action of ['decline','unfollow','approve','follow']) {
    const h=pushHarness({relationship:{following:false,followRequestStatus:'none',notifyRequest:false,notifyApproval:false,notifyFollow:false}});
    assert.equal((await h.invoke(action)).ok,true);assert.deepEqual(h.sent,[]);
  }
});


test('new notification migration preserves public-to-private access and service-only mutation boundary',async()=>{
  const {db,act,notices}=await fixture();
  try {
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(act(1,2,'follow'),/permission denied/);
      await assert.rejects(db.exec("INSERT INTO notifications(recipient_id,actor_id,type) VALUES(2,1,'follow_request')"),/permission denied/);
      await db.exec('RESET ROLE');
    }
    const before=(await db.query('SELECT * FROM follows ORDER BY id')).rows;
    await db.exec('UPDATE users SET is_private=true WHERE id=4');
    assert.equal((await act(3,4,'status')).following,true);
    assert.equal((await act(3,2,'status')).following,true);
    assert.deepEqual((await db.query('SELECT * FROM follows ORDER BY id')).rows,before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM follow_legacy_access')).rows[0].n,2);
    assert.deepEqual(await notices(),[]);
    await db.exec('SET ROLE service_role');
    await act(1,2,'follow');await act(1,2,'follow');
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM follow_requests')).rows[0].n,1);
    assert.equal((await notices()).length,1);
  } finally {await db.close();}
});

test('notification insert failure rolls back the entire request and approval transaction',async()=>{
  const {db,act,notices}=await fixture();
  try {
    const install=()=>db.exec(`CREATE FUNCTION fixture_fail_notification() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'fixture notification unavailable'; END$$;
      CREATE TRIGGER fixture_fail_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fixture_fail_notification();`);
    const remove=()=>db.exec('DROP TRIGGER fixture_fail_notice ON notifications; DROP FUNCTION fixture_fail_notification()');
    await install();await assert.rejects(act(1,2,'follow'),/fixture notification unavailable/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM follow_requests')).rows[0].n,0);
    assert.deepEqual(await notices(),[]);
    await remove();await act(1,2,'follow');const pending=await notices();
    await install();await assert.rejects(act(2,1,'approve'),/fixture notification unavailable/);
    assert.equal((await db.query('SELECT status FROM follow_requests')).rows[0].status,'pending');
    assert.equal((await act(1,2,'status')).following,false);
    assert.deepEqual(await notices(),pending);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM follows')).rows[0].n,2);
  }finally {await db.close();}
});


test('approval push uses an encoded canonical username and safe Activity fallback',async()=>{
  for(const username of ['owner name',null,'']) {
    const h=pushHarness({username});
    await h.push({notifyApproval:true,notificationVersion:'version'});
    assert.equal(h.sent[0][0].data.url,username?'https://dvntapp.live/profile/owner%20name':'https://dvntapp.live/activity');
    assert.equal(h.sent[0][0].data.senderUsername,username || undefined);
  }
});
