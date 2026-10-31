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
  throw Error('No complete PostgreSQL server; platform fee snapshot SQL tests did NOT run. Set POSTGRES_BIN.');
}
const schema=`
CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
CREATE TABLE events(id serial PRIMARY KEY,host_id text);
CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer REFERENCES events(id),type text DEFAULT 'event_ticket',status text DEFAULT 'paid',paid_at timestamptz DEFAULT clock_timestamp(),currency text DEFAULT 'usd',total_cents integer DEFAULT 2200,platform_fee_cents integer DEFAULT 200,dvnt_total_fee_cents integer DEFAULT 200,charge_model text DEFAULT 'destination_charge',stripe_payment_intent_id text);
`;
test('durable platform fee snapshots have scoped enrollment and provider CAS',{timeout:120000},async t=>{
 const bin=serverBin(),data=mkdtempSync(path.join(tmpdir(),'dvnt-fee-sql-')),socket=mkdtempSync(path.join(tmpdir(),'dvnt-fee-sock-'));
 const run=(n,a)=>execFileSync(path.join(bin,n),a,{encoding:'utf8',stdio:['ignore','pipe','pipe']});let pool;
 try{
 const args=['-D',data,'-U','harness','--auth=trust','--no-sync'];if(process.env.POSTGRES_SHARE)args.push('-L',process.env.POSTGRES_SHARE);run('initdb',args);
 try { run('pg_ctl',['-D',data,'-o',`-k ${socket} -c listen_addresses='' -c fsync=off`,'-w','-l',path.join(data,'log'),'start']); } catch (error) { if (existsSync(path.join(data,'log'))) console.error(readFileSync(path.join(data,'log'),'utf8')); throw error; }pool=new Pool({host:socket,user:'harness',database:'postgres',max:5});await pool.query(schema);
 await pool.query(readFileSync(path.join(migrations,'20261031131615_scoped_platform_fee_report.sql'),'utf8'));
 const bounds=(await pool.query("SELECT date_trunc('month',clock_timestamp() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York' start,(date_trunc('month',clock_timestamp() AT TIME ZONE 'America/New_York')+interval '1 month') AT TIME ZONE 'America/New_York' finish")).rows[0];
 const reset=()=>pool.query('TRUNCATE platform_fee_reports,platform_fee_snapshots,orders,events RESTART IDENTITY CASCADE');
 const ev=async(owner='host')=>(await pool.query('INSERT INTO events(host_id) VALUES($1) RETURNING id',[owner])).rows[0].id;
 const mint=async(event,pi,patch={})=>{const keys=Object.keys(patch),vals=Object.values(patch);return (await pool.query(`INSERT INTO orders(event_id,stripe_payment_intent_id${keys.length?','+keys.join(','):''}) VALUES($1,$2${vals.map((_,i)=>',$'+(i+3)).join('')}) RETURNING *`,[event,pi,...vals])).rows[0];};
 const enroll=(owner='host')=>pool.query('SELECT enroll_platform_fee_snapshots($1,$2,$3) result',[owner,bounds.start,bounds.finish]).then(r=>r.rows[0].result);
 const claim=(limit=10)=>pool.query('SELECT * FROM claim_platform_fee_snapshots($1)',[limit]).then(r=>r.rows);
 const finish=(r,amount=r.expected_fee_cents,refund=0,currency='usd',error=null)=>pool.query('SELECT complete_platform_fee_snapshot($1,$2,$3,$4,$5,$6) ok',[r.payment_intent_id,r.lease_token,amount,refund,currency,error]).then(x=>x.rows[0].ok);
 await t.test('migration leaves empty queue; only requested owner current paid cohort enrolled',async()=>{
 await reset();assert.equal((await claim()).length,0);const event=await ev(),other=await ev('other');await mint(event,'pi_FixtureA');await mint(other,'pi_Other');await mint(event,'pi_Failed',{status:'payment_failed'});await mint(event,'pi_Future',{paid_at:bounds.finish});await mint(event,'pi_Old',{paid_at:new Date(bounds.start.getTime()-1000)});const e=await enroll();assert.equal(e.enrolled,1);assert.equal(e.expected_orders,1);assert.equal((await claim())[0].payment_intent_id,'pi_FixtureA');await assert.rejects(pool.query('SELECT enroll_platform_fee_snapshots(NULL,$1,$2)',[bounds.start,bounds.finish]),/Not authorized/);await assert.rejects(pool.query("SELECT enroll_platform_fee_snapshots('host',$1::timestamptz-interval '1 month',$2::timestamptz-interval '1 month')",[bounds.start,bounds.finish]),/current reporting month/);
 });
 await t.test('no 200 or1000 row truncation and one snapshot for shared same-cohort PI',async()=>{
 await reset();const event=await ev();await pool.query("INSERT INTO orders(event_id,stripe_payment_intent_id) SELECT $1,'pi_Fixture'||n FROM generate_series(1,1207)n",[event]);const shared=await mint(event,'pi_Shared');const zero=await mint(event,'pi_Shared',{platform_fee_cents:0,dvnt_total_fee_cents:0,total_cents:0});const e=await enroll();assert.equal(e.expected_orders,1209);assert.equal(e.enrolled,1208);const row=(await pool.query("SELECT * FROM platform_fee_snapshots WHERE payment_intent_id='pi_Shared'")).rows[0];assert.deepEqual(row.order_ids,[shared.id,zero.id].sort());assert.equal(Number(row.expected_fee_cents),200);
 });
 await t.test('ambiguous cross-owner/month/status PI never returns to provider worker',async()=>{
 await reset();const own=await ev(),other=await ev('other');await mint(own,'pi_CrossOwner');await mint(other,'pi_CrossOwner');await mint(own,'pi_CrossMonth');await mint(own,'pi_CrossMonth',{paid_at:new Date(bounds.start.getTime()-1)});await mint(own,'pi_CrossStatus');await mint(own,'pi_CrossStatus',{status:'payment_pending'});assert.equal((await enroll()).invalid_orders,3);assert.equal((await claim()).length,0);
 });
 await t.test('zero fees need no provider call, missing or conflicting aliases fail closed',async()=>{
 await reset();const event=await ev();await mint(event,null,{platform_fee_cents:null,dvnt_total_fee_cents:null,total_cents:0});await mint(event,'pi_Unknown',{platform_fee_cents:null,dvnt_total_fee_cents:null});await mint(event,'pi_Conflict',{platform_fee_cents:200,dvnt_total_fee_cents:100});await mint(event,'pi_Separate',{charge_model:'separate_charges_and_transfers'});await mint(event,'pi_PaidDefaults',{platform_fee_cents:0,dvnt_total_fee_cents:0});await mint(event,'pi_CorruptFree',{platform_fee_cents:200,dvnt_total_fee_cents:200,total_cents:0});await mint(event,'pi_UnknownTotal',{platform_fee_cents:0,dvnt_total_fee_cents:0,total_cents:null});const e=await enroll();assert.equal(e.invalid_orders,6);assert.equal(e.enrolled,0);assert.equal((await claim()).length,0);
 });
 await t.test('concurrent enrollment and claims cannot double lease one payment',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Concurrent');await Promise.all([enroll(),enroll()]);const lists=await Promise.all([claim(),claim()]);assert.equal(lists.flat().length,1);const r=lists.flat()[0];assert.equal(await finish(r,200,37),true);const saved=(await pool.query("SELECT * FROM platform_fee_snapshots WHERE payment_intent_id=$1",[r.payment_intent_id])).rows[0];assert.equal(saved.status,'verified');assert.equal(Number(saved.refunded_cents),37);assert.equal(await finish(r,200,37),false);
 });
 await t.test('scope changes after enrollment prevent provider GET; after claim prevent verified write',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Ownership');await enroll();await pool.query("UPDATE events SET host_id='other' WHERE id=$1",[event]);assert.equal((await claim()).length,0);assert.equal((await pool.query('SELECT status FROM platform_fee_snapshots')).rows[0].status,'failed');await reset();const e=await ev();await mint(e,'pi_AfterClaim');await enroll();const r=(await claim())[0];await pool.query("UPDATE events SET host_id='other' WHERE id=$1",[e]);assert.equal(await finish(r),true);assert.equal((await pool.query('SELECT status FROM platform_fee_snapshots')).rows[0].status,'failed');
 });
 await t.test('changed sibling bundle invalidates running generation and next generation demands full verification',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Changed');await enroll();const old=(await claim())[0];await mint(event,'pi_Changed');await finish(old);assert.equal((await enroll()).report.status,'unavailable');await pool.query("UPDATE platform_fee_reports SET target_started_at=clock_timestamp()-interval '16 minutes'");await enroll();assert.equal(await finish(old),false);const next=(await claim())[0];assert.equal(Number(next.expected_fee_cents),400);assert.equal(next.order_ids.length,2);assert.equal(await finish(next,400,120),true);assert.equal((await enroll()).report.amountCents,280);
 });
 await t.test('expired invalid rows cannot hide valid work behind a limited claim page',async()=>{
 await reset();const stale=await ev(),valid=await ev();for(let n=0;n<105;n++)await mint(stale,'pi_Invalid'+n);await mint(valid,'pi_Valid');await enroll();await pool.query("UPDATE events SET host_id='other' WHERE id=$1",[stale]);const rows=await claim(4);assert.equal(rows.length,1);assert.equal(rows[0].payment_intent_id,'pi_Valid');
 });
 await t.test('repeated lease expiry reaches bounded terminal failure',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Expired');await enroll();await claim();await pool.query("UPDATE platform_fee_snapshots SET attempts=5,leased_until=clock_timestamp()-interval '1 second'");assert.equal((await claim()).length,0);assert.equal((await pool.query('SELECT status FROM platform_fee_snapshots')).rows[0].status,'failed');
 });
 await t.test('actual zero refunds valid, wrong amount/currency/negative or overrefund never verified',async()=>{
 for(const [amount,refund,currency]of [[201,0,'usd'],[200,0,'eur'],[200,-1,'usd'],[200,201,'usd'],[200,null,'usd']]){await reset();const event=await ev();await mint(event,'pi_InvalidProvider');await enroll();const row=(await claim())[0];await finish(row,amount,refund,currency);assert.equal((await pool.query('SELECT status FROM platform_fee_snapshots')).rows[0].status,'failed');}
 await reset();const event=await ev();await mint(event,'pi_ZeroRefund');await enroll();await finish((await claim())[0],200,0);assert.equal((await pool.query('SELECT status FROM platform_fee_snapshots')).rows[0].status,'verified');
 });
 await t.test('provider error retries with backoff without zeroing unknown into a valid amount',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Timeout');await enroll();await finish((await claim())[0],null,null,null,'provider_unavailable');const r=(await pool.query('SELECT * FROM platform_fee_snapshots')).rows[0];assert.equal(r.status,'pending');assert.equal(r.amount_cents,null);assert.equal(r.refunded_cents,null);assert.equal((await claim()).length,0);
 });
 await t.test('running target freezes through and does not expand when new sales arrive',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Original');const initial=await enroll();await mint(event,'pi_NewSale');const still=await enroll();assert.equal(still.expected_orders,1);assert.equal(still.report.through,initial.report.through);await finish((await claim())[0],200,20);const ready=await enroll();assert.equal(ready.report.amountCents,180);assert.equal(ready.expected_orders,1);await pool.query("UPDATE platform_fee_reports SET target_started_at=clock_timestamp()-interval '16 minutes'");const next=await enroll();assert.equal(next.expected_orders,2);assert.equal(next.report.status,'ready');assert.equal(next.report.amountCents,180);
 });
 await t.test('refresh publishes one coherent total, not a partially updated sum',async()=>{
 await reset();const event=await ev();await mint(event,'pi_GenerationA');await mint(event,'pi_GenerationB');await enroll();for(const r of await claim())await finish(r,200,0);assert.equal((await enroll()).report.amountCents,400);
 await pool.query("UPDATE platform_fee_reports SET target_started_at=clock_timestamp()-interval '16 minutes'");await pool.query("UPDATE platform_fee_snapshots SET verified_at=clock_timestamp()-interval '21 hours',staged_verified_at=clock_timestamp()-interval '21 hours'");await enroll();const next=await claim();await finish(next[0],200,50);assert.equal((await enroll()).report.amountCents,400);await finish(next[1],200,25);const final=await enroll();assert.equal(final.report.amountCents,325);assert.equal(final.report.status,'ready');
 });
 await t.test('published cohort expires at24h and ownership changes never reveal old amount',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Stale');await enroll();await finish((await claim())[0],200,0);await pool.query("UPDATE platform_fee_reports SET published_verified_at=clock_timestamp()-interval '25 hours'");assert.equal((await enroll()).report.status,'unavailable');await pool.query("UPDATE platform_fee_reports SET published_verified_at=clock_timestamp()");await pool.query("UPDATE events SET host_id='other' WHERE id=$1",[event]);const r=await enroll();assert.equal(r.report.status,'unavailable');assert.equal(r.report.amountCents,null);
 });
 await t.test('late-arriving qualifying rows within frozen cutoff invalidate completeness',async()=>{
 for(const mode of ['insert','status']){await reset();const event=await ev();await mint(event,'pi_Existing');let delayed;if(mode==='status')delayed=await mint(event,'pi_Delayed',{status:'payment_pending'});const initial=await enroll();await finish((await claim())[0],200,0);assert.equal((await enroll()).report.status,'ready');if(mode==='insert')await mint(event,'pi_Backdated',{paid_at:new Date(new Date(initial.report.through).getTime()-1)});else await pool.query("UPDATE orders SET status='paid' WHERE id=$1",[delayed.id]);const after=await enroll();assert.equal(after.report.status,'unavailable');assert.equal(after.report.amountCents,null);}
 await reset();const event=await ev();await mint(event,'pi_Running');const initial=await enroll();await mint(event,'pi_BackdatedPending',{paid_at:new Date(new Date(initial.report.through).getTime()-1)});await finish((await claim())[0],200,0);assert.equal((await enroll()).report.status,'unavailable');
 });
 await t.test('published scope rejects subsequently ambiguous shared payment siblings',async()=>{
 for(const mode of ['other-owner','other-month','after-cutoff']){await reset();const own=await ev();await mint(own,'pi_Published');await enroll();await finish((await claim())[0],200,0);assert.equal((await enroll()).report.status,'ready');const other=mode==='other-owner'?await ev('other'):own;await mint(other,'pi_Published',mode==='other-month'?{paid_at:new Date(bounds.start.getTime()-1)}:{});const after=await enroll();assert.equal(after.report.status,'unavailable');assert.equal(after.report.amountCents,null);}
 });
 await t.test('zero-only cohort publishes verified0 without provider work',async()=>{
 await reset();const event=await ev();await mint(event,null,{total_cents:0,platform_fee_cents:0,dvnt_total_fee_cents:0});const r=await enroll();assert.equal(r.report.status,'ready');assert.equal(r.report.amountCents,0);assert.equal((await claim()).length,0);
 });
 await t.test('fresh verified snapshots survive new report generations without repeat provider work',async()=>{
 await reset();const event=await ev();await mint(event,'pi_Reused');await enroll();await finish((await claim())[0],200,25);const first=await enroll();await pool.query("UPDATE platform_fee_reports SET target_started_at=clock_timestamp()-interval '16 minutes'");const next=await enroll();assert.equal(next.report.status,'ready');assert.equal(next.report.amountCents,175);assert.equal(next.report.asOf,first.report.asOf);assert.equal((await claim()).length,0);
 });
 await t.test('genuinely empty cohort reports zero without inventing a currency',async()=>{
 await reset();const report=(await enroll()).report;assert.equal(report.status,'ready');assert.equal(report.amountCents,0);assert.equal(report.currency,null);assert.equal((await claim()).length,0);
 });
 await t.test('table RLS and functions do not expose reporting or enrollment to browser roles',async()=>{
 for(const role of ['anon','authenticated']){assert.equal((await pool.query("SELECT has_table_privilege($1,'platform_fee_reports','SELECT') ok",[role])).rows[0].ok,false);assert.equal((await pool.query("SELECT has_table_privilege($1,'platform_fee_snapshots','SELECT') ok",[role])).rows[0].ok,false);for(const sig of ['enroll_platform_fee_snapshots(text,timestamptz,timestamptz)','claim_platform_fee_snapshots(integer)','complete_platform_fee_snapshot(text,uuid,bigint,bigint,text,text)'])assert.equal((await pool.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok',[role,sig])).rows[0].ok,false);}
 assert.equal((await pool.query("SELECT relrowsecurity FROM pg_class WHERE oid='platform_fee_snapshots'::regclass")).rows[0].relrowsecurity,true);
 });
 }finally{if(pool)await pool.end();try{run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);}catch{}rmSync(data,{recursive:true,force:true});rmSync(socket,{recursive:true,force:true});}
});
