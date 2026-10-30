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
   CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE NOT NULL);
   INSERT INTO users VALUES(1,'better-auth-A'),(2,'better-auth-B'),(3,'better-auth-C');
   GRANT SELECT ON users TO authenticated;
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   CREATE POLICY profile_self ON users FOR SELECT TO authenticated USING(auth_id=auth.jwt()->>'sub');
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
  await t.test('policy refuses to trust a client-writable identity mapping',async()=>{
   await pool.query('GRANT UPDATE(auth_id) ON users TO authenticated');
   await assert.rejects(pool.query(draft),/canonical user identity writes/);
   // Draft begins a transaction, so failed preflight requires explicit rollback.
   await pool.query('ROLLBACK');
   await pool.query('REVOKE UPDATE(auth_id) ON users FROM authenticated');
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
  await t.test('switching identities changes visibility; service emitters still insert nullable actors',async()=>{
   await as('authenticated',{sub:'better-auth-B'},async c=>{const r=await c.query('SELECT recipient_id FROM notifications');assert.deepEqual(r.rows,[{recipient_id:2}]);});
   await as('service_role',{},async c=>{assert.equal((await c.query("INSERT INTO notifications(recipient_id,actor_id,type,entity_type,entity_id) VALUES(1,NULL,'ticket_comped','event','80') RETURNING id")).rowCount,1);assert.equal((await c.query('SELECT * FROM notifications')).rowCount,3);});
  });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}fs.rmSync(data,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true});}
});
