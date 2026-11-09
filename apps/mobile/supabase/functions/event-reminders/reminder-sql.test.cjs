// Real, disposable, socket-only PostgreSQL; never uses an external database.
// NODE_PATH=<deps>/node_modules POSTGRES_BIN=<local server bin> node --test <this file>
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, existsSync } = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Pool } = require('pg');
const migrations = path.resolve(__dirname, '../../migrations');
function serverBin() {
  for (const dir of [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)) {
    if (['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0)) return dir;
  }
  throw Error('No complete PostgreSQL server; event reminder SQL/concurrency tests did NOT run. Set POSTGRES_BIN.');
}
const schema=`
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE TABLE events(id serial PRIMARY KEY,status text,start_date timestamptz,reminder_sent_at timestamptz);
CREATE TABLE "user"(id text PRIMARY KEY,email text,"emailVerified" boolean DEFAULT false);
CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events,status text DEFAULT 'active',user_id text,guest_email text,guest_lookup_token text,guest_lookup_expires_at timestamptz,reminder_sent_at timestamptz);
INSERT INTO "user" VALUES('member','member@example.test',true),('other','other@example.test',true),('unverified','unverified@example.test',false);
`;
test('durable reminders run in isolated real PostgreSQL, never external DB', {timeout:120000},async t=>{
 const bin=serverBin(),data=mkdtempSync(path.join(tmpdir(),'dvnt-reminders-')),socket=mkdtempSync(path.join(tmpdir(),'dvnt-reminders-sock-'));
 const run=(n,a)=>execFileSync(path.join(bin,n),a,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try {
 const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];if(process.env.POSTGRES_SHARE)args.push('-L',process.env.POSTGRES_SHARE);run('initdb',args);
 run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'log'),'start']);pool=new Pool({host:socket,user:'harness',database:'postgres',max:12});await pool.query(schema);
 await pool.query(readFileSync(path.join(migrations,'20261031000336_durable_event_reminders.sql'),'utf8'));
 const make=async(minutes=180,status='published')=>(await pool.query("INSERT INTO events(status,start_date) VALUES($1,clock_timestamp()+make_interval(mins=>$2)) RETURNING id",[status,minutes])).rows[0].id;
 const mint=async(event,n=1,owner='member',status='active')=>(await pool.query('INSERT INTO tickets(event_id,user_id,status) SELECT $1,$2,$3 FROM generate_series(1,$4) RETURNING id',[event,owner,status,n])).rows.map(x=>x.id);
 const reserve=event=>pool.query('SELECT * FROM reserve_event_reminders($1)',[event]).then(r=>r.rows);
 const claim=ids=>pool.query('SELECT * FROM claim_event_reminders(100,$1::uuid[])',[ids]).then(r=>r.rows);
 const payload=r=>({to:r.guest_email||'member@example.test',from:'DVNT <tickets@example.test>',subject:'Reminder',html:'<p>Tickets</p>',ticket_ids:r.ticket_ids});
 const prep=(r,p=payload(r))=>pool.query('SELECT prepare_event_reminder($1,$2,$3::jsonb) r',[r.id,r.lease_token,JSON.stringify(p)]).then(x=>x.rows[0].r);
 const finish=(r,outcome='sent',provider='provider-test')=>pool.query('SELECT complete_event_reminder($1,$2,$3,$4,NULL) r',[r.id,r.lease_token,outcome,provider]).then(x=>x.rows[0].r);
 await t.test('completed event still discovers late ticket, never resets existing ticket flags',async()=>{
 const ev=await make();const [old]=await mint(ev);await pool.query("UPDATE events SET reminder_sent_at=now()-interval '10 minutes' WHERE id=$1",[ev]);await pool.query('UPDATE tickets SET reminder_sent_at=now() WHERE id=$1',[old]);const [late]=await mint(ev);const rows=await reserve(ev);assert.equal(rows.length,1);assert.deepEqual(rows[0].ticket_ids,[late]);assert.ok((await pool.query('SELECT reminder_sent_at FROM tickets WHERE id=$1',[old])).rows[0].reminder_sent_at);assert.deepEqual(await reserve(ev),[]);
 });
 await t.test('only original 150–210 minute window and noncancelled events; no catchup',async()=>{
 for(const [minutes,status] of [[149,'published'],[211,'published'],[180,'cancelled'],[180,'canceled'],[180,'deleted']]){const ev=await make(minutes,status);await mint(ev);assert.deepEqual(await reserve(ev),[]);}
 });
 await t.test('current member wins over stale guest address; no false sent for unverified or no address',async()=>{
 const ev=await make();const [id]=await mint(ev);await pool.query("UPDATE tickets SET guest_email='stale@example.test' WHERE id=$1",[id]);const invalid=await mint(ev,1,'unverified');await mint(ev,1,null);const rows=await reserve(ev);assert.equal(rows.length,1);assert.equal(rows[0].recipient_auth_id,'member');assert.equal(rows[0].guest_email,null);assert.deepEqual(rows[0].ticket_ids,[id]);assert.equal((await pool.query('SELECT reminder_sent_at FROM tickets WHERE id=$1',invalid)).rows[0].reminder_sent_at,null);
 await pool.query(`UPDATE "user" SET "emailVerified"=true WHERE id='unverified'`);assert.equal((await reserve(ev)).length,1);
 });
 await t.test('concurrent discovery and cron lease never overlap exact ticket bundles',async()=>{
 const ev=await make();await mint(ev,3);const groups=(await Promise.all(Array.from({length:8},()=>reserve(ev)))).flat();assert.equal(groups.length,1);assert.equal(groups[0].ticket_ids.length,3);const leases=(await Promise.all(Array.from({length:8},()=>claim([groups[0].id])))).flat();assert.equal(leases.length,1);assert.deepEqual(await claim([]),[]);
 });
 await t.test('more than 1000 tickets across batches reserve once, existing flags and invalid statuses excluded',async()=>{
 const ev=await make();await mint(ev,1003);const old=await mint(ev,2);await pool.query('UPDATE tickets SET reminder_sent_at=now() WHERE id=ANY($1::uuid[])',[old]);for(const status of ['refunded','void','transfer_pending','cancelled'])await mint(ev,1,'member',status);
 const ids=[];for(let i=0;i<20;i++){const batch=await reserve(ev);if(!batch.length)break;ids.push(...batch.flatMap(r=>r.ticket_ids));}assert.equal(ids.length,1003);assert.equal(new Set(ids).size,1003);assert.deepEqual(await reserve(ev),[]);
 });
 await t.test('no provider ID means no success; frozen body survives retry and stale lease cannot stamp',async()=>{
 const ev=await make();await mint(ev,2);const row=(await reserve(ev))[0];let r=(await claim([row.id]))[0];const body=payload(r);assert.equal((await prep(r,{...body,to:'wrong@example.test'})).ok,false);assert.equal((await prep(r)).ok,true);assert.deepEqual((await prep(r,{...body,html:'changed'})).payload,body);assert.equal(await finish(r,'sent',null),false);assert.equal((await pool.query('SELECT count(*)::int n FROM tickets WHERE event_id=$1 AND reminder_sent_at IS NOT NULL',[ev])).rows[0].n,0);assert.equal(await finish(r,'retry',null),true);await pool.query("UPDATE event_reminder_deliveries SET available_at=now()-interval '1 minute' WHERE id=$1",[r.id]);const retry=(await claim([r.id]))[0];assert.deepEqual(retry.provider_payload,body);assert.equal(await finish(r),false);assert.equal((await prep(retry)).ok,true);assert.equal(await finish(retry),true);assert.equal((await pool.query('SELECT count(*)::int n FROM tickets WHERE event_id=$1 AND reminder_sent_at IS NOT NULL',[ev])).rows[0].n,2);
 });
 await t.test('owner move, refund, cancellation and rotated guest access invalidate frozen retry',async()=>{
 for(const change of ['transfer','refund','cancel']){const ev=await make();const [id]=await mint(ev);const r=(await claim((await reserve(ev)).map(x=>x.id)))[0];assert.equal((await prep(r)).ok,true);if(change==='transfer')await pool.query("UPDATE tickets SET user_id='other' WHERE id=$1",[id]);if(change==='refund')await pool.query("UPDATE tickets SET status='refunded' WHERE id=$1",[id]);if(change==='cancel')await pool.query("UPDATE events SET status='cancelled' WHERE id=$1",[ev]);assert.equal((await prep(r)).ok,false);assert.equal(await finish(r,'suppressed',null),true);assert.equal((await pool.query('SELECT reminder_sent_at FROM tickets WHERE id=$1',[id])).rows[0].reminder_sent_at,null);}
 const ev=await make();const id=(await pool.query("INSERT INTO tickets(event_id,guest_email,guest_lookup_token) VALUES($1,'guest@example.test','initial-token') RETURNING id",[ev])).rows[0].id;const r=(await claim((await reserve(ev)).map(x=>x.id)))[0];const body={...payload(r),guest_lookup_tokens:['initial-token']};assert.equal((await prep(r,body)).ok,true);await pool.query("UPDATE tickets SET guest_lookup_token='rotated' WHERE id=$1",[id]);assert.equal((await prep(r,body)).ok,false);
 });
 await t.test('ownership changes during provider call never stamp the replacement owner',async()=>{
 const ev=await make();const [ticket]=await mint(ev);const r=(await claim((await reserve(ev)).map(x=>x.id)))[0];assert.equal((await prep(r)).ok,true);await pool.query("UPDATE tickets SET user_id='other' WHERE id=$1",[ticket]);assert.equal(await finish(r),true);const row=(await pool.query('SELECT reminder_sent_at FROM tickets WHERE id=$1',[ticket])).rows[0];assert.equal(row.reminder_sent_at,null);assert.deepEqual(await reserve(ev),[]);assert.equal((await pool.query('SELECT provider_message_id,state FROM event_reminder_deliveries WHERE id=$1',[r.id])).rows[0].state,'sent');
 });
 await t.test('rescheduled or elapsed window and attempt cap prevent delayed sends',async()=>{
 for(const kind of ['elapsed','rescheduled','attempts']){const ev=await make();await mint(ev);const row=(await reserve(ev))[0];if(kind==='attempts')await pool.query('UPDATE event_reminder_deliveries SET attempts=8 WHERE id=$1',[row.id]);else await pool.query('UPDATE events SET start_date=clock_timestamp()+make_interval(mins=>$2) WHERE id=$1',[ev,kind==='elapsed'?149:211]);assert.deepEqual(await claim([row.id]),[]);assert.equal((await pool.query('SELECT state FROM event_reminder_deliveries WHERE id=$1',[row.id])).rows[0].state,'suppressed');}
 });
 await t.test('expired backlog larger than cleanup page cannot starve later valid delivery',async()=>{
 const expiredEvent=await make(149);const [ticket]=await mint(expiredEvent);const old=(await pool.query("INSERT INTO event_reminder_deliveries(event_id,recipient_auth_id,ticket_ids,created_at) SELECT $1,'member',ARRAY[$2::uuid],now()-interval '1 hour' FROM generate_series(1,105) RETURNING id",[expiredEvent,ticket])).rows.map(r=>r.id);
 const ev=await make();await mint(ev);const valid=(await reserve(ev))[0];const rows=(await pool.query('SELECT * FROM claim_event_reminders(1,$1::uuid[])',[[...old,valid.id]])).rows;assert.equal(rows.length,1);assert.equal(rows[0].id,valid.id);
 });
 await t.test('reservation rolls back atomically and service-only functions cannot be called by API roles',async()=>{
 const ev=await make();await mint(ev);await pool.query(`CREATE FUNCTION fail_reserve() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reservation failed';END $$;CREATE TRIGGER fail_reserve BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION fail_reserve();`);try{await assert.rejects(reserve(ev),/reservation failed/);}finally{await pool.query('DROP TRIGGER fail_reserve ON tickets;DROP FUNCTION fail_reserve()');}assert.equal((await pool.query('SELECT count(*)::int n FROM event_reminder_deliveries WHERE event_id=$1',[ev])).rows[0].n,0);
 for(const role of ['anon','authenticated']){assert.equal((await pool.query("SELECT has_table_privilege($1,'event_reminder_deliveries','SELECT') r",[role])).rows[0].r,false);for(const sig of ['reserve_event_reminders(integer,integer)','claim_event_reminders(integer,uuid[])','prepare_event_reminder(uuid,uuid,jsonb)','complete_event_reminder(uuid,uuid,text,text,text)'])assert.equal((await pool.query("SELECT has_function_privilege($1,$2,'EXECUTE') r",[role,sig])).rows[0].r,false);}
 assert.equal((await pool.query("SELECT has_table_privilege('service_role','event_reminder_deliveries','UPDATE') r")).rows[0].r,false);
 });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
