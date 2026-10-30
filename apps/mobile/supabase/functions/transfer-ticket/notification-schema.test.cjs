// Actual notification emitter against disposable PostgreSQL, never production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {execFileSync,spawnSync}=require('node:child_process');
const ts=require('typescript');
const {Pool}=require('pg');
function bins(){for(const dir of [process.env.POSTGRES_BIN,'',...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined))if(['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0))return dir;throw Error('PostgreSQL server unavailable: notification SQL tests NOT RUN');}
test('actual transfer emitter obeys notification columns, enums, recipient foreign keys',{timeout:120000},async()=>{
 const bin=bins(),data=fs.mkdtempSync(path.join(os.tmpdir(),'notify-db-')),socket=fs.mkdtempSync(path.join(os.tmpdir(),'notify-sock-'));
 const run=(n,args)=>execFileSync(path.join(bin,n),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try{
  run('initdb',['-D',data,'-U','harness','--auth=trust','--no-sync']);
  run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'server.log'),'start']);
  pool=new Pool({host:socket,user:'harness',database:'postgres'});
  await pool.query(`CREATE ROLE authenticated;
   CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3);
   CREATE TYPE entity_kind AS ENUM('post','comment','story','user','message','event','lynk_room');
   CREATE TYPE notification_kind AS ENUM('ticket_transfer_initiated','ticket_transfer_accepted','ticket_transfer_declined','ticket_transfer_cancelled');
   CREATE TABLE notifications(id serial PRIMARY KEY,recipient_id integer NOT NULL REFERENCES users,actor_id integer REFERENCES users,type notification_kind NOT NULL,entity_type entity_kind,entity_id varchar,entity_payload jsonb);
   ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
   GRANT SELECT ON notifications TO authenticated;
   -- Mirrors current permissive production policy; NOT evidence of recipient isolation.
   CREATE POLICY current_select ON notifications FOR SELECT TO authenticated USING(true);`);
  const warnings=[];let notify;
  const source=fs.readFileSync(path.join(__dirname,'index.ts'),'utf8')+'\nexports.testNotify=notifyTransfer;';
  const exported={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
   exports:exported,Deno:{env:{get:()=>''},serve(){}},console:{warn:(...a)=>warnings.push(a)},
   require:()=>({}),fetch:()=>{throw Error('network forbidden');},
  });notify=exported.testNotify;
  const db={from(table){if(table==='tickets')return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{event_id:80}})};
   if(table==='push_tokens')return {select(){return this;},eq:async()=>({data:[]})};
   assert.equal(table,'notifications');return {insert:async row=>{try{const keys=Object.keys(row);await pool.query(`INSERT INTO notifications (${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));return {error:null};}catch(error){return {error};}}};}};
  for(const type of ['initiated','accepted','declined','cancelled'])await notify(db,{recipientIntId:2,senderIntId:1,senderUsername:'sender',senderAvatar:null,title:'Transfer',body:'Ticket updated',notificationType:`ticket_transfer_${type}`,entityId:'transfer-a',ticketId:'ticket-a'});
  assert.deepEqual(warnings,[]);
  const rows=(await pool.query('SELECT * FROM notifications')).rows;
  assert.equal(rows.length,4);assert.ok(rows.every(r=>r.actor_id===1&&r.recipient_id===2&&r.entity_type==='event'&&r.entity_id==='80'&&r.entity_payload.transfer_id==='transfer-a'));
  await notify(db,{recipientIntId:999,senderIntId:1,notificationType:'ticket_transfer_initiated',entityId:'x',ticketId:'x'});
  assert.equal(warnings.length,1);assert.equal(warnings[0][1],'23503');
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','stop']);}catch{}fs.rmSync(data,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true});}
});
