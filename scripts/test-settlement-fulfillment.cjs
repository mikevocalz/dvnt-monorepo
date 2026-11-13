const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {setup,read,engine,worker,TIER}=require('./fixtures/settlement/fulfillment.cjs');
const scalar=async(f,q)=>(await f.pg.query(q)).rows[0].v;
const receiptCount=f=>scalar(f,'SELECT count(*)::int v FROM dvnt_settlement.fulfillments');
async function seed(f,overrides={}){const row={...f.ticketRows[0],order_index:1,order_count:f.snapshot.order.quantity,status:'active',...overrides};await f.pg.query('INSERT INTO tickets SELECT * FROM jsonb_populate_record(NULL::tickets,$1)',[row]);}
for(const rail of ['create-payment-intent','ticket-checkout','guest-checkout','cart-checkout']){
 test(`${rail}: real issuance failure holds source without marking paid, then recovery/replay pays once`,async()=>{const f=await setup({rail,capacity:0,cartAddon:true});try{
  const result=await f.issue();assert.equal(result.ok,false);assert.match(result.error,/insufficient/);assert.equal(await receiptCount(f),0);
  for(let n=0;n<2;n++)await assert.rejects(f.run(),/fulfillment_required/);
  assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');assert.equal(await scalar(f,'SELECT count(*)::int v FROM dvnt_settlement.orders'),0);
  assert.equal(await scalar(f,'SELECT source_verified_at v FROM dvnt_settlement.checkouts'),null);assert.equal(f.transfers.length,0);
  await f.pg.exec('UPDATE ticket_types SET quantity_total=100');assert.equal((await f.issue()).ok,true);assert.equal(await receiptCount(f),1);
  const receipt=await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f');assert.equal((await f.issue()).duplicate,true);assert.deepEqual(await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f'),receipt);
  await f.run();await f.run();assert.deepEqual(f.transfers.map(t=>t.amount),[1000,8500]);
 }finally{await f.pg.close()}});
}
test('bare paid flags, email success and direct enrollment cannot manufacture proof; actionable reason preserves recovery',async()=>{const f=await setup();try{
 for(const state of ['created','payment_pending','payment_failed','paid']){await f.pg.query('UPDATE orders SET status=$1',[state]);await assert.rejects(f.verify(),/fulfillment_required/);assert.equal(await scalar(f,'SELECT status v FROM orders'),state);}
 await f.pg.exec("ALTER TABLE orders ADD email_status text; UPDATE orders SET email_status='sent';");await assert.rejects(f.verify(),/fulfillment_required/);
 await assert.rejects(f.pg.query("SELECT dvnt_settlement.enroll($1,'ch_fixture','pi_fixture','usd',11000,'2020-01-01')",[f.p.order_id]),/fulfillment_required/);
 let failure;try{await f.run()}catch(e){failure=e}assert.equal(engine.settlementFailureCode(failure),'fulfillment_required');
 await f.call('settlement_processing_error',{p_order_id:f.p.order_id,p_code:engine.settlementFailureCode(failure)});assert.equal(await scalar(f,'SELECT last_error v FROM dvnt_settlement.checkouts'),'fulfillment_required');
 assert.equal((await f.call('settlement_health',{})).blocked_order_count,1);assert.equal(await receiptCount(f),0);assert.equal(f.requests.filter(r=>r[0]==='POST').length,0);
}finally{await f.pg.close()}});
test('actual canonical ticket duplicate does not accept partial, wrong, failed or money-mismatched entitlements',async()=>{
 for(const fault of ['partial','tier','user','event','payment','void','qr','amount','index']){const f=await setup({quantity:2});try{
  const row={...f.ticketRows[0],order_index:1,order_count:2,status:'active'};
  const bad={partial:{},tier:{ticket_type_id:randomUUID()},user:{user_id:'not-buyer'},event:{event_id:2},payment:{stripe_payment_intent_id:'pi_other'},void:{status:'void'},qr:{qr_payload:null},amount:{purchase_amount_cents:1},index:{order_index:null}}[fault];
  if(fault==='tier')await f.pg.query('INSERT INTO ticket_types(id,event_id,quantity_total) VALUES($1,1,100)',[bad.ticket_type_id]);
  await seed(f,bad);if(fault!=='partial')await seed(f,{...f.ticketRows[1],order_index:2,order_count:2});
  try{const r=await f.issue();assert.ok(r.ok===false||r.terminal===true,fault);}catch(e){assert.match(e.message,/fulfillment_required/,fault)}
  assert.equal(await receiptCount(f),0,fault);await assert.rejects(f.run(),/fulfillment_required/);assert.equal(f.transfers.length,0,fault);
 }finally{await f.pg.close()}}
});
test('caller-selected wrong tier is atomically rolled back even when real issuer and hold agree',async()=>{const f=await setup();try{
 const other=randomUUID();await f.pg.query("INSERT INTO ticket_types(id,event_id,quantity_total) VALUES($1,1,100)",[other]);await f.pg.query('UPDATE ticket_holds SET ticket_type_id=$1',[other]);
 await assert.rejects(f.issue({p_ticket_type_id:other,p_ticket_rows:f.ticketRows.map(t=>({...t,ticket_type_id:other}))}),/fulfillment_required/);
 assert.equal(await scalar(f,'SELECT count(*)::int v FROM tickets'),0);assert.equal(await scalar(f,"SELECT status v FROM ticket_holds"),'active');assert.equal(await receiptCount(f),0);
}finally{await f.pg.close()}});
test('all-addon carts certify exact per-unit variant entitlements and pay without admission tickets',async()=>{const f=await setup({rail:'cart-checkout',addonOnly:true});try{
 assert.equal((await f.issue()).ok,true);assert.equal(await scalar(f,'SELECT count(*)::int v FROM tickets'),0);assert.equal(await scalar(f,'SELECT sum(quantity)::int v FROM order_addons'),2);assert.equal(await receiptCount(f),1);await f.run();assert.equal(f.transfers.length,2);
}finally{await f.pg.close()}});
test('cart exact immutable line selection and unit prices reject changed scope with atomic issuer rollback',async()=>{
 for(const change of ["unit_price_cents=9999",'quantity=2','variant_id=NULL']){const f=await setup({rail:'cart-checkout',cartAddon:true});try{
  await f.pg.query(`UPDATE cart_line_items SET ${change} WHERE id=$1`,[change.startsWith('variant')?f.addonLine:f.line]);
  try{assert.equal((await f.issue()).ok,false)}catch(e){assert.match(e.message,/fulfillment_required/)}
  assert.equal(await receiptCount(f),0);assert.equal(await scalar(f,'SELECT count(*)::int v FROM tickets'),0);assert.equal(await scalar(f,'SELECT count(*)::int v FROM order_addons'),0);assert.equal(await scalar(f,'SELECT status v FROM carts'),'paying');
  await assert.rejects(f.run(),/fulfillment_required/);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');
 }finally{await f.pg.close()}}
});
test('canonical cart partial writes, missing addon units, wrong variants and failed statuses never yield receipts',async()=>{
 for(const fault of ['partial','missing-addon','wrong-variant','refunded-addon','void-ticket','wrong-event','wrong-owner','missing-qr']){const f=await setup({rail:'cart-checkout',cartAddon:true,installGate:false});try{
  if(fault==='partial'){await f.pg.query("INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,order_id,cart_id,cart_line_item_id,stripe_payment_intent_id) VALUES($1,1,$2,'fixture-buyer','active',$3,$4,$5,'pi_fixture')",[randomUUID(),TIER,f.p.order_id,f.cart,f.line]);}
  else {assert.equal((await f.issue()).ok,true);await f.pg.exec({
   'missing-addon':'DELETE FROM order_addons WHERE id=(SELECT id FROM order_addons LIMIT 1)',
   'wrong-variant':'UPDATE order_addons SET variant_id=NULL',
   'refunded-addon':"UPDATE order_addons SET status='refunded'",
   'void-ticket':"UPDATE tickets SET status='void'",'wrong-event':'UPDATE tickets SET event_id=2',
   'wrong-owner':"UPDATE order_addons SET user_id='other'",'missing-qr':'UPDATE order_addons SET qr_payload=NULL',
  }[fault]);}
  await f.pg.exec(read('docs/payments/drafts/settlement-fulfillment.sql'));
  try{assert.equal((await f.issue()).ok,false)}catch(e){assert.match(e.message,/fulfillment_required/)}
  assert.equal(await receiptCount(f),0,fault);await assert.rejects(f.run(),/fulfillment_required/);assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}}
});
test('direct legacy cart allocator paid flag alone has no proof; canonical exact replay provides proof',async()=>{const f=await setup({rail:'cart-checkout',cartAddon:true,installGate:false});try{
 assert.equal((await f.issue()).ok,true);await f.pg.exec(read('docs/payments/drafts/settlement-fulfillment.sql'));await assert.rejects(f.verify(),/fulfillment_required/);assert.equal((await f.issue()).duplicate,true);assert.equal(await receiptCount(f),1);await f.run();assert.equal(f.transfers.length,2);
}finally{await f.pg.close()}});
test('old unfulfilled enrolled liabilities cannot reserve after the gate is installed',async()=>{const f=await setup({installGate:false});try{
 await f.verify();await f.pg.exec(read('docs/payments/drafts/settlement-fulfillment.sql'));const a=(await f.candidate()).allocations.find(a=>a.role==='promoter');
 await assert.rejects(f.pg.query('SELECT dvnt_settlement.reserve($1,$2)',[a.id,'acct_promoter']),/fulfillment_required/);assert.equal(await scalar(f,'SELECT count(*)::int v FROM dvnt_settlement.deliveries WHERE state<>\'held\''),0);
}finally{await f.pg.close()}});
test('client/service cannot forge or erase proof, invoke private constructors, or bypass wrappers despite default grants',async()=>{const f=await setup({defaultGrants:true});try{
 for(const role of ['anon','authenticated','service_role']){
  await f.pg.exec('SET ROLE '+role);
  for(const q of ["INSERT INTO dvnt_settlement.fulfillments(order_id) VALUES('00000000-0000-4000-8000-000000000001')",'DELETE FROM dvnt_settlement.fulfillments','TRUNCATE dvnt_settlement.fulfillments',"SELECT dvnt_settlement.record_fulfillment('00000000-0000-4000-8000-000000000001','paid_ticket_issuance_atomic')",'SELECT dvnt_settlement.paid_ticket_before_settlement_fulfillment(NULL,NULL,NULL,NULL,NULL,NULL)'])await assert.rejects(f.pg.exec(q),/permission/);
  if(role==='service_role')await assert.rejects(f.verify(),/fulfillment_required/);else await assert.rejects(f.issue(),/permission/);
  await f.pg.exec('RESET ROLE');
 }
 await f.pg.exec('SET ROLE service_role');assert.equal((await f.issue()).ok,true);await f.pg.exec('RESET ROLE');
 await assert.rejects(f.pg.exec('DELETE FROM dvnt_settlement.fulfillments'),/immutable/);await assert.rejects(f.pg.exec("UPDATE dvnt_settlement.fulfillments SET entitlements='{}'"),/immutable/);
 const bad=await f.pg.query("SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dvnt_settlement' AND has_function_privilege('service_role',p.oid,'EXECUTE')");assert.deepEqual(bad.rows,[]);
}finally{await f.pg.close()}});
test('refund/dispute terminal success never creates proof and existing proof never overrides financial hold',async()=>{
 for(const status of ['refunded','partially_refunded','disputed']){for(const issued of [false,true]){const f=await setup();try{
  if(issued)assert.equal((await f.issue()).ok,true);await f.pg.query('UPDATE orders SET status=$1',[status]);const result=await f.issue();assert.equal(result.terminal,true);assert.equal(await receiptCount(f),issued?1:0);await assert.rejects(f.verify(),issued?/eligible/:/fulfillment_required/);assert.equal(f.transfers.length,0);
 }finally{await f.pg.close()}}}
});
test('receipt survives legitimate ownership transfer, scanning and addon redemption without a second issuance',async()=>{const f=await setup({rail:'cart-checkout',cartAddon:true});try{
 await f.issue();const receipt=await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f');await f.pg.exec("UPDATE tickets SET user_id='recipient',status='scanned'; UPDATE order_addons SET user_id='recipient',status='redeemed';");await f.run();assert.equal(f.transfers.length,2);assert.deepEqual(await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f'),receipt);
}finally{await f.pg.close()}});

test('actual worker endpoint with real issuance SQL reports fulfillment_required and only pays after recovery',async()=>{const f=await setup({rail:'cart-checkout',cartAddon:true,capacity:0});try{
 const disabled=worker(f.db,f.provider);assert.equal((await disabled()).status,503);assert.equal(f.requests.length,0);
 const enabled=worker(f.db,f.provider,{SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true'});
 assert.equal((await f.issue()).ok,false);let r=await enabled();assert.equal(r.status,200);
 assert.ok((await r.json()).results.some(x=>x.order_id===f.p.order_id&&x.reason==='fulfillment_required'));
 assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');assert.equal(await scalar(f,'SELECT last_error v FROM dvnt_settlement.checkouts'),'fulfillment_required');assert.equal(f.transfers.length,0);
 await f.pg.exec('UPDATE ticket_types SET quantity_total=100');assert.equal((await f.issue()).ok,true);
 await f.pg.exec('UPDATE dvnt_settlement.checkouts SET next_check_at=NULL');r=await enabled();assert.equal(r.status,200);assert.equal(f.transfers.length,2);
 assert.equal(await scalar(f,'SELECT last_error v FROM dvnt_settlement.checkouts'),null);
}finally{await f.pg.close()}});
test('final generated artifact installs real issuer wrappers with financial gates off and no forged proof',async()=>{
 const {PGlite}=require('@electric-sql/pglite');const {sourceSql}=require('./fixtures/settlement/fulfillment.cjs');const pg=new PGlite();
 try{
  for(const p of ['schema.sql','external-schema.sql'])await pg.exec(read('scripts/fixtures/settlement/'+p));
  await pg.exec(sourceSql());let artifact=read('docs/payments/drafts/settlement-runtime-pristine.sql');
  assert.ok(artifact.includes('-- SOURCE: docs/payments/drafts/settlement-fulfillment.sql'));
  await pg.exec(artifact);const controls=(await pg.query('SELECT checkout_enabled,transfers_enabled,recovery_enabled FROM dvnt_settlement.controls')).rows[0];assert.deepEqual(controls,{checkout_enabled:false,transfers_enabled:false,recovery_enabled:false});assert.equal((await pg.query('SELECT count(*)::int n FROM dvnt_settlement.fulfillments')).rows[0].n,0);
  for(const role of ['anon','authenticated','service_role'])assert.deepEqual((await pg.query("SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dvnt_settlement' AND has_function_privilege($1,p.oid,'EXECUTE')",[role])).rows,[]);
  assert.deepEqual((await pg.query("SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='dvnt_settlement' AND p.prosecdef AND NOT coalesce(p.proconfig @> ARRAY['search_path=\"\"'],false)")).rows,[]);
 }finally{await pg.close()}
});
test('reusable shared fixture issues through the canonical routine instead of seeding proof',async()=>{const f=await setup();try{
 const {issuePaidOrder}=require('./fixtures/settlement/issuance.cjs');assert.equal(await receiptCount(f),0);assert.equal((await issuePaidOrder(f.pg,f.p.order_id)).ok,true);assert.equal(await receiptCount(f),1);assert.equal((await issuePaidOrder(f.pg,f.p.order_id)).duplicate,true);await f.run();assert.equal(f.transfers.length,2);
}finally{await f.pg.close()}});

test('latest canonical paid-cart buyer cap failure cannot certify fulfillment or hide recovery',async()=>{const f=await setup({rail:'cart-checkout',quantity:2});try{
 await f.pg.exec('UPDATE ticket_types SET max_per_user=1');const failed=await f.issue();assert.equal(failed.ok,false);assert.equal(failed.capacity_reason,'buyer_limit');assert.equal(await receiptCount(f),0);await assert.rejects(f.run(),/fulfillment_required/);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');
 await f.pg.exec('UPDATE ticket_types SET max_per_user=2');assert.equal((await f.issue()).ok,true);await f.run();assert.equal(f.transfers.length,2);
}finally{await f.pg.close()}});
