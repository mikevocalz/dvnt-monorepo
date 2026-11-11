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
function database({model=null,failWrite=false,failRead=false,rpcHandler=null}={}) {
 const tier={id:'tier',event_id:1,name:'Admission',price_cents:5000,currency:'usd',quantity_total:100,quantity_sold:0,max_per_user:20};
 return {rpc:async(name,args)=>rpcHandler?rpcHandler(name,args):({data:name==='lookup_settlement_checkout'?{exists:false}:{ok:true}}),from(table){
  let op='read';
  const value=()=>({data:table==='ticket_types'?tier:table==='events'?{host_id:'staff',title:'Test',fee_mode:'pass'}:
   table==='organizer_accounts'?{stripe_account_id:'acct_test',charges_enabled:true}:
   table==='carts'?{id:'cart',user_id:'staff',event_id:1,status:'holding',currency:'usd',idempotency_key:'cart-fixture-attempt-001'}:
   table==='cart_line_items'?[{id:'line',tier_id:'tier',category:'admission',quantity:1,ticket_types:tier}]:
   table==='cart_holds'?[{line_item_id:'line',expires_at:new Date(Date.now()+600000).toISOString()}]:
   table==='orders'?(rpcHandler?null:{id:'order',charge_model:model}):[],count:0,
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
function settlementFixture(options={}) {
 const orderId='22222222-2222-4222-8222-222222222222';const calls=[];let snapshot;
 const rpcHandler=async(name,args)=>{
  calls.push({name,args});
  if(name==='lookup_settlement_checkout')return options.lookupError?{error:options.lookupError}:{data:{exists:!!options.exists}};
  if(name==='prepare_settlement_checkout'){
   snapshot=args.p_snapshot;
   return{data:options.prepareFailure?{ok:false}:{ok:true,order_id:orderId,charge_model:'separate_charges_and_transfers',
    idempotency_key:'settlement:'+orderId,created_at:new Date().toISOString(),...options.refs}};
  }
  if(name==='claim_settlement_checkout')return{data:{ok:true,claimed:!options.claimFailure,idempotency_key:'settlement:'+orderId}};
  if(name==='finalize_settlement_checkout')return{data:{ok:!options.finalizeFailure}};
  return{data:{ok:true}};
 };
 const stripeFetch=async(url,init)=>{
  if(!url.includes('/payment_intents')&&!url.includes('/checkout/sessions'))return Response.json({id:'cus_fixture',secret:'ephemeral'});
  const params=new URLSearchParams(init.body);const hosted=url.includes('/checkout/sessions');
  if(init.method==='POST')assert.equal(init.headers['Idempotency-Key'],'settlement:'+orderId);
  const data={id:hosted?'cs_fixture':'pi_fixture',currency:'usd',status:hosted?'open':'requires_payment_method',
   metadata:{charge_model:'separate_charges_and_transfers',settlement_order_id:options.wrongMetadata?'wrong':orderId},
   amount:snapshot.order.total_cents,amount_subtotal:snapshot.order.total_cents,amount_total:snapshot.order.total_cents,
   total_details:{amount_tax:0,amount_discount:0,amount_shipping:0},url:'https://checkout.stripe.com/fixture',client_secret:'fixture-secret'};
  return Response.json({...data,...options.providerOverride});
 };
 return{calls,rpcHandler,stripeFetch,get snapshot(){return snapshot}};
}
for(const rail of ['ticket-checkout','create-payment-intent','cart-checkout'])test(`${rail}: enabled adapter reserves, claims and links without destination routing`,async()=>{
 const f=settlementFixture();const h=harness({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},database:database({rpcHandler:f.rpcHandler}),stripeFetch:f.stripeFetch});
 const r=await h.invoke(rail,rail==='cart-checkout'?{cartId:'11111111-1111-4111-8111-111111111111'}:{...selection,idempotency_key:'paid-attempt-fixture-001'});
 assert.equal(r.status,200,await r.text());
 const paid=h.requests.find(x=>x.url.endsWith('/payment_intents')||x.url.endsWith('/checkout/sessions'));
 const p=paid.body;
 for(const key of ['transfer_data[destination]','application_fee_amount','payment_intent_data[transfer_data][destination]','payment_intent_data[application_fee_amount]'])assert.equal(p.has(key),false);
 assert.equal(p.get('metadata[charge_model]'),'separate_charges_and_transfers');
 assert.equal(p.get('metadata[settlement_order_id]'),'22222222-2222-4222-8222-222222222222');
 assert.deepEqual(f.calls.filter(c=>c.name.includes('settlement_checkout')).map(c=>c.name),['prepare_settlement_checkout','claim_settlement_checkout','finalize_settlement_checkout']);
 assert.equal(h.writes.filter(w=>w.table==='orders').length,0);
 assert.equal(f.snapshot.order.currency,'usd');assert.equal(f.snapshot.order.stripe_payment_intent_id,undefined);
 if(rail==='cart-checkout')assert.equal(f.snapshot.selection.lines[0].tier_id,'tier');
 else assert.equal(f.snapshot.selection.ticket_type_id,'tier');
});
for(const [name,options] of [['ambiguous claim',{claimFailure:true}],['prepare failure',{prepareFailure:true}],['link failure',{finalizeFailure:true}],['wrong metadata',{wrongMetadata:true}],['routed provider',{providerOverride:{transfer_data:{destination:'acct_wrong'}}}]])test(`separate PI fails closed: ${name}`,async()=>{
 const f=settlementFixture(options);const h=harness({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},database:database({rpcHandler:f.rpcHandler}),stripeFetch:f.stripeFetch});
 const r=await h.invoke('create-payment-intent',{...selection,idempotency_key:'paid-attempt-fixture-001'});
 assert.equal(r.status,409);assert.equal((await r.json()).paymentIntent,undefined);
 if(options.claimFailure||options.prepareFailure)assert.ok(!h.requests.some(x=>x.url.endsWith('/payment_intents')));
});
test('enabled missing request key never creates a provider payment',async()=>{
 const f=settlementFixture();const h=harness({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},database:database({rpcHandler:f.rpcHandler}),stripeFetch:f.stripeFetch});
 const r=await h.invoke('create-payment-intent',selection);assert.equal(r.status,409);
 assert.ok(!h.requests.some(x=>x.url.endsWith('/payment_intents')));
});
test('guest enabled prepares durable order, claims once and finalizes before releasing URL',async()=>{
 const f=settlementFixture();const g=fixture({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},settlementRpc:f.rpcHandler,stripeResponse:f.stripeFetch});
 const r=await g.pay({idempotency_key:'guest-paid-attempt-fixture-001'});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(g.tables.orders.length,0,'only the durable RPC creates the paid order');
 const p=g.stripe[0].params;assert.equal(p['metadata[charge_model]'],'separate_charges_and_transfers');
 assert.equal(p['payment_intent_data[metadata][settlement_order_id]'],'22222222-2222-4222-8222-222222222222');
 assert.equal(p['payment_intent_data[transfer_data][destination]'],undefined);
 assert.deepEqual(f.calls.filter(c=>c.name.includes('settlement_checkout')).map(c=>c.name),['prepare_settlement_checkout','claim_settlement_checkout','finalize_settlement_checkout']);
});
for(const [label,opts] of [['already claimed',{claimFailure:true}],['link failed',{finalizeFailure:true}]])test(`guest enabled ${label} never releases URL`,async()=>{
 const f=settlementFixture(opts);const g=fixture({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},settlementRpc:f.rpcHandler,stripeResponse:f.stripeFetch});
 const r=await g.pay({idempotency_key:'guest-paid-attempt-fixture-001'});assert.equal(r.status,409);assert.equal(r.data.url,undefined);
 if(opts.claimFailure)assert.equal(g.stripe.length,0);
});
for(const rail of ['ticket-checkout','create-payment-intent'])test(`${rail}: linked member retry retrieves saved provider without claiming or posting again`,async()=>{
 const refs=rail==='ticket-checkout'?{stripe_checkout_session_id:'cs_fixture'}:{stripe_payment_intent_id:'pi_fixture'};
 const f=settlementFixture({refs});const h=harness({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},database:database({rpcHandler:f.rpcHandler}),stripeFetch:f.stripeFetch});
 const r=await h.invoke(rail,{...selection,idempotency_key:'paid-attempt-fixture-001'});assert.equal(r.status,200,await r.text());
 assert.ok(!f.calls.some(c=>c.name==='claim_settlement_checkout'));
 assert.ok(!h.requests.some(x=>x.url.endsWith('/payment_intents')||x.url.endsWith('/checkout/sessions')));
});
for(const [label,options,expected] of [['flag rollback existing SCT',{exists:true},409],['lookup outage',{lookupError:{code:'08006'}},409],['missing migration',{lookupError:{code:'PGRST202'}},200],['no prior SCT',{},200]])test(`disabled rollout: ${label}`,async()=>{
 const f=settlementFixture(options);const h=harness({database:database({rpcHandler:f.rpcHandler})});
 const r=await h.invoke('ticket-checkout',{...selection,idempotency_key:'paid-attempt-fixture-001'});assert.equal(r.status,expected,await r.text());
 if(expected===409)assert.ok(!h.requests.some(x=>x.url.endsWith('/checkout/sessions')));
 else assert.equal(h.requests.find(x=>x.url.endsWith('/checkout/sessions')).body.get('metadata[charge_model]'),'destination_charge');
});
for(const [label,providerOverride] of [['tax mismatch',{amount_total:999999}],['unexpected discount',{total_details:{amount_tax:0,amount_discount:100,amount_shipping:0}}],['unexpected shipping',{total_details:{amount_tax:0,amount_discount:0,amount_shipping:100}}],['wrong currency',{currency:'eur'}],['closed session',{status:'expired'}]])test(`hosted verification rejects ${label}`,async()=>{
 const f=settlementFixture({providerOverride});const h=harness({env:{TICKET_SEPARATE_CHARGES_ENABLED:'true'},database:database({rpcHandler:f.rpcHandler}),stripeFetch:f.stripeFetch});
 const r=await h.invoke('ticket-checkout',{...selection,idempotency_key:'paid-attempt-fixture-001'});assert.equal(r.status,409);assert.equal((await r.json()).url,undefined);
 assert.ok(!f.calls.some(c=>c.name==='finalize_settlement_checkout'));
});
