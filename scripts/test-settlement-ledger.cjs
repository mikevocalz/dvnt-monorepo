const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const sql = readFileSync(resolve(__dirname,'../docs/payments/drafts/settlement-ledger.sql'),'utf8');
const order = '00000000-0000-4000-8000-000000000001';
const promoter = '00000000-0000-4000-8000-000000000002';
async function fixture() {
 const db = new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.events(id int primary key,host_id text);
 CREATE TABLE public.orders(id uuid primary key,event_id int, type text,status text,charge_model text,
  stripe_payment_intent_id text,currency text,total_cents bigint,subtotal_cents bigint,organizer_fee_cents bigint,
  promoter_code text,promoter_commission_amount_cents bigint);
 CREATE TABLE public.promoter_attributions(order_id uuid primary key,promoter_id uuid);
 INSERT INTO events VALUES(1,'fixture-host');
 INSERT INTO orders VALUES('${order}',1,'event_ticket','paid','separate_charges_and_transfers',
 'pi_fixture','usd',11000,10000,500,'FIXTURE',1000);
 INSERT INTO promoter_attributions VALUES('${order}','${promoter}');`);
 await db.exec(sql);
 return db;
}
async function enroll(db) { await db.query(`select dvnt_settlement.enroll($1,'ch_fixture','pi_fixture','usd',11000,'2020-01-01')`,[order]); }
async function allocations(db) { return (await db.query('select a.*,d.* from dvnt_settlement.allocations a join dvnt_settlement.deliveries d on d.allocation_id=a.id order by role')).rows; }
async function enable(db) { await db.exec(`update dvnt_settlement.controls set transfers_enabled=true; update dvnt_settlement.orders set blocked=false;`); }
async function reserve(db,id,destination='acct_fixture') { return (await db.query('select dvnt_settlement.reserve($1,$2) as v',[id,destination])).rows[0].v; }
async function reconcile(db,a,{transfer='tr_fixture',destination='acct_fixture',charge='ch_fixture',currency='usd',amount=a.amount_cents}={}) {
 await db.query('select dvnt_settlement.reconcile_transfer($1,$2,$3,$4,$5,$6)',[a.id,transfer,destination,charge,currency,amount]);
}

test('enrollment snapshots conserved shares, frozen recipient, stable intent key and idempotent replay',async()=>{
 const db=await fixture(); try {
 await enroll(db); const before=await allocations(db); await enroll(db);
 assert.deepEqual(await allocations(db),before);
 assert.deepEqual(before.map(a=>[a.role,Number(a.amount_cents),a.recipient_id]),[['organizer',8500,'fixture-host'],['promoter',1000,promoter]]);
 assert.ok(before.every(a=>a.state==='held' && a.bank_payout_state==='unverified' && a.idempotency_key===`dvnt:settlement:v1:${a.id}`));
 await assert.rejects(db.query(`update dvnt_settlement.allocations set amount_cents=1`),/immutable/);
 await assert.rejects(db.query(`delete from dvnt_settlement.allocations`),/immutable/);
 await assert.rejects(db.query(`select dvnt_settlement.enroll($1,'ch_other','pi_fixture','usd',11000,'2020-01-01')`,[order]),/mismatch/);
 }finally{await db.close();}
});

test('NULL/destination/failed orders and mismatched source evidence cannot enroll',async()=>{
 const db=await fixture(); try {
 for(const model of [null,'destination_charge']) {
 await db.query('update orders set charge_model=$1',[model]); await assert.rejects(enroll(db),/not eligible/);
 }
 await db.exec("update orders set charge_model='separate_charges_and_transfers',status='refunded'");
 await assert.rejects(enroll(db),/not eligible/);
 await db.exec("update orders set status='paid'");
 await assert.rejects(db.query(`select dvnt_settlement.enroll($1,'ch_fixture','pi_wrong','usd',11000,'2020-01-01')`,[order]),/not eligible/);
 await assert.rejects(db.query(`select dvnt_settlement.enroll($1,'ch_fixture','pi_fixture','eur',11000,'2020-01-01')`,[order]),/not eligible/);
 assert.equal((await allocations(db)).length,0);
 }finally{await db.close();}
});

test('bad commission and missing attribution roll back the entire enrollment',async()=>{
 const db=await fixture(); try {
 for(const cents of [null,-1,10001]) {
 await db.query('update orders set promoter_commission_amount_cents=$1',[cents]);
 await assert.rejects(enroll(db),/commission|allocation/);
 }
 await db.exec('update orders set promoter_commission_amount_cents=1000; delete from promoter_attributions;');
 await assert.rejects(enroll(db),/no rows/); assert.equal((await allocations(db)).length,0);
 }finally{await db.close();}
});

test('disabled control, review hold, future release, unpaid source and incomplete onboarding block reservations',async()=>{
 const db=await fixture(); try {
 await enroll(db); const a=(await allocations(db)).find(a=>a.role==='promoter');
 await assert.rejects(reserve(db,a.id),/held/);
 await db.exec('update dvnt_settlement.controls set transfers_enabled=true');
 await assert.rejects(reserve(db,a.id),/held/);
 await enable(db); await db.exec("update dvnt_settlement.orders set release_at='2099-01-01'");
 await assert.rejects(reserve(db,a.id),/held/);
 await db.exec("update dvnt_settlement.orders set release_at='2020-01-01'; update orders set status='refunded'");
 await assert.rejects(reserve(db,a.id),/held/);
 await db.exec("update orders set status='paid'");
 await assert.rejects(reserve(db,a.id,null),/not onboarded/);
 assert.equal((await allocations(db))[0].state,'held');
 const intent=await reserve(db,a.id); assert.equal(intent.source_transaction,'ch_fixture');
 assert.equal(Number(intent.amount),1000); assert.equal(intent.currency,'usd');
 await assert.rejects(reserve(db,a.id),/reconcile/);
 }finally{await db.close();}
});

test('partial completion survives retry; late onboarding keeps recipient identity and bank payout unverified',async()=>{
 const db=await fixture(); try {
 await enroll(db); await enable(db); const [host,promo]=await allocations(db);
 await assert.rejects(reserve(db,host.id),/promoter settlement pending/);
 await assert.rejects(reserve(db,promo.id,null),/not onboarded/);
 const intent=await reserve(db,promo.id,'acct_later');
 assert.equal(intent.idempotency_key,promo.idempotency_key);
 await assert.rejects(reserve(db,host.id),/promoter settlement pending/);
 await reconcile(db,promo,{transfer:'tr_later',destination:'acct_later'});
 await reserve(db,host.id); await reconcile(db,host); await reconcile(db,host);
 await assert.rejects(reserve(db,host.id),/reconcile/);
 assert.ok((await allocations(db)).every(a=>a.state==='transferred'&&a.bank_payout_state==='unverified'));
 }finally{await db.close();}
});

test('refund first prevents all reservations and never automatically requeues',async()=>{
 const db=await fixture(); try {
 await enroll(db); await enable(db);
 await db.query("select dvnt_settlement.hold($1,'evt_refund_fixture','refund')",[order]);
 await db.query("select dvnt_settlement.hold($1,'evt_refund_fixture','refund')",[order]);
 assert.equal((await db.query('select count(*)::int n from dvnt_settlement.holds')).rows[0].n,1);
 for(const a of await allocations(db)) await assert.rejects(reserve(db,a.id),/held/);
 }finally{await db.close();}
});

test('dispute after reservation quarantines unknown outcome and tracks confirmed transfer as recovery owed',async()=>{
 const db=await fixture(); try {
 await enroll(db); await enable(db); const [host,promo]=await allocations(db);
 await reserve(db,promo.id); await reconcile(db,promo,{transfer:'tr_promoter'}); await reserve(db,host.id);
 await db.query("select dvnt_settlement.hold($1,'evt_dispute_fixture','dispute')",[order]);
 assert.deepEqual((await allocations(db)).map(a=>a.state),['uncertain','recovery_required']);
 await reconcile(db,host);
 assert.ok((await allocations(db)).every(a=>a.state==='recovery_required'&&a.bank_payout_state==='unverified'));
 for(const a of await allocations(db)) await assert.rejects(reserve(db,a.id),/held/);
 }finally{await db.close();}
});

test('reconciliation requires exact frozen transfer evidence and unique transfer identifier',async()=>{
 const db=await fixture(); try {
 await enroll(db); await enable(db); const [host,promo]=await allocations(db);
 await assert.rejects(reconcile(db,host),/mismatch/);
 await reserve(db,promo.id);
 for(const mismatch of [{amount:999},{currency:'eur'},{charge:'ch_other'},{destination:'acct_other'},{transfer:null}]) {
 await assert.rejects(reconcile(db,promo,mismatch),/mismatch/);
 }
 await reconcile(db,promo); await reserve(db,host.id);
 await assert.rejects(reconcile(db,host),/unique/);
 await assert.rejects(reconcile(db,promo,{transfer:'tr_replaced'}),/mismatch/);
 }finally{await db.close();}
});

test('buyer/anonymous roles cannot call financial functions or read ledger; service cannot modify snapshots directly',async()=>{
 const db=await fixture(); try {
 await enroll(db);
 for(const role of ['anon','authenticated']) {
 await db.exec(`set role ${role}`);
 await assert.rejects(db.query('select * from dvnt_settlement.allocations'),/permission/);
 await assert.rejects(enroll(db),/permission/);
 await db.exec('reset role');
 }
 await db.exec('set role service_role');
 await assert.rejects(db.exec('update dvnt_settlement.controls set transfers_enabled=true'),/permission/);
 await assert.rejects(db.exec('delete from dvnt_settlement.allocations'),/permission/);
 await enroll(db);
 }finally{await db.close();}
});


test('enrolled source economics cannot change, but refunds remain writable and force recovery',async()=>{
 const db=await fixture(); try {
 await enroll(db); await enable(db); const host=(await allocations(db)).find(a=>a.role==='promoter');
 for(const change of ["charge_model='destination_charge'","total_cents=12000","promoter_commission_amount_cents=0","event_id=2","stripe_payment_intent_id='pi_other'"]) {
  await assert.rejects(db.exec('update orders set '+change),/immutable/);
 }
 await reserve(db,host.id); await db.exec("update orders set status='refunded'");
 await reconcile(db,host);
 assert.equal((await allocations(db)).find(a=>a.id===host.id).state,'recovery_required');
 }finally{await db.close();}
});


test('source and transfer proof IDs require literal nonempty provider prefixes',async()=>{const db=await fixture();try{for(const charge of ['chXfixture','ch_'])await assert.rejects(db.query("select dvnt_settlement.enroll($1,$2,'pi_fixture','usd',11000,'2020-01-01')",[order,charge]),/constraint|eligible|mismatch/);await enroll(db);await enable(db);const a=(await allocations(db)).find(a=>a.role==='promoter');await reserve(db,a.id);for(const transfer of ['trXfixture','tr_'])await assert.rejects(reconcile(db,a,{transfer}),/mismatch/);}finally{await db.close();}});
