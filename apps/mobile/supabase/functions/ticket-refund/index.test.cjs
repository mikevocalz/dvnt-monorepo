const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, ID } = require('./test-fixture.cjs');

test('free cancellation uses authenticated atomic RPC, not Stripe or split writes, without Stripe config', async () => {
  const f = fixture({ noStripe: true });
  const response = await f.invoke();
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs)), [{name:'cancel_free_ticket',args:{p_ticket_id:ID,p_user_id:'buyer'}}]);
  assert.equal(f.writes.length,0); assert.equal(f.stripe.length,0);
  assert.deepEqual(f.wallets,[ID]); assert.equal(f.waitlists.length,1);
  assert.equal((await response.json()).stripe_refund_id,null);
});

test('repeat and concurrent endpoint cancellations notify and release only once', async () => {
  const f = fixture();
  const responses = await Promise.all(Array.from({length:8},()=>f.invoke()));
  for (const r of responses) assert.equal(r.status,200,await r.clone().text());
  assert.equal(f.wallets.length,1); assert.equal(f.waitlists.length,1); assert.equal(f.stripe.length,0);
  assert.equal((await (await f.invoke()).json()).already_cancelled,true);
  assert.equal(f.wallets.length,1);
});

for (const [label, options] of [
  ['paid',{ticket:{purchase_amount_cents:1000}}], ['unknown amount',{ticket:{purchase_amount_cents:null}}],
  ['negative',{ticket:{purchase_amount_cents:-1}}], ['string zero',{ticket:{purchase_amount_cents:'0'}}],
  ['scanned',{ticket:{status:'scanned'}}], ['checked in',{ticket:{checked_in_at:'2026-01-01'}}],
  ['transferred',{ticket:{transferred_from:'sender'}}], ['pending transfer',{ticket:{status:'transfer_pending'}}],
  ['cart line',{ticket:{cart_line_item_id:'line'}}], ['actual cart',{order:{cart_id:'cart'}}],
  ['unverified group',{ticket:{order_id:null,cart_id:'group'}}],
  ['different buyer',{order:{user_id:'someone'}}], ['paid add-ons/order',{order:{total_cents:500}}],
  ['unknown order total',{order:{total_cents:null}}], ['refunded order',{order:{status:'refunded'}}],
  ['missing order',{tables:{orders:[]}}], ['missing event',{tables:{events:[]}}],
  ['invalid date',{event:{start_date:'bad'}}], ['too late',{event:{start_date:new Date(Date.now()+864e5).toISOString()}}],
  ['no refunds',{event:{refund_policy:'none'}}],
  ['days before cutoff',{event:{refund_policy:'days_before',refund_days_before:11}}],
]) test(`free cancellation rejects ${label} without any mutation`, async () => {
  const f=fixture(options); const r=await f.invoke();
  assert.equal(r.status,409,await r.clone().text());
  assert.equal(f.rpcs.length,0);assert.equal(f.stripe.length,0);assert.equal(f.writes.length,0);
});

test('free synthetic grouping and tier-less legacy ticket cancellation remain supported', async () => {
  for(const ticket of [{cart_id:'synthetic-group'}, {ticket_type_id:null,order_id:null}]) {
    const f=fixture({ticket});assert.equal((await f.invoke()).status,200);assert.equal(f.stripe.length,0);
  }
});

test('wrong owner and unauthenticated calls do not reach cancellation RPC', async () => {
  for(const [options,status] of [[{auth:null},401],[{ticket:{user_id:'other'}},403]]) {
    const f=fixture(options);assert.equal((await f.invoke()).status,status);assert.equal(f.rpcs.length,0);
  }
});

test('database/lookup failure fails closed with no REST fallback and no success notifications', async () => {
  for(const options of [{rpcError:{code:'PGRST202',message:'missing migration'}},
    {rpcError:{code:'23514',message:'rollback'}}, {readError:'orders'}, {readError:'events'}]) {
    const f=fixture(options);assert.equal((await f.invoke()).status,503);
    assert.equal(f.writes.length,0);assert.equal(f.wallets.length,0);assert.equal(f.waitlists.length,0);assert.equal(f.stripe.length,0);
  }
  const f=fixture({rpcResult:{ok:false,error:'ticket_changed'}});
  assert.equal((await f.invoke()).status,409);assert.equal(f.wallets.length,0);
});

test('post-commit notification failure does not report cancellation failure', async () => {
  const f=fixture({notificationError:true});assert.equal((await f.invoke()).status,200);
  assert.equal(f.tables.tickets[0].status,'void');assert.equal(f.waitlists.length,1);
});

test('legacy refund is never allowed to silently void a zero or unknown ticket', async () => {
  for(const cents of [0,null,-1,'0']) {
    const f=fixture({ticket:{purchase_amount_cents:cents}});
    assert.equal((await f.invoke({ticket_id:ID})).status,409);assert.equal(f.stripe.length,0);assert.equal(f.writes.length,0);assert.equal(f.rpcs.length,0);
  }
});

test('valid paid refund keeps partial Stripe amount, destination-charge reversals and metadata', async () => {
  const f=fixture({ticket:{purchase_amount_cents:2500,stripe_payment_intent_id:'pi_paid'}});
  assert.equal((await f.invoke({ticket_id:ID})).status,200);
  assert.equal(f.stripe.length,1);
  const p=f.stripe[0].body;
  assert.equal(p.get('amount'),'2500');assert.equal(p.get('payment_intent'),'pi_paid');
  assert.equal(p.get('refund_application_fee'),'true');assert.equal(p.get('reverse_transfer'),'true');
  assert.equal(p.get('metadata[ticket_id]'),ID);assert.equal(f.tables.tickets[0].status,'refunded');
});

test('unsupported actions cannot trigger the monetary path',async()=>{
  const f=fixture(); assert.equal((await f.invoke({ticket_id:ID,action:'anything'})).status,400);
  assert.equal(f.stripe.length,0);assert.equal(f.rpcs.length,0);
});

test('completed cancellation retries survive elapsed cutoff and changed refund policy', async()=>{
  const f=fixture(); assert.equal((await f.invoke()).status,200);
  f.tables.events[0].start_date=new Date(Date.now()-864e5).toISOString();
  f.tables.events[0].refund_policy='none';
  const response=await f.invoke();assert.equal(response.status,200);
  assert.equal((await response.json()).already_cancelled,true);
  assert.equal(f.wallets.length,1);assert.equal(f.waitlists.length,1);assert.equal(f.stripe.length,0);
});

for(const [label,override] of [
 ['transferred recipient',{ticket:{transferred_from:'sender'}}],
 ['cart line',{ticket:{cart_id:'cart',cart_line_item_id:'line'}}],
 ['cart-group ambiguity',{ticket:{cart_id:'group'}}],
 ['original order buyer mismatch',{order:{user_id:'other'}}],
 ['order event mismatch',{order:{event_id:2}}],
 ['cart order',{order:{cart_id:'cart'}}],
 ['missing order',{tables:{orders:[]}}],
 ['disputed order',{order:{status:'disputed'}}],
])test(`paid single-ticket refund refuses ${label} before Stripe`,async()=>{
 const f=fixture({...override,ticket:{purchase_amount_cents:2500,stripe_payment_intent_id:'pi_paid',...override.ticket}});
 assert.equal((await f.invoke({ticket_id:ID})).status,409);assert.equal(f.stripe.length,0);assert.equal(f.writes.length,0);
});
