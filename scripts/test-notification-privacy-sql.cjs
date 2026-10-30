// Disposable socket-only PostgreSQL, never a remote URL. Fails rather than skips.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync,spawnSync}=require('node:child_process');
const {Pool}=require('pg');
function bins(){for(const dir of [process.env.POSTGRES_BIN,'',...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined))if(['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0))return dir;throw Error('PostgreSQL server unavailable: notification privacy tests NOT RUN');}
test('metadata-matched permissive baseline then least-privilege notification draft',{timeout:120000},async t=>{
 const bin=bins(),data=fs.mkdtempSync(path.join(os.tmpdir(),'notify-privacy-db-')),socket=fs.mkdtempSync(path.join(os.tmpdir(),'notify-privacy-sock-'));
 const run=(n,args)=>execFileSync(path.join(bin,n),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try{
  run('initdb',['-D',data,'-U','harness','--auth=trust','--no-sync']);
  run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'server.log'),'start']);
  pool=new Pool({host:socket,user:'harness',database:'postgres'});
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
   CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE,first_name text,role text DEFAULT 'member');
   INSERT INTO users(id,auth_id) VALUES(1,'better-auth-A'),(2,'better-auth-B'),(3,'better-auth-C');
   GRANT SELECT,INSERT,UPDATE ON users TO anon,authenticated;
   GRANT ALL ON users TO service_role;
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   CREATE POLICY "Users are viewable by everyone" ON users FOR SELECT TO public USING(true);
   CREATE POLICY "Users can update own profile" ON users FOR UPDATE TO public USING(true);
   CREATE POLICY users_insert_anon ON users FOR INSERT TO anon WITH CHECK(true);
   CREATE POLICY users_insert_authenticated ON users FOR INSERT TO authenticated WITH CHECK(true);
   CREATE TYPE entity_kind AS ENUM('post','comment','story','user','message','event','lynk_room');
   CREATE TYPE notification_kind AS ENUM('ticket_transfer_initiated','ticket_transfer_accepted','ticket_transfer_declined','ticket_transfer_cancelled','ticket_comped');
   CREATE TABLE notifications(id serial PRIMARY KEY,recipient_id integer NOT NULL REFERENCES users,actor_id integer REFERENCES users,type notification_kind NOT NULL,entity_type entity_kind,entity_id varchar,created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),entity_payload jsonb);
   INSERT INTO notifications(recipient_id,actor_id,type,entity_type,entity_id) VALUES(1,2,'ticket_transfer_initiated','event','80'),(2,1,'ticket_comped','event','80');
   ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
   GRANT SELECT,INSERT,UPDATE ON notifications TO anon,authenticated;
   GRANT USAGE,SELECT ON SEQUENCE notifications_id_seq TO anon,authenticated;
   GRANT ALL ON notifications TO service_role;GRANT USAGE,SELECT ON SEQUENCE notifications_id_seq TO service_role;
   CREATE POLICY "Users can view own notifications" ON notifications FOR SELECT TO public USING(true);
   CREATE POLICY "Notifications can be created" ON notifications FOR INSERT TO public WITH CHECK(true);
   CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE TO public USING(true);
  `);
  const as=async(role,claims,fn)=>{const c=await pool.connect();try{await c.query(`SET ROLE ${role}`);await c.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify(claims)]);return await fn(c);}finally{await c.query('RESET ROLE');c.release();}};
  const denied=async(c,sql,params=[])=>assert.rejects(c.query(sql,params),e=>e.code==='42501');
  await t.test('baseline exactly reproduces observed policy/grant weakness using synthetic accounts only',async()=>{
   await as('anon',{},async c=>{assert.equal((await c.query('SELECT * FROM notifications')).rowCount,2);assert.equal((await c.query("UPDATE notifications SET read_at=now() WHERE recipient_id=2")).rowCount,1);});
   await as('authenticated',{sub:'better-auth-A'},async c=>assert.equal((await c.query('SELECT * FROM notifications')).rowCount,2));
  });
  // Also prove explicit column grants cannot survive table-level cleanup.
  await pool.query('GRANT UPDATE(recipient_id,entity_payload), SELECT(entity_payload) ON notifications TO anon,authenticated');
  const draft=fs.readFileSync(path.resolve(__dirname,'../docs/security/notification-privacy-draft.sql'),'utf8');
  const prerequisite=fs.readFileSync(path.resolve(__dirname,'../docs/security/users-identity-write-prerequisite.sql'),'utf8');
  await t.test('policy refuses current writable identity mapping before notification grants change',async()=>{
   const c=await pool.connect();try{await assert.rejects(c.query(draft),/canonical user identity writes/);}finally{await c.query('ROLLBACK');c.release();}
  });
  await t.test('unique auth_id alone does not stop a client rewriting canonical ownership',async()=>{
   await as('authenticated',{sub:'better-auth-A'},async c=>{
    // Only synthetic rows: detach A, then claim B. Even a UNIQUE binding allows this.
    await c.query("UPDATE users SET auth_id='detached-A' WHERE id=1");
    await c.query("UPDATE users SET auth_id='better-auth-A' WHERE id=2");
    const r=await c.query("SELECT recipient_id FROM notifications WHERE recipient_id=(SELECT min(id) FROM users WHERE auth_id=auth.jwt()->>'sub' HAVING count(*)=1)");
    assert.deepEqual(r.rows,[{recipient_id:2}]);
   });
   await pool.query("UPDATE users SET auth_id='better-auth-B' WHERE id=2;UPDATE users SET auth_id='better-auth-A' WHERE id=1");
  });
  await t.test('identity prerequisite rejects unknown ALL policy without silently changing SELECT',async()=>{
   await pool.query('CREATE POLICY unexpected_all ON users FOR ALL TO authenticated USING(true) WITH CHECK(true)');
   const c=await pool.connect();try{await assert.rejects(c.query(prerequisite),/Review users ALL policies/);}finally{await c.query('ROLLBACK');c.release();}
   await pool.query('DROP POLICY unexpected_all ON users');
  });
  // Test surviving per-column and PUBLIC grants, not only table grants.
  await pool.query('GRANT UPDATE(auth_id,id,role),INSERT(auth_id,id),REFERENCES(auth_id) ON users TO PUBLIC,anon,authenticated');
  await pool.query(prerequisite);await pool.query(prerequisite);
  await t.test('all direct user identity/profile/role writes are denied but profile reads remain',async()=>{
   for(const role of ['anon','authenticated'])await as(role,{sub:'better-auth-A'},async c=>{
    assert.equal((await c.query('SELECT id,auth_id FROM users')).rowCount,3);
    for(const set of ["auth_id='stolen'","id=99","first_name='forged'","role='admin'"])await denied(c,`UPDATE users SET ${set} WHERE id=2`);
    await denied(c,"INSERT INTO users(id,auth_id) VALUES(99,'forged-login')");
    await denied(c,'DELETE FROM users WHERE id=3');
   });
  });
  await t.test('verified service profile updates and signup remain permitted after prerequisite',async()=>{
   await as('service_role',{},async c=>{
    assert.equal((await c.query("UPDATE users SET first_name='Updated' WHERE id=1 RETURNING id")).rowCount,1);
    assert.equal((await c.query("INSERT INTO users(id,auth_id,first_name) VALUES(4,'new-login','New') RETURNING id")).rowCount,1);
   });
  });
  await t.test('notification preflight also rejects column-only id update or auth_id insertion',async()=>{
   for(const grant of ['UPDATE(id)','INSERT(auth_id)']) {
    await pool.query(`GRANT ${grant} ON users TO authenticated`);
    const c=await pool.connect();try{await assert.rejects(c.query(draft),/canonical user identity writes/);}finally{await c.query('ROLLBACK');c.release();}
    await pool.query(`REVOKE ${grant} ON users FROM authenticated`);
   }
  });
  await pool.query(draft);await pool.query(draft);
  await t.test('anonymous access and direct notification creation/deletion are denied',async()=>{
   await as('anon',{},async c=>{await denied(c,'SELECT * FROM notifications');await denied(c,"SELECT nextval('notifications_id_seq')");await denied(c,'UPDATE notifications SET read_at=now()');await denied(c,"INSERT INTO notifications(recipient_id,type) VALUES(1,'ticket_comped')");});
   await as('authenticated',{sub:'better-auth-A'},async c=>{await denied(c,"INSERT INTO notifications(recipient_id,type) VALUES(1,'ticket_comped')");await denied(c,'DELETE FROM notifications WHERE recipient_id=1');});
  });
  await t.test('signed text subject reads only its canonical recipient and may mark own rows read',async()=>{
   await as('authenticated',{sub:'better-auth-A'},async c=>{
    const r=await c.query('SELECT * FROM notifications');assert.equal(r.rowCount,1);assert.equal(r.rows[0].recipient_id,1);
    assert.equal((await c.query('UPDATE notifications SET read_at=now() WHERE id=2')).rowCount,0);
    assert.equal((await c.query('UPDATE notifications SET read_at=now() WHERE recipient_id=1 RETURNING id')).rowCount,1);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL')).rows[0].n,0);
   });
  });
  await t.test('recipient/actor/payload forgery is forbidden even on an owned notification',async()=>{
   await as('authenticated',{sub:'better-auth-A'},async c=>{for(const set of ["recipient_id=2","actor_id=3","entity_payload='{}'::jsonb","type='ticket_comped'","created_at=now()"]){await denied(c,`UPDATE notifications SET ${set} WHERE recipient_id=1`);}});
  });
  await t.test('missing, unmapped and user_metadata-spoofed identities cannot read or update',async()=>{
   for(const claims of [{},{sub:'missing'},{user_metadata:{sub:'better-auth-A'}},{sub:'better-auth-C',user_metadata:{recipient_id:1}}])await as('authenticated',claims,async c=>{assert.equal((await c.query('SELECT * FROM notifications')).rowCount,0);assert.equal((await c.query('UPDATE notifications SET read_at=now()')).rowCount,0);});
  });
  await t.test('duplicate and blank canonical mappings fail closed even if a UNIQUE constraint is damaged',async()=>{
   await pool.query('ALTER TABLE users DROP CONSTRAINT users_auth_id_key');
   try {
    await pool.query("INSERT INTO users(id,auth_id) VALUES(5,'better-auth-A'),(6,'')");
    for(const sub of ['better-auth-A',''])await as('authenticated',{sub},async c=>{
     assert.equal((await c.query('SELECT * FROM notifications')).rowCount,0);
     assert.equal((await c.query('UPDATE notifications SET read_at=now()')).rowCount,0);
    });
   } finally {
    await pool.query('DELETE FROM users WHERE id IN (5,6);ALTER TABLE users ADD CONSTRAINT users_auth_id_key UNIQUE(auth_id)');
   }
  });
  await t.test('switching identities changes visibility; service emitters still insert nullable actors',async()=>{
   await as('authenticated',{sub:'better-auth-B'},async c=>{const r=await c.query('SELECT recipient_id FROM notifications');assert.deepEqual(r.rows,[{recipient_id:2}]);});
   await as('service_role',{},async c=>{assert.equal((await c.query("INSERT INTO notifications(recipient_id,actor_id,type,entity_type,entity_id) VALUES(1,NULL,'ticket_comped','event','80') RETURNING id")).rowCount,1);assert.equal((await c.query('SELECT * FROM notifications')).rowCount,3);});
  });
  await t.test('service null-only identity CAS has one concurrent winner and never rebinds established links',async()=>{
   // Real PostgreSQL predicate/concurrency evidence, not complete auth service E2E.
   await as('service_role',{},async c=>{
    await c.query("INSERT INTO users(id,auth_id) VALUES(10,NULL),(11,'established-account')");
   });
   const claimants=Array.from({length:8},(_,i)=>`synthetic-claimant-${i}`);
   let arrived=0,release;
   const barrier=new Promise(resolve=>{release=resolve;});
   const results=await Promise.all(claimants.map(authId=>as('service_role',{},async c=>{
    // All connections first observe the same unlinked row, as in the handler.
    const before=await c.query('SELECT auth_id FROM users WHERE id=10');
    assert.equal(before.rows[0].auth_id,null);
    if(++arrived===claimants.length)release();
    await barrier;
    const result=await c.query('UPDATE users SET auth_id=$1 WHERE id=10 AND auth_id IS NULL RETURNING id',[authId]);
    return {authId,count:result.rowCount};
   })));
   assert.equal(results.filter(result=>result.count===1).length,1);
   assert.equal(results.filter(result=>result.count===0).length,7);
   const winner=results.find(result=>result.count===1).authId;
   await as('service_role',{},async c=>{
    // Same-account retry loses the CAS but can confirm its own winning link.
    assert.equal((await c.query('UPDATE users SET auth_id=$1 WHERE id=10 AND auth_id IS NULL RETURNING id',[winner])).rowCount,0);
    assert.deepEqual((await c.query('SELECT id,auth_id FROM users WHERE id=10')).rows,[{id:10,auth_id:winner}]);
    for(const authId of claimants.filter(id=>id!==winner)) {
     assert.equal((await c.query('UPDATE users SET auth_id=$1 WHERE id=10 AND auth_id IS NULL RETURNING id',[authId])).rowCount,0);
     assert.notEqual((await c.query('SELECT auth_id FROM users WHERE id=10')).rows[0].auth_id,authId);
    }
    assert.equal((await c.query("UPDATE users SET auth_id='foreign-account' WHERE id=11 AND auth_id IS NULL RETURNING id")).rowCount,0);
    assert.deepEqual((await c.query('SELECT auth_id FROM users WHERE id=11')).rows,[{auth_id:'established-account'}]);
    assert.equal((await c.query('SELECT auth_id FROM users WHERE id=10')).rows[0].auth_id,winner);
   });
  });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}fs.rmSync(data,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true});}
});
