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
const acceptanceMigration = () => readFileSync(path.join(migrations, '20261027212100_atomic_ticket_transfer_acceptance.sql'), 'utf8');
function serverBin() {
  for (const dir of [process.env.POSTGRES_BIN, '', ...[18,17,16,15,14].map(v=>`/usr/lib/postgresql/${v}/bin`)].filter(x=>x!==undefined)) {
    if (['initdb','pg_ctl','postgres'].every(n=>spawnSync(path.join(dir,n),['--version']).status===0)) return dir;
  }
  throw Error('No complete PostgreSQL server; comp quantity SQL/concurrency tests did NOT run. Set POSTGRES_BIN.');
}
const schema = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE events(id serial PRIMARY KEY,host_id text,status text,date timestamptz,start_date timestamptz,end_date timestamptz);
CREATE TABLE users(id serial PRIMARY KEY,auth_id text UNIQUE,username varchar UNIQUE);
CREATE TABLE "user"(id text PRIMARY KEY,username text,email text,"emailVerified" boolean DEFAULT false);
CREATE TABLE event_co_organizers(event_id integer,user_id text,role text,accepted boolean);
CREATE TABLE ticket_types(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events,quantity_total integer,quantity_sold integer DEFAULT 0,is_active boolean DEFAULT true,category text);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),type text,status text,currency text,subtotal_cents integer,total_cents integer,event_id integer,quantity integer,user_id text,guest_email text,paid_at timestamptz);
CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events,ticket_type_id uuid REFERENCES ticket_types,status text DEFAULT 'active',user_id text,guest_email text,guest_lookup_token text,purchase_amount_cents integer,category text,qr_token text UNIQUE NOT NULL,qr_payload text,checked_in_at timestamptz,checked_in_by text,transferred_from text,attendee_name text,guest_name text,guest_phone text,wallet_serial_number text,wallet_auth_token text,wallet_pass_type_id text,wallet_voided_at timestamptz,wallet_last_pushed_at timestamptz,order_id uuid REFERENCES orders,order_index integer,order_count integer,CONSTRAINT tickets_user_or_guest CHECK(user_id IS NOT NULL OR guest_email IS NOT NULL));
CREATE TABLE checkins(id serial PRIMARY KEY,ticket_id uuid REFERENCES tickets,event_id integer NOT NULL REFERENCES events,scanned_by text,device_id text,result text CHECK(result IN ('valid','already_scanned','refunded','wrong_event','invalid')),offline boolean);
CREATE TABLE ticket_transfers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid REFERENCES tickets,from_user_id text,to_user_id text,status text DEFAULT 'pending',expires_at timestamptz,resolved_at timestamptz);
CREATE TABLE cart_holds(tier_id uuid,qty integer,released boolean DEFAULT false,expires_at timestamptz);
CREATE TABLE ticket_holds(ticket_type_id uuid,quantity integer,status text,expires_at timestamptz);
INSERT INTO users(auth_id) VALUES('member'),('other'),('recipient');
`;

test('durable future receipts execute in disposable PostgreSQL', {timeout:120000}, async t=>{
 const bin=serverBin(),data=mkdtempSync(path.join(tmpdir(),'dvnt-receipts-')),socket=mkdtempSync(path.join(tmpdir(),'dvnt-receipts-sock-'));
 const run=(n,a)=>execFileSync(path.join(bin,n),a,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try {
 const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];if(process.env.POSTGRES_SHARE)args.push('-L',process.env.POSTGRES_SHARE);run('initdb',args);
 run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'log'),'start']);
 pool=new Pool({host:socket,user:'harness',database:'postgres',max:12});await pool.query(schema);
 for(const file of ['20261002190000_phone_comp_claim_links.sql','20261027212000_three_comp_tickets.sql','20261027212100_atomic_ticket_transfer_acceptance.sql','20261030215857_durable_ticket_receipts.sql'])await pool.query(readFileSync(path.join(migrations,file),'utf8'));
 await pool.query(`INSERT INTO "user"(id,email,"emailVerified") VALUES('member','member@example.test',true),('recipient','recipient@example.test',true)`);
 const make=async()=>{const e=(await pool.query("INSERT INTO events(host_id,status,start_date) VALUES('host','published',now()+interval '2 days') RETURNING id")).rows[0];const tier=(await pool.query('INSERT INTO ticket_types(event_id,quantity_total) VALUES($1,100) RETURNING id',[e.id])).rows[0];return {event:e.id,tier:tier.id};};
 const issue=(ev,kind='member',quantity=3,legacy=false)=>pool.query(`SELECT ${kind==='member'?(legacy?'issue_comp_tickets_atomic':'issue_comp_tickets_with_receipts'):'issue_guest_comp_tickets_with_receipts'}($1,$2,'host',$3::text[],$4) r`,[ev.event,ev.tier,[kind==='member'?'member':'guest@example.test'],quantity]).then(r=>r.rows[0].r);
 const claim=ids=>pool.query('SELECT * FROM claim_ticket_receipts(100,$1::uuid[])',[ids]).then(r=>r.rows);
 const complete=(r,outcome='sent',id='provider-test')=>pool.query('SELECT complete_ticket_receipt($1,$2,$3,$4,NULL) ok',[r.id,r.lease_token,outcome,id]).then(r=>r.rows[0].ok);
 await t.test('legacy issuance and migration never enqueue history; future groups include exact 1–3 tickets',async()=>{
 const old=await make();await issue(old,'member',3,true);assert.equal((await issue(old)).receipt_ids.length,0);
 for(const kind of ['member','guest'])for(const q of [1,2,3]){const ev=await make(),r=await issue(ev,kind,q);assert.equal(r.receipt_ids.length,1);const row=(await pool.query('SELECT * FROM ticket_receipt_outbox WHERE id=$1',r.receipt_ids)).rows[0];assert.equal(row.ticket_ids.length,q);assert.deepEqual([...row.ticket_ids].sort(),r.tickets.map(x=>x.id).sort());assert.deepEqual((await issue(ev,kind,q)).receipt_ids,[]);}
 });
 await t.test('concurrent wrappers mint one group and lease it once',async()=>{
 const ev=await make();const results=await Promise.all(Array.from({length:8},()=>issue(ev)));const ids=[...new Set(results.flatMap(x=>x.receipt_ids))];assert.equal(ids.length,1);assert.equal(results.reduce((s,r)=>s+r.tickets.length,0),3);
 const leased=await Promise.all(Array.from({length:8},()=>claim(ids)));assert.equal(leased.flat().length,1);
 });
 await t.test('payload freezes verified destination, bundle and full body; stale lease cannot finish',async()=>{
 const r=(await claim((await issue(await make())).receipt_ids))[0];const payload={to:'member@example.test',from:'DVNT <tickets@example.test>',subject:'Receipt',html:'<p>Receipt</p>',ticket_ids:r.ticket_ids};
 const prep=p=>pool.query('SELECT prepare_ticket_receipt($1,$2,$3::jsonb) r',[r.id,r.lease_token,JSON.stringify(p)]).then(x=>x.rows[0].r);
 assert.equal((await prep({...payload,to:'wrong@example.test'})).ok,false);assert.equal((await prep({...payload,ticket_ids:[]})).ok,false);assert.equal((await prep(payload)).ok,true);assert.deepEqual((await prep({...payload,subject:'Changed'})).payload,payload);
 assert.equal(await complete({...r,lease_token:require('node:crypto').randomUUID()}),false);assert.equal(await complete(r,'sent',null),false);assert.equal(await complete(r),true);assert.equal(await complete(r),false);
 });
 await t.test('23-hour boundary and exhausted attempts cannot re-send; expired leases reuse frozen payload',async()=>{
 const ids=(await issue(await make())).receipt_ids;let r=(await claim(ids))[0];await pool.query("UPDATE ticket_receipt_outbox SET leased_until=now()-interval '1 minute' WHERE id=$1",ids);const retry=(await claim(ids))[0];assert.notEqual(retry.lease_token,r.lease_token);assert.equal(retry.attempts,2);assert.equal(await complete(r),false);
 await pool.query("UPDATE ticket_receipt_outbox SET leased_until=now()-interval '1 minute',delivery_deadline=now()-interval '1 minute' WHERE id=$1",ids);assert.equal((await claim(ids)).length,0);assert.equal((await pool.query('SELECT state FROM ticket_receipt_outbox WHERE id=$1',ids)).rows[0].state,'suppressed');
 const capped=(await issue(await make())).receipt_ids;await pool.query('UPDATE ticket_receipt_outbox SET attempts=8 WHERE id=$1',capped);assert.equal((await claim(capped)).length,0);
 });
 await t.test('failed send retries preserve exact provider payload; unverified email cannot prepare',async()=>{
 const ids=(await issue(await make())).receipt_ids;const r=(await claim(ids))[0];const payload={to:'member@example.test',from:'DVNT <tickets@example.test>',subject:'Receipt',html:'<p>Stable</p>',ticket_ids:r.ticket_ids};
 await pool.query(`UPDATE "user" SET "emailVerified"=false WHERE id='member'`);
 let prepared=(await pool.query('SELECT prepare_ticket_receipt($1,$2,$3) r',[r.id,r.lease_token,JSON.stringify(payload)])).rows[0].r;assert.equal(prepared.ok,false);
 await pool.query(`UPDATE "user" SET "emailVerified"=true WHERE id='member'`);
 prepared=(await pool.query('SELECT prepare_ticket_receipt($1,$2,$3) r',[r.id,r.lease_token,JSON.stringify(payload)])).rows[0].r;assert.equal(prepared.ok,true);
 assert.equal(await complete(r,'retry',null),true);assert.equal((await claim(ids)).length,0);
 await pool.query("UPDATE ticket_receipt_outbox SET available_at=now()-interval '1 minute' WHERE id=$1",ids);const retry=(await claim(ids))[0];assert.deepEqual(retry.provider_payload,payload);assert.equal(retry.first_attempt_at.getTime(),r.first_attempt_at.getTime());assert.equal(await complete(retry),true);
 });
 await t.test('phone claim queues once without inventing an order, replay is stable',async()=>{
 const ev=await make();const issued=(await pool.query("SELECT issue_guest_phone_comp_tickets_atomic($1,$2,'host',ARRAY['+14155550123'],2) r",[ev.event,ev.tier])).rows[0].r;
 const call=()=>pool.query("SELECT claim_comp_ticket_with_receipt($1,'member') r",[issued.links[0].token]).then(x=>x.rows[0].r);
 const r=await call();assert.equal(r.receipt_ids.length,1);assert.deepEqual((await call()).receipt_ids,r.receipt_ids);assert.equal((await pool.query('SELECT order_id FROM tickets WHERE id=$1',[r.ticket_id])).rows[0].order_id,null);
 });
 await t.test('transfer queues new owner exact ticket, refusal does not queue',async()=>{
 const ev=await make(),r=await issue(ev);const ticket=r.tickets[0].id;await pool.query("UPDATE tickets SET status='transfer_pending' WHERE id=$1",[ticket]);const tr=(await pool.query("INSERT INTO ticket_transfers(ticket_id,from_user_id,to_user_id,expires_at) VALUES($1,'member','recipient',now()+interval '1 day') RETURNING id",[ticket])).rows[0];
 const accept=()=>pool.query("SELECT accept_ticket_transfer_with_receipt($1,'recipient',$2,$3,'signed') r",[tr.id,ev.event,'a'.repeat(64)]).then(x=>x.rows[0].r);const accepted=await accept();assert.equal(accepted.receipt_ids.length,1);assert.equal((await accept()).ok,false);const receipt=(await pool.query('SELECT * FROM ticket_receipt_outbox WHERE id=$1',accepted.receipt_ids)).rows[0];assert.equal(receipt.recipient_auth_id,'recipient');assert.deepEqual(receipt.ticket_ids,[ticket]);
 });
 await t.test('enqueue failure rolls issuance back and API roles cannot access queue/functions',async()=>{
 await pool.query(`CREATE FUNCTION fixture_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt failure';END $$;CREATE TRIGGER fixture_fail_receipt BEFORE INSERT ON ticket_receipt_outbox FOR EACH ROW EXECUTE FUNCTION fixture_fail_receipt();`);
 const ev=await make();try{await assert.rejects(issue(ev),/receipt failure/);}finally{await pool.query('DROP TRIGGER fixture_fail_receipt ON ticket_receipt_outbox;DROP FUNCTION fixture_fail_receipt()');}assert.equal((await pool.query('SELECT count(*)::int n FROM tickets WHERE event_id=$1',[ev.event])).rows[0].n,0);
 for(const role of ['anon','authenticated']){assert.equal((await pool.query("SELECT has_table_privilege($1,'ticket_receipt_outbox','SELECT') ok",[role])).rows[0].ok,false);for(const sig of ['claim_ticket_receipts(integer,uuid[])','prepare_ticket_receipt(uuid,uuid,jsonb)','complete_ticket_receipt(uuid,uuid,text,text,text)','issue_comp_tickets_with_receipts(integer,uuid,text,text[],integer)','claim_comp_ticket_with_receipt(text,text)'])assert.equal((await pool.query("SELECT has_function_privilege($1,$2,'EXECUTE') ok",[role,sig])).rows[0].ok,false);}
 });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
