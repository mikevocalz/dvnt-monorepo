const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('./payment-safety.test.cjs');
const {fixture}=require('../guest-checkout/discounts-fixture.cjs');
const selection={event_id:1,ticket_type_id:'tier',quantity:1};
for(const rail of ['ticket-checkout','create-payment-intent','cart-checkout']) {
 test(`${rail}: paid order and Stripe metadata remain destination funded`,async()=>{
  const h=harness({cart:rail==='cart-checkout'});
  const r=await h.invoke(rail,rail==='cart-checkout'?{cartId:'11111111-1111-4111-8111-111111111111'}:selection);
  assert.equal(r.status,200,await r.text());
  assert.equal(h.writes.find(w=>w.table==='orders').payload.charge_model,'destination_charge');
  const p=h.requests.find(r=>r.body.has('metadata[charge_model]')).body;
  assert.equal(p.get('metadata[charge_model]'),'destination_charge');
  const hosted=rail==='ticket-checkout';
  assert.equal(p.get(hosted?'payment_intent_data[transfer_data][destination]':'transfer_data[destination]'),'acct_test');
  if(hosted)assert.equal(p.get('payment_intent_data[metadata][charge_model]'),'destination_charge');
 });
}
test('guest paid order, session and underlying PI all stamp destination',async()=>{
 const f=fixture();const r=await f.pay();assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(f.tables.orders[0].charge_model,'destination_charge');
 const p=f.stripe[0].params;
 assert.equal(p['metadata[charge_model]'],'destination_charge');
 assert.equal(p['payment_intent_data[metadata][charge_model]'],'destination_charge');
 assert.equal(p['payment_intent_data[transfer_data][destination]'],'acct_fixture');
});
function database({model=null,failWrite=false,failRead=false}={}) {
 const tier={id:'tier',event_id:1,name:'Admission',price_cents:5000,currency:'usd',quantity_total:100,quantity_sold:0,max_per_user:20};
 return {rpc:async()=>({data:{ok:true}}),from(table){
  let op='read';
  const value=()=>({data:table==='ticket_types'?tier:table==='events'?{host_id:'staff',title:'Test',fee_mode:'pass'}:
   table==='organizer_accounts'?{stripe_account_id:'acct_test',charges_enabled:true}:
   table==='carts'?{id:'cart',user_id:'staff',event_id:1,status:'holding',currency:'usd',idempotency_key:'test'}:
   table==='cart_line_items'?[{id:'line',tier_id:'tier',category:'admission',quantity:1,ticket_types:tier}]:
   table==='cart_holds'?[{line_item_id:'line',expires_at:new Date(Date.now()+600000).toISOString()}]:
   table==='orders'?{id:'order',charge_model:model}:[],count:0,
   error:table==='orders'&&((op==='read'&&failRead)||(op!=='read'&&failWrite))?{message:'fixture persistence failure'}:null});
  const q={};for(const key of ['select','eq','gt','in','ilike','not','order'])q[key]=()=>q;
  for(const key of ['insert','update','upsert'])q[key]=()=>{op=key;return q};
  q.single=q.maybeSingle=async()=>value();q.then=(yes,no)=>Promise.resolve(value()).then(yes,no);return q;
 }};
}
for(const rail of ['ticket-checkout','create-payment-intent','cart-checkout'])test(`${rail}: order persistence failure releases no payment capability`,async()=>{
 const h=harness({database:database({failWrite:true})});
 const r=await h.invoke(rail,rail==='cart-checkout'?{cartId:'11111111-1111-4111-8111-111111111111'}:selection);
 assert.equal(r.status,500);const body=await r.json();
 for(const key of ['url','clientSecret','paymentIntent','paymentIntentId','session_id'])assert.equal(body[key],undefined);
 assert.ok(h.requests.some(r=>r.body.has('metadata[charge_model]')),'reached real paid order write');
});
for(const [label,opts,status] of [['legacy NULL',{model:null},200],['matching destination',{model:'destination_charge'},200],['conflicting separate',{model:'separate_charges_and_transfers'},409],['read failure',{failRead:true},500]])test(`cart replay: ${label}`,async()=>{
 const h=harness({database:database(opts)});const r=await h.invoke('cart-checkout',{cartId:'11111111-1111-4111-8111-111111111111'});
 assert.equal(r.status,status,await r.text());if(status!==200)assert.equal(h.requests.length,0);
});
test('guest persistence exception releases no payment URL',async()=>{
 const f=fixture();f.tables.orders.push=()=>{throw new Error('fixture order persistence failed')};
 const r=await f.pay();assert.equal(r.status,500);assert.equal(r.data.url,undefined);
 assert.equal(f.stripe.length,1,'reached paid order persistence after creating session');
});
