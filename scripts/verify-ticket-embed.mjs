#!/usr/bin/env node
/** Runs the real embed RPCs and canonical inventory hold against disposable Postgres.
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
    "verify-ticket-embed: no complete Postgres server install found. " +
    "The financials assertions did NOT run.";
  if (allowSkip) {
    console.log(`SKIP: ${message}`);
    process.exit(0);
  }
  console.error(`${message}\nInstall Postgres, or pass --allow-skip to record this as unverified.`);
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "dvnt-ticket-embed-"));
const socketDir = mkdtempSync(join(tmpdir(), "dvnt-ticket-embed-sock-"));
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
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE public.events (
 id serial PRIMARY KEY,host_id text,visibility text,status text,ticketing_enabled boolean,
 is_hidden boolean,publish_at timestamptz,start_date timestamptz,end_date timestamptz,fee_mode text
);
CREATE TABLE public.ticket_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events(id),name text,price_cents integer,
 is_active boolean,status text,tier_visibility text,sale_start timestamptz,sale_end timestamptz,
 quantity_total integer,quantity_sold integer DEFAULT 0,max_per_user integer
);
CREATE TABLE public.organizer_accounts(host_id text PRIMARY KEY,stripe_account_id text,charges_enabled boolean);
CREATE TABLE public.orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,guest_email text,type text,status text,event_id integer REFERENCES events(id),
 quantity integer,currency text,subtotal_cents integer,total_cents integer,platform_fee_cents integer,
 buyer_pct_fee_cents integer,buyer_per_ticket_fee_cents integer,buyer_fee_cents integer,org_pct_fee_cents integer,
 org_per_ticket_fee_cents integer,organizer_fee_cents integer,dvnt_total_fee_cents integer,fee_policy_version text,
 stripe_checkout_session_id text UNIQUE
);
CREATE TABLE public.ticket_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id text,ticket_type_id uuid REFERENCES ticket_types(id),event_id integer,
 quantity integer,payment_intent_id text,status text CHECK(status IN ('active','converted','expired')),expires_at timestamptz,guest_email text,hold_kind text
);
CREATE TABLE public.cart_holds(tier_id uuid REFERENCES ticket_types(id),qty integer,released boolean,expires_at timestamptz);
CREATE TABLE public.tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_type_id uuid REFERENCES ticket_types(id),guest_email text,status text);
CREATE TABLE public.event_promoters(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer,code text,rev_share_bps integer,status text);
CREATE TABLE public.promoter_attributions(order_id uuid UNIQUE REFERENCES orders(id),promoter_id uuid,locked_rev_share_bps integer);
`);
const migration=(file)=>readFileSync(join(MIGRATIONS,file),'utf8');
await sql(migration('20260915172318_atomic_legacy_ticket_hold.sql'));
await sql(migration('20260919120000_promoter_code_v2.sql'));
await sql(migration('20261011204000_event_ticket_widgets.sql'));
await sql(migration('20261011233500_unified_ticket_embed_checkout.sql'));
await sql(migration('20261015190000_embed_cancel_hold_status.sql'));
console.log('PASS: real canonical hold, promoter attribution and embed migrations with hold-status repair applied');
const ORIGIN='https://events.example.com',PROOF='a'.repeat(64),REQUEST='b'.repeat(64);
const fees=(price,quantity=1)=>{
 const pct=Math.round(price*.025), per=quantity*100, fee=pct+per;
 return {subtotal:price,buyer_pct_fee:pct,buyer_per_ticket_fee:per,buyer_fee:fee,
 org_pct_fee:pct,org_per_ticket_fee:per,organizer_fee:fee,dvnt_total_fee:fee*2,
 application_fee_amount:fee*2,customer_charge_amount:price+fee,fee_policy_version:'v1_250_1pt',fee_mode:'pass'};
};
async function fixture(cap=20){
 const event=(await sql(`INSERT INTO events(host_id,visibility,status,ticketing_enabled,start_date,end_date,fee_mode)
 VALUES ('host','public','active',true,now()+interval '1 day',now()+interval '2 days','pass') RETURNING id`))[0];
 await sql(`INSERT INTO organizer_accounts VALUES('host','acct_fixture',true) ON CONFLICT(host_id) DO NOTHING`);
 const tier=(await sql(`INSERT INTO ticket_types(event_id,name,price_cents,is_active,status,tier_visibility,quantity_total,max_per_user)
 VALUES($1,'General admission',2500,true,'on_sale','public',$2,10) RETURNING id`,[event.id,cap]))[0];
 const embed=(await sql(`INSERT INTO event_ticket_widgets(event_id,allowed_origin,published,revision,updated_by)
 VALUES($1,$2,true,1,'host') RETURNING id`,[event.id,ORIGIN]))[0];
 const quote={eventId:event.id,revision:1,tierId:tier.id,quantity:1,email:'buyer@example.com',name:'Fixture buyer',attendeeNames:[],
  unitPrice:2500,requestedFeeMode:'pass',destination:'acct_fixture',fees:fees(2500),promoter:null,
  expiresAt:Math.floor(Date.now()/1000)+35*60};
 return {eventId:event.id,tierId:tier.id,embedId:embed.id,quote};
}
const prepare=async(f,id=randomUUID(),changes={},proof=PROOF,request=REQUEST)=>
 (await sql('SELECT ticket_embed_prepare_checkout($1,$2,$3,$4,$5,$6::jsonb) AS attempt',
 [id,f.embedId,ORIGIN,proof,request,JSON.stringify({...f.quote,...changes})]))[0].attempt;
const attach=async(a,session='cs_test_'+a.id.replaceAll('-',''))=>
 (await sql('SELECT ticket_embed_attach_session($1,$2) AS attempt',[a.id,session]))[0].attempt;
const counts=async(f)=>(await sql(`SELECT
 (SELECT count(*)::integer FROM orders WHERE event_id=$1) AS orders,
 (SELECT count(*)::integer FROM ticket_holds WHERE event_id=$1) AS holds,
 (SELECT count(*)::integer FROM ticket_embed_checkout_attempts WHERE embed_id=$2) AS attempts`,[f.eventId,f.embedId]))[0];
let failed=0,passed=0;
async function check(label,fn){try{await fn();passed++;console.log('PASS: '+label);}catch(error){failed++;console.error('FAIL: '+label+'\n'+error.stack);}}
await check('pending order and shared hold exist in one committed attempt',async()=>{
 const f=await fixture(),a=await prepare(f);
 assert.deepEqual(await counts(f),{orders:1,holds:1,attempts:1});assert.equal(a.stripe_session_id,null);
 const order=(await sql('SELECT status,total_cents,subtotal_cents FROM orders WHERE id=$1',[a.order_id]))[0];
 assert.deepEqual(order,{status:'payment_pending',total_cents:2663,subtotal_cents:2500});
});
await check('simultaneous retries create one attempt, one hold and one order',async()=>{
 const f=await fixture(),id=randomUUID();
 const results=await Promise.all(Array.from({length:8},()=>prepare(f,id)));
 assert.equal(new Set(results.map(a=>a.order_id)).size,1);assert.deepEqual(await counts(f),{orders:1,holds:1,attempts:1});
});
await check('changed selection/proof cannot replace an existing attempt',async()=>{
 const f=await fixture(),a=await prepare(f);
 await assert.rejects(prepare(f,a.id,{},'c'.repeat(64)),/attempt_conflict/);
 await assert.rejects(prepare(f,a.id,{},PROOF,'d'.repeat(64)),/attempt_conflict/);
 assert.deepEqual(await counts(f),{orders:1,holds:1,attempts:1});
});
await check('ordinary site hold and embed race for the last seat without overselling',async()=>{
 for(let i=0;i<8;i++){
  const f=await fixture(1);
  const results=await Promise.allSettled([prepare(f),sql('SELECT ticket_hold_create_atomic($1,1) AS hold',[f.tierId])]);
  const held=(await sql("SELECT sum(quantity)::integer AS seats FROM ticket_holds WHERE ticket_type_id=$1 AND status='active'",[f.tierId]))[0].seats;
  assert.equal(held,1);
  const winner=results[0].status==='fulfilled'?1:0;
  const normal=results[1].status==='fulfilled' && results[1].value[0].hold.ok?1:0;
  assert.equal(winner+normal,1);
 }
});
await check('active ordinary cart holds block embed reservation',async()=>{
 const f=await fixture(2);await sql("INSERT INTO cart_holds VALUES($1,2,false,now()+interval '1 hour')",[f.tierId]);
 await assert.rejects(prepare(f),/sold_out/);assert.deepEqual(await counts(f),{orders:0,holds:0,attempts:0});
});
await check('failed pending order insert rolls back the new hold',async()=>{
 const f=await fixture();
 await sql("ALTER TABLE orders ADD CONSTRAINT fixture_order_rejection CHECK(guest_email<>'reject@example.com')");
 try{await assert.rejects(prepare(f,randomUUID(),{email:'reject@example.com'}),/fixture_order_rejection/);
 assert.deepEqual(await counts(f),{orders:0,holds:0,attempts:0});}finally{await sql('ALTER TABLE orders DROP CONSTRAINT fixture_order_rejection');}
});
await check('revoked/stale origin and changed catalog reject before creating money state',async()=>{
 const f=await fixture();await sql("UPDATE event_ticket_widgets SET published=false WHERE id=$1",[f.embedId]);
 await assert.rejects(prepare(f),/embed_unavailable/);
 await sql("UPDATE event_ticket_widgets SET published=true,revision=2 WHERE id=$1",[f.embedId]);
 await assert.rejects(prepare(f),/embed_unavailable/);
 await sql('UPDATE event_ticket_widgets SET revision=1 WHERE id=$1',[f.embedId]);
 await sql('UPDATE ticket_types SET price_cents=3500 WHERE id=$1',[f.tierId]);
 await assert.rejects(prepare(f),/selection_changed/);assert.deepEqual(await counts(f),{orders:0,holds:0,attempts:0});
});
await check('hidden/private/closed event cannot acquire an embed hold',async()=>{
 const f=await fixture();await sql("UPDATE events SET visibility='private' WHERE id=$1",[f.eventId]);await assert.rejects(prepare(f),/event_unavailable/);
 await sql("UPDATE events SET visibility='public',is_hidden=true WHERE id=$1",[f.eventId]);await assert.rejects(prepare(f),/event_unavailable/);
 await sql("UPDATE events SET is_hidden=false,end_date=now() WHERE id=$1",[f.eventId]);await assert.rejects(prepare(f),/selection_changed/);
 assert.deepEqual(await counts(f),{orders:0,holds:0,attempts:0});
});
await check('per-email cap counts held, issued and transfer-pending tickets',async()=>{
 const f=await fixture();await sql('UPDATE ticket_types SET max_per_user=2 WHERE id=$1',[f.tierId]);
 await sql("INSERT INTO tickets(ticket_type_id,guest_email,status) VALUES($1,'buyer@example.com','transfer_pending')",[f.tierId]);
 await prepare(f);await assert.rejects(prepare(f),/buyer_limit/);assert.deepEqual(await counts(f),{orders:1,holds:1,attempts:1});
});
await check('session attachment is atomic, repeatable and refuses replacement IDs',async()=>{
 const f=await fixture(),a=await prepare(f),attached=await attach(a);
 assert.deepEqual(await attach(a),attached);await assert.rejects(attach(a,'cs_test_other'),/session_conflict/);
 const state=(await sql('SELECT o.stripe_checkout_session_id,h.payment_intent_id FROM orders o JOIN ticket_holds h ON h.id=$2 WHERE o.id=$1',[a.order_id,a.hold_id]))[0];
 assert.equal(state.stripe_checkout_session_id,attached.stripe_session_id);assert.equal(state.payment_intent_id,attached.stripe_session_id);
});
await check('released hold prevents secret publication/attachment without updating order',async()=>{
 const f=await fixture(),a=await prepare(f);await sql("UPDATE ticket_holds SET status='expired' WHERE id=$1",[a.hold_id]);
 await assert.rejects(attach(a),/hold_unavailable/);
 assert.equal((await sql('SELECT stripe_checkout_session_id FROM orders WHERE id=$1',[a.order_id]))[0].stripe_checkout_session_id,null);
});
await check('server reservation uses real locked promoter attribution',async()=>{
 const f=await fixture();const promoter=(await sql(`INSERT INTO event_promoters(event_id,code,rev_share_bps,status,customer_discount_bps,promoter_commission_bps)
 VALUES($1,'TRE_1',2000,'active',1000,2000) RETURNING id`,[f.eventId]))[0];
 const p={promoter_id:promoter.id,code:'TRE_1',customer_discount_bps:1000,promoter_commission_bps:2000,discount_cents:250,discounted_amount_cents:2250,commission_cents:450};
 const a=await prepare(f,randomUUID(),{promoter:p,fees:fees(2250)});
 const row=(await sql(`SELECT o.promoter_id,o.promoter_discount_amount_cents,o.promoter_commission_amount_cents,
 a.locked_customer_discount_bps,a.locked_promoter_commission_bps FROM orders o JOIN promoter_attributions a ON a.order_id=o.id WHERE o.id=$1`,[a.order_id]))[0];
 assert.deepEqual(row,{promoter_id:promoter.id,promoter_discount_amount_cents:250,promoter_commission_amount_cents:450,locked_customer_discount_bps:1000,locked_promoter_commission_bps:2000});
 await sql('UPDATE event_promoters SET promoter_commission_bps=3000 WHERE id=$1',[promoter.id]);
 assert.equal((await prepare(f,a.id)).order_id,a.order_id);
});
await check('new table and money-changing RPCs deny public client roles',async()=>{
 const f=await fixture();await prepare(f);
 for(const role of ['anon','authenticated']){
  const client=await pool.connect();
  try {await client.query('SET ROLE '+role);
   await assert.rejects(client.query('SELECT * FROM ticket_embed_checkout_attempts'),/permission denied/);
   await assert.rejects(client.query('SELECT ticket_embed_attach_session($1,$2)',[randomUUID(),'cs_test_wrong']),/permission denied/);
   await assert.rejects(client.query('SELECT ticket_embed_prepare_checkout($1,$2,$3,$4,$5,$6)',[randomUUID(),f.embedId,ORIGIN,PROOF,REQUEST,JSON.stringify(f.quote)]),/permission denied/);
  } finally {await client.query('RESET ROLE');client.release();}
 }
});
await check('ordinary hold/settings cleanup is not blocked by recovery rows',async()=>{
 const f=await fixture(),a=await prepare(f);await attach(a);
 await sql('DELETE FROM ticket_holds WHERE id=$1',[a.hold_id]);
 await sql('DELETE FROM event_ticket_widgets WHERE id=$1',[f.embedId]);
 assert.equal((await sql('SELECT count(*)::integer AS n FROM ticket_embed_checkout_attempts WHERE id=$1',[a.id]))[0].n,1);
 await sql('DELETE FROM orders WHERE id=$1',[a.order_id]);
 assert.equal((await sql('SELECT count(*)::integer AS n FROM ticket_embed_checkout_attempts WHERE id=$1',[a.id]))[0].n,0);
});
await check('cancelling a never-disclosed session serializes against later attachment',async()=>{
 const f=await fixture(),a=await prepare(f);
 const cancelled=(await sql('SELECT ticket_embed_cancel_unattached($1) AS a',[a.id]))[0].a;
 assert.equal(cancelled.state,'cancelled');await assert.rejects(attach(a),/attempt_cancelled/);
 assert.equal((await sql('SELECT status FROM ticket_holds WHERE id=$1',[a.hold_id]))[0].status,'expired');
 const next=await prepare(f);assert.notEqual(next.order_id,a.order_id);
});
await check('unattached cancellation never releases an already-attached session',async()=>{
 const f=await fixture(),a=await prepare(f);await attach(a);
 const current=(await sql('SELECT ticket_embed_cancel_unattached($1) AS a',[a.id]))[0].a;
 assert.equal(current.state,'pending');assert.ok(current.stripe_session_id);
 assert.equal((await sql('SELECT status FROM ticket_holds WHERE id=$1',[a.hold_id]))[0].status,'active');
});
await pool.end();
console.log(`Embed PostgreSQL verification: ${passed} passed, ${failed} failed. Disposable database only.`);
if(failed)process.exitCode=1;
