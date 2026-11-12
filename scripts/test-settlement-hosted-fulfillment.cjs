const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {setup,read,TIER}=require('./fixtures/settlement/fulfillment.cjs');const {sessionAdapter}=require('./fixtures/settlement/session-adapter.cjs');
const scalar=async(f,q)=>(await f.pg.query(q)).rows[0].v;
const count=f=>scalar(f,'SELECT count(*)::int v FROM dvnt_settlement.fulfillments');
const rejected=(fn,pattern=/eligible|mismatch|reference/)=>assert.rejects(fn,e=>pattern.test(e.message));
for(const rail of ['ticket-checkout','guest-checkout'])test(`${rail}: actual adapter fetches captured final tax before real issuance, then settlement and replay`,async()=>{const f=await setup({rail,hostedPiUnknown:true});try{
 assert.equal(await scalar(f,'SELECT stripe_payment_intent_id v FROM orders'),null);
 const a=await sessionAdapter(f);assert.equal(await scalar(f,'SELECT total_cents v FROM orders'),11000);
 const stale={...a.session,amount_total:11000,total_details:{...a.session.total_details,amount_tax:0}};
 const result=await a.run(stale);assert.equal(result.issued,1);assert.equal(await scalar(f,'SELECT total_cents v FROM orders'),12000);assert.equal(await scalar(f,'SELECT tax_cents v FROM orders'),1000);assert.equal(await scalar(f,'SELECT stripe_payment_intent_id v FROM orders'),'pi_fixture');assert.equal(await count(f),1);
 assert.ok(a.calls.indexOf('prepare_settlement_hosted_issuance')<a.calls.indexOf('paid_ticket_issuance_atomic'));assert.ok(a.calls.indexOf('paid_ticket_issuance_atomic')<a.calls.indexOf('upsert_order_money_state'));
 assert.equal(await scalar(f,'SELECT sum(purchase_amount_cents)::int v FROM tickets'),12000);assert.equal(await scalar(f,'SELECT count(*)::int v FROM dvnt_settlement.orders'),0);
 const before=await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f');await f.run();assert.deepEqual(f.transfers.map(t=>t.amount),[1000,8500]);assert.equal((await a.run()).alreadyIssued,true);await f.run();assert.equal(f.transfers.length,2);assert.deepEqual(await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f'),before);
 assert.ok(a.deliveries.every(s=>s==='paid'));
}finally{await f.pg.close()}});
test('captured tax prep cannot infer paid or fulfillment when real inventory fails; actual adapter retry recovers',async()=>{const f=await setup({rail:'ticket-checkout',capacity:0});try{
 const a=await sessionAdapter(f);await rejected(a.run,/needs recovery/);assert.equal(await scalar(f,'SELECT total_cents v FROM orders'),12000);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');assert.equal(await scalar(f,'SELECT paid_at v FROM orders'),null);assert.equal(await count(f),0);
 assert.equal(await scalar(f,'SELECT count(*)::int v FROM dvnt_settlement.hosted_captures'),1);await rejected(f.run,/fulfillment_required/);assert.equal(f.transfers.length,0);assert.equal(await scalar(f,'SELECT source_verified_at v FROM dvnt_settlement.checkouts'),null);
 await f.pg.exec('UPDATE ticket_types SET quantity_total=100');assert.equal((await a.run()).issued,1);await f.run();assert.equal(f.transfers.length,2);
}finally{await f.pg.close()}});
test('hosted capture proof rejects wrong provider scope, tax, state and destination before any order mutation',async()=>{
 const faults={
  session:s=>s.session.id='cs_other',pi:s=>s.session.payment_intent='pi_other',charge:s=>s.intent.latest_charge='ch_other',
  metadata:s=>s.session.metadata.settlement_order_id=randomUUID(),tier:s=>s.session.metadata.ticket_type_id=randomUUID(),buyer:s=>s.session.metadata.user_id='other',
  currency:s=>s.session.currency='eur',subtotal:s=>s.session.amount_subtotal=10000,tax:s=>s.session.total_details.amount_tax=500,
  taxMissing:s=>delete s.session.total_details.amount_tax,discount:s=>s.session.total_details.amount_discount=1,shipping:s=>s.session.total_details.amount_shipping=1,
  pending:s=>s.session.payment_status='unpaid',partial:s=>s.intent.amount_received=11000,uncaptured:s=>s.charge.captured=false,
  refunded:s=>s.charge.refunded=true,disputed:s=>s.charge.disputed=true,destination:s=>s.intent.transfer_data={destination:'acct_other'},fee:s=>s.charge.application_fee='fee_other',
 };
 for(const [name,change] of Object.entries(faults)){const f=await setup({rail:'ticket-checkout'});try{
  const a=await sessionAdapter(f);const proof={session:structuredClone(a.session),intent:structuredClone(f.intent),charge:structuredClone(f.charge)};change(proof);
  await rejected(()=>f.call('prepare_settlement_hosted_issuance',{p_order_id:f.p.order_id,p_session:proof.session,p_intent:proof.intent,p_charge:proof.charge}));
  assert.equal(await scalar(f,'SELECT total_cents v FROM orders'),11000,name);assert.equal(await scalar(f,'SELECT tax_cents v FROM orders'),0,name);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending',name);assert.equal(await count(f),0,name);
 }finally{await f.pg.close()}}
});
test('current refunded/uncaptured provider reads stop the actual adapter before canonical issuance',async()=>{for(const fault of ['refunded','captured','disputed']){const f=await setup({rail:'ticket-checkout'});try{
 const a=await sessionAdapter(f);f.charge[fault]=fault!=='captured';await rejected(a.run,/eligible/);assert.equal(a.calls.includes('paid_ticket_issuance_atomic'),false);assert.equal(await count(f),0);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');
}finally{await f.pg.close()}}});
test('terminal orders and immutable captures/receipts cannot be changed by later tax proof',async()=>{const f=await setup({rail:'ticket-checkout'});try{
 const a=await sessionAdapter(f);await a.run();const receipt=await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f');
 a.session.amount_total=12500;a.session.total_details.amount_tax=1500;f.intent.amount=f.intent.amount_received=12500;f.charge.amount=f.charge.amount_captured=12500;
 await rejected(a.run,/immutable/);assert.equal(await scalar(f,'SELECT total_cents v FROM orders'),12000);assert.deepEqual(await scalar(f,'SELECT to_jsonb(f) v FROM dvnt_settlement.fulfillments f'),receipt);
 a.session.amount_total=12000;a.session.total_details.amount_tax=1000;f.intent.amount=f.intent.amount_received=12000;f.charge.amount=f.charge.amount_captured=12000;
 for(const state of ['refunded','partially_refunded','disputed','cancelled']){await f.pg.query('UPDATE orders SET status=$1',[state]);assert.equal((await a.run()).terminal,true);await rejected(()=>f.call('prepare_settlement_hosted_issuance',{p_order_id:f.p.order_id,p_session:a.session,p_intent:f.intent,p_charge:f.charge}),/eligible/);assert.equal(await scalar(f,'SELECT status v FROM orders'),state);}
}finally{await f.pg.close()}});
test('capture preparation is service-only, immutable and never sufficient to bypass the fulfillment gate',async()=>{const f=await setup({rail:'ticket-checkout',defaultGrants:true});try{
 const a=await sessionAdapter(f);const args={p_order_id:f.p.order_id,p_session:a.session,p_intent:f.intent,p_charge:f.charge};
 for(const role of ['anon','authenticated']){await f.pg.exec('SET ROLE '+role);await rejected(()=>f.call('prepare_settlement_hosted_issuance',args),/permission/);await f.pg.exec('RESET ROLE');}
 await f.pg.exec('SET ROLE service_role');assert.equal((await f.call('prepare_settlement_hosted_issuance',args)).ok,true);await rejected(()=>f.pg.exec("UPDATE dvnt_settlement.hosted_captures SET tax_cents=0"),/permission/);await f.pg.exec('RESET ROLE');
 await rejected(()=>f.pg.exec('DELETE FROM dvnt_settlement.hosted_captures'),/immutable/);await rejected(f.run,/fulfillment_required/);assert.equal(await count(f),0);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');assert.equal(f.transfers.length,0);
}finally{await f.pg.close()}});
for(const [label,spelling] of [['uppercase',x=>x.toUpperCase()],['compact',x=>x.replaceAll('-','')],['braced',x=>'{'+x.toUpperCase()+'}']]){
 test(`${label} UUID identity works on ticket and full cart scope without changing frozen snapshot`,async()=>{for(const rail of ['create-payment-intent','cart-checkout']){const f=await setup({rail,cartAddon:true,uuidSpelling:spelling});try{
  const frozen=structuredClone(f.snapshot);assert.equal((await f.issue()).ok,true);assert.equal(await count(f),1);await f.run();assert.equal(f.transfers.length,2);assert.deepEqual(await scalar(f,'SELECT snapshot v FROM dvnt_settlement.fulfillments'),frozen);
 }finally{await f.pg.close()}}});
}
test('malformed frozen UUIDs fail closed without retaining issuer writes',async()=>{const f=await setup({uuidSpelling:()=> 'not-a-uuid'});try{
 await rejected(f.issue,/uuid/);assert.equal(await count(f),0);assert.equal(await scalar(f,'SELECT count(*)::int v FROM tickets'),0);assert.equal(await scalar(f,'SELECT status v FROM orders'),'payment_pending');
}finally{await f.pg.close()}});
test('historical add-on binding must match exact original admission ticket before first receipt',async()=>{
 for(const fault of ['null','foreign-buyer','foreign-order','wrong-tier','addon-only-foreign']){const f=await setup({rail:'cart-checkout',cartAddon:true,secondAdmission:fault==='wrong-tier',addonOnly:fault==='addon-only-foreign',installGate:false});try{
  assert.equal((await f.issue()).ok,true);let target=null;
  if(fault==='wrong-tier')target=(await f.pg.query('SELECT id FROM tickets WHERE ticket_type_id=$1',[TIER])).rows[0].id;
  else if(fault!=='null'){target=randomUUID();await f.pg.query("INSERT INTO tickets(id,event_id,ticket_type_id,user_id,status,qr_token,qr_payload,order_id,cart_id) VALUES($1,1,$2,$3,'active','foreign-qr','foreign-signed',$4,$5)",[target,TIER,fault==='foreign-order'?'fixture-buyer':'foreign-buyer',null,null]);}
  await f.pg.query('UPDATE order_addons SET ticket_id=$1',[target]);await f.pg.exec(read('docs/payments/drafts/settlement-fulfillment.sql'));
  await rejected(f.issue,/fulfillment_required/);assert.equal(await count(f),0,fault);await rejected(f.run,/fulfillment_required/);assert.equal(f.transfers.length,0,fault);
 }finally{await f.pg.close()}}
});
test('canonical required-tier binding and addon-only unbound entitlement are journaled exactly',async()=>{for(const addonOnly of [false,true]){const f=await setup({rail:'cart-checkout',cartAddon:true,addonOnly,secondAdmission:!addonOnly});try{
 await f.issue();const receipt=await scalar(f,'SELECT entitlements v FROM dvnt_settlement.fulfillments');const ids=(await f.pg.query('SELECT DISTINCT ticket_id FROM order_addons')).rows.map(x=>x.ticket_id);assert.equal(ids.length,1);
 if(addonOnly)assert.equal(ids[0],null);else assert.equal((await f.pg.query('SELECT ticket_type_id FROM tickets WHERE id=$1',[ids[0]])).rows[0].ticket_type_id,f.secondTier);
 assert.ok(receipt.addons.every(a=>a.ticket_id===ids[0]));await f.pg.exec("UPDATE tickets SET user_id='recipient',status='scanned'; UPDATE order_addons SET user_id='recipient',status='redeemed';");await f.run();assert.equal(f.transfers.length,2);
}finally{await f.pg.close()}}});
test('processing reason whitelist retains both fulfillment and runtime budget attention',async()=>{const f=await setup();try{for(const code of ['fulfillment_required','runtime_budget_required']){await f.call('settlement_processing_error',{p_order_id:f.p.order_id,p_code:code});assert.equal(await scalar(f,'SELECT last_error v FROM dvnt_settlement.checkouts'),code);}}finally{await f.pg.close()}});
