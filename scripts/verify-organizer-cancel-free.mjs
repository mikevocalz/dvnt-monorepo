#!/usr/bin/env node
/** Runs organizer free-ticket cancellation and race checks against disposable Postgres.
 * Missing Postgres is a failure. Never connects to a user's production database. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const root=join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS=join(root,'apps/mobile/supabase/migrations');
const allowSkip=false;
function serverBin() {
  const candidates = [
    "",
    ...[18, 17, 16, 15, 14].flatMap((v) => [
      `/opt/homebrew/opt/postgresql@${v}/bin/`,
      `/usr/lib/postgresql/${v}/bin/`,
      `/usr/local/opt/postgresql@${v}/bin/`,
    ]),
  ];
  for (const prefix of candidates) {
    const versions = ["initdb", "postgres", "pg_ctl"].map((bin) => {
      const probe = spawnSync(`${prefix}${bin}`, ["--version"], { encoding: "utf8" });
      return probe.status === 0 ? (probe.stdout.match(/\s(\d+)\./)?.[1] ?? null) : null;
    });
    if (versions.every((v) => v !== null && v === versions[0])) return prefix;
  }
  return null;
}

const prefix = serverBin();
if (prefix === null) {
  const message =
    "verify-organizer-cancel-free: no complete Postgres server install found. " +
    "The financials assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres. This check fails closed when the server is unavailable.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-organizer-cancel-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-organizer-cancel-sock-"));
const run = (bin, args) =>
  execFileSync(`${prefix}${bin}`, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let pool;
function teardown() {
  try {
    run("pg_ctl", ["-D", dataDir, "-m", "immediate", "stop"]);
  } catch {}
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}
process.on("exit", teardown);

run("initdb", ["-D", dataDir, "-U", "harness", "--auth=trust", "--no-sync"]);
run("pg_ctl", [
  "-D", dataDir,
  "-o", `-k ${socketDir} -c listen_addresses='' -c fsync=off -c full_page_writes=off`,
  "-w", "-l", join(dataDir, "server.log"),
  "start",
]);

pool = new pg.Pool({ host: socketDir, user: "harness", database: "postgres", max: 4 });
const sql = async (text, values) => (await pool.query(text, values)).rows;

await sql(`
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE TABLE events(id integer PRIMARY KEY,host_id text,total_attendees integer DEFAULT 0);
CREATE TABLE ticket_types(id uuid PRIMARY KEY,event_id integer,quantity_sold integer);
CREATE TABLE orders(id uuid PRIMARY KEY,user_id text,event_id integer,type text,status text,total_cents integer,subtotal_cents integer,
stripe_payment_intent_id text,stripe_checkout_session_id text,cart_id uuid,promo_code_id uuid,discount_cents integer);
CREATE TABLE tickets(id uuid PRIMARY KEY,event_id integer,ticket_type_id uuid,user_id text,status text,category text,
purchase_amount_cents integer,checked_in_at timestamptz,checked_in_by text,transferred_from text,cart_id uuid,cart_line_item_id uuid,
stripe_payment_intent_id text,stripe_checkout_session_id text,order_id uuid,guest_email text,guest_phone text,guest_phone_e164 text,
guest_lookup_token text,claimed_by text,claimed_at timestamptz,wallet_voided_at timestamptz,wallet_last_pushed_at timestamptz,updated_at timestamptz,qr_token text);
CREATE TABLE ticket_transfers(id uuid PRIMARY KEY,ticket_id uuid,status text,from_user_id text,to_user_id text,expires_at timestamptz,resolved_at timestamptz);
CREATE TABLE checkins(ticket_id uuid NOT NULL,event_id integer,scanned_by text,device_id text,result text,offline boolean);
ALTER TABLE tickets ADD COLUMN qr_payload text,ADD COLUMN attendee_name text,ADD COLUMN guest_name text,ADD COLUMN wallet_serial_number text,ADD COLUMN wallet_auth_token text,ADD COLUMN wallet_pass_type_id text;
CREATE TABLE event_rsvps(event_id integer,user_id text,status text);
`);
await sql(readFileSync(join(MIGRATIONS,'20261030043000_organizer_cancel_free_ticket.sql'),'utf8'));
// Execute repository migrations, not reconstructed scanner/attendance logic.
for (const name of ['20260806100200_door_single_checkin_cas.sql',
 '20261006225000_public_event_people_going.sql','20261027212100_atomic_ticket_transfer_acceptance.sql'])
 await sql(readFileSync(join(MIGRATIONS,name),'utf8'));
let passed=0;
async function check(name,fn){await fn(); passed++; console.log(`PASS ${name}`);}
async function fixture(){
 const id=randomUUID(), tier=randomUUID(),order=randomUUID();
 await sql(`TRUNCATE organizer_free_ticket_cancellations,checkins,ticket_transfers,event_rsvps,tickets,orders,ticket_types,events CASCADE`);
 await sql(`INSERT INTO events(id,host_id) VALUES(1,'host'),(2,'other'); INSERT INTO event_rsvps VALUES(1,'holder','going')`);
 await sql(`INSERT INTO ticket_types VALUES($1,1,1)`,[tier]);
 await sql(`INSERT INTO orders(id,user_id,event_id,type,status,total_cents,subtotal_cents) VALUES($1,'holder',1,'event_ticket','paid',0,0)`,[order]);
 await sql(`INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,category,purchase_amount_cents,order_id,qr_token) VALUES($1,1,$2,'holder','active','admission',0,$3,'old-qr')`,[id,tier,order]);
 return {id,tier,order};
}
async function cancel(f,over={}){const a={event:1,actor:'host',owner:'holder',reason:'Wrong city sent',...over};return (await sql(`SELECT organizer_cancel_free_ticket($1,$2,$3,$4,$5) AS r`,[f.id,a.event,a.actor,a.owner,a.reason]))[0].r;}
await check('void, wallet invalidation, seat and RSVP commit once; same-request replay is idempotent',async()=>{
 const f=await fixture(); assert.equal((await cancel(f)).changed,true); assert.equal((await cancel(f)).changed,false);
 const [t]=await sql(`SELECT * FROM tickets`);assert.equal(t.status,'void');assert.ok(t.wallet_voided_at);assert.equal(t.qr_token,'old-qr');
 assert.equal((await sql(`SELECT quantity_sold FROM ticket_types`))[0].quantity_sold,0);
 assert.equal((await sql(`SELECT status FROM event_rsvps`))[0].status,'not_going');assert.equal((await sql(`SELECT total_attendees FROM events WHERE id=1`))[0].total_attendees,0);
 assert.equal((await sql(`SELECT count(*)::int n FROM organizer_free_ticket_cancellations`))[0].n,1);
 assert.equal((await cancel(f,{reason:'Different reason'})).error,'cancellation_conflict');
 assert.equal((await sql(`SELECT status FROM orders`))[0].status,'paid');
});
for(const [name,patch] of Object.entries({paid:'purchase_amount_cents=1',unknown:'purchase_amount_cents=NULL',used:"status='scanned'",scanTimestamp:'checked_in_at=now()',scanner:"checked_in_by='door'",transferred:"transferred_from='previous'",pending:"status='transfer_pending'",guest:"guest_email='synthetic@example.invalid'",claimed:"claimed_by='holder'",noOrder:'order_id=NULL',addon:"category='addon'",cart:'cart_id=gen_random_uuid()',stripe:"stripe_payment_intent_id='pi_test'"})){
 await check(`reject ${name} without mutation`,async()=>{const f=await fixture();await sql(`UPDATE tickets SET ${patch}`);assert.equal((await cancel(f)).ok,false);assert.equal((await sql(`SELECT count(*)::int n FROM organizer_free_ticket_cancellations`))[0].n,0);assert.equal((await sql(`SELECT quantity_sold FROM ticket_types`))[0].quantity_sold,1);});
}
for(const patch of ["total_cents=1","subtotal_cents=1","total_cents=NULL","status='pending'","user_id='someone-else'","event_id=2","stripe_payment_intent_id='pi_test'","stripe_checkout_session_id='cs_test'","cart_id=gen_random_uuid()","promo_code_id=gen_random_uuid()","discount_cents=1"]){await check(`reject order ${patch}`,async()=>{const f=await fixture();await sql(`UPDATE orders SET ${patch}`);assert.equal((await cancel(f)).ok,false);});}
await check('wrong host, event, holder and invalid reason fail closed',async()=>{const f=await fixture();for(const over of [{actor:'other'},{event:2},{owner:'changed'},{reason:''},{reason:'a'.repeat(501)}])assert.equal((await cancel(f,over)).ok,false);});
await check('pending transfer record and inconsistent inventory blocked',async()=>{const f=await fixture();await sql(`INSERT INTO ticket_transfers(id,ticket_id,status) VALUES(gen_random_uuid(),$1,'pending')`,[f.id]);assert.equal((await cancel(f)).ok,false);await sql(`DELETE FROM ticket_transfers; UPDATE ticket_types SET quantity_sold=0`);assert.equal((await cancel(f)).error,'inventory_inconsistent');});
await check('parallel duplicate cancellation releases one seat',async()=>{const f=await fixture();const r=await Promise.all([cancel(f),cancel(f)]);assert.equal(r.filter(x=>x.changed).length,1);assert.ok(r.every(x=>x.ok));});
await check('scanner taking row lock first wins; cancellation cannot void checked-in ticket',async()=>{
 const f=await fixture(),c=await pool.connect();try{await c.query('BEGIN');assert.equal((await c.query(`SELECT redeem_ticket('old-qr',1,'door',NULL,false) AS r`)).rows[0].r.result,'valid');const pending=cancel(f);await new Promise(r=>setTimeout(r,100));await c.query('COMMIT');assert.equal((await pending).ok,false);assert.equal((await sql(`SELECT status FROM tickets`))[0].status,'scanned');}finally{await c.query('ROLLBACK');c.release();}
});
await check('transfer CAS taking row lock first wins; cancellation cannot revoke pending transfer',async()=>{
 const f=await fixture(),c=await pool.connect();try{await c.query('BEGIN');await c.query(`UPDATE tickets SET status='transfer_pending' WHERE id=$1 AND status='active'`,[f.id]);const pending=cancel(f);await new Promise(r=>setTimeout(r,100));await c.query('COMMIT');assert.equal((await pending).ok,false);assert.equal((await sql(`SELECT status FROM tickets`))[0].status,'transfer_pending');}finally{await c.query('ROLLBACK');c.release();}
});
await check('downstream write failure rolls back audit, status and inventory together',async()=>{
 const f=await fixture();await sql(`CREATE FUNCTION reject_rsvp_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER reject_rsvp_test BEFORE UPDATE ON event_rsvps FOR EACH ROW EXECUTE FUNCTION reject_rsvp_test()`);
 try{await assert.rejects(cancel(f),/synthetic failure/);assert.equal((await sql(`SELECT status FROM tickets`))[0].status,'active');assert.equal((await sql(`SELECT quantity_sold FROM ticket_types`))[0].quantity_sold,1);assert.equal((await sql(`SELECT count(*)::int n FROM organizer_free_ticket_cancellations`))[0].n,0);}finally{await sql(`DROP TRIGGER reject_rsvp_test ON event_rsvps; DROP FUNCTION reject_rsvp_test()`);}
});
await check('cancellation first prevents scanner and transfer CAS from resurrecting QR',async()=>{
 const f=await fixture();await cancel(f);assert.equal((await sql(`SELECT redeem_ticket('old-qr',1,'door',NULL,false) AS r`))[0].r.result,'invalid');assert.equal((await sql(`SELECT result FROM checkins`))[0].result,'invalid');for(const status of ['scanned','transfer_pending']){const result=await pool.query(`UPDATE tickets SET status=$1 WHERE id=$2 AND status='active' AND checked_in_at IS NULL RETURNING id`,[status,f.id]);assert.equal(result.rowCount,0);}assert.equal((await sql(`SELECT status FROM tickets WHERE qr_token='old-qr'`))[0].status,'void');
});
await check('real acceptance RPC cannot change cancelled credential; accepted transfer is blocked',async()=>{
 const f=await fixture(),transfer=randomUUID();await sql(`UPDATE tickets SET status='transfer_pending'`);await sql(`INSERT INTO ticket_transfers(id,ticket_id,status,from_user_id,to_user_id,expires_at) VALUES($1,$2,'pending','holder','recipient',now()+interval '1 day')`,[transfer,f.id]);
 const r=(await sql(`SELECT accept_ticket_transfer_atomic($1,'recipient',1,$2,'payload') AS r`,[transfer,'a'.repeat(64)]))[0].r;assert.equal(r.ok,true);assert.equal((await cancel(f,{owner:'recipient'})).ok,false);
 const g=await fixture();await cancel(g);const phantom=randomUUID();await sql(`INSERT INTO ticket_transfers(id,ticket_id,status,from_user_id,to_user_id,expires_at) VALUES($1,$2,'pending','holder','recipient',now()+interval '1 day')`,[phantom,g.id]);
 assert.equal((await sql(`SELECT accept_ticket_transfer_atomic($1,'recipient',1,$2,'payload') AS r`,[phantom,'b'.repeat(64)]))[0].r.ok,false);assert.equal((await sql(`SELECT status FROM tickets`))[0].status,'void');
});
await check('remaining valid ticket preserves RSVP',async()=>{const f=await fixture();await sql(`INSERT INTO tickets(id,event_id,user_id,status) VALUES(gen_random_uuid(),1,'holder','active')`);await cancel(f);assert.equal((await sql(`SELECT status FROM event_rsvps`))[0].status,'going');});
await check('public API roles cannot execute RPC or rewrite audit',async()=>{for(const role of ['anon','authenticated']){const [r]=await sql(`SELECT has_function_privilege($1,'public.organizer_cancel_free_ticket(uuid,integer,text,text,text)','EXECUTE') AS execute,has_table_privilege($1,'public.organizer_free_ticket_cancellations','INSERT,UPDATE,DELETE') AS write`,[role]);assert.equal(r.execute,false);assert.equal(r.write,false);}const [r]=await sql(`SELECT has_table_privilege('service_role','public.organizer_free_ticket_cancellations','INSERT,UPDATE,DELETE') AS write`);assert.equal(r.write,false);});
console.log(`${passed} organizer cancellation PostgreSQL checks passed`);
await pool.end();
