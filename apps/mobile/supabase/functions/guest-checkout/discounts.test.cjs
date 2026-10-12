const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {fixture,checkoutWith,stripeTotal,promo,promoter,TIER,PROMO,PROMOTER,EMAIL,ROOT}=require('./discounts-fixture.cjs');

test('quote is read-only, requires no profile and no Stripe configuration',async()=>{
 const f=fixture({noStripe:true});const r=await f.quote({guest_email:''});assert.equal(r.status,200);
 assert.equal(r.data.quote.total_cents,3175);assert.equal(r.data.quote.buyer_fee_cents,175);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
});
test('no-code checkout retains the canonical price and fee',async()=>{
 const f=fixture();const {q,paid}=await checkoutWith(f,{});assert.equal(paid.status,200);
 assert.equal(stripeTotal(f.stripe[0].params),q.total_cents);assert.equal(q.total_cents,3175);
 assert.equal(f.tables.orders[0].total_cents,3175);assert.equal(f.tables.orders[0].status,'payment_pending');
});
test('a guest can type a promo: server quote, actual Stripe lines and order all agree',async()=>{
 const f=fixture({promos:[promo()]});const {q,paid}=await checkoutWith(f,{discount_code:'  save10  '});
 assert.equal(paid.status,200);assert.equal(q.promo_code,'SAVE10');assert.equal(q.discount_cents,300);assert.equal(q.total_cents,2868);
 assert.equal(stripeTotal(f.stripe[0].params),2868);assert.equal(f.tables.orders[0].total_cents,2868);
 assert.equal(f.tables.orders[0].promo_code_id,PROMO);assert.equal(f.stripe[0].params['metadata[promo_code_id]'],PROMO);
 assert.equal(f.stripe[0].params['payment_intent_data[metadata][promo_code_id]'],PROMO);assert.equal(f.usage.length,0,'usage belongs to confirmed-payment issuance');
});
test('manual promoter code discounts the buyer and preserves the locked commission policy',async()=>{
 const f=fixture({promoters:[promoter()]});const {q}=await checkoutWith(f,{discount_code:'share10'});
 assert.equal(q.code_kind,'promoter');assert.equal(q.total_cents,2868);assert.equal(f.tables.orders[0].promoter_code,'SHARE10');
 assert.equal(f.tables.orders[0].promoter_discount_amount_cents,300);assert.equal(f.tables.orders[0].promoter_commission_amount_cents,270);
 assert.equal(f.stripe[0].params['metadata[dvnt_promoter_code]'],'SHARE10');
});
test('tracked ref uses the same buyer discount, manual promoter replaces it',async()=>{
 const f=fixture({promoters:[promoter(),promoter({id:'other',code:'OTHER',customer_discount_bps:2000})]});
 const auto=await f.quote({promoter_code:'SHARE10'});assert.equal(auto.data.quote.discount_cents,300);
 const {q}=await checkoutWith(f,{promoter_code:'SHARE10',discount_code:'OTHER'});assert.equal(q.promoter_code,'OTHER');assert.equal(q.discount_cents,600);
});
test('normal promo plus tracked promoter follows the existing sequential discount policy',async()=>{
 const f=fixture({promos:[promo()],promoters:[promoter()]});const r=await f.quote({discount_code:'SAVE10',promoter_code:'SHARE10'});
 assert.equal(r.data.quote.discount_cents,570);assert.equal(r.data.quote.total_cents,2591);
});
test('an exact promo match takes precedence over a same-string promoter',async()=>{
 const f=fixture({promos:[promo()],promoters:[promoter({code:'SAVE10',customer_discount_bps:5000})]});
 const r=await f.quote({discount_code:'SAVE10'});assert.equal(r.data.quote.code_kind,'promo');assert.equal(r.data.quote.discount_cents,300);
});
for(const [name,patch] of [['expired',{valid_until:'2000-01-01'}],['not started',{valid_from:'2099-01-01'}],
 ['redeemed',{max_uses:1,uses_count:1}],['wrong tier',{ticket_type_id:'other-tier'}]])
 test(name+' promo is never silently ignored or replaced by a promoter',async()=>{
  const f=fixture({promos:[promo(patch)],promoters:[promoter({code:'SAVE10'})]});
  const r=await f.quote({discount_code:'SAVE10'});assert.equal(r.status,400);assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);
 });
test('revoked, cross-event, and invalid codes never start a payment',async()=>{
 for(const p of [promo({deleted_at:'2026-01-01'}),promo({event_id:2}),null]){
  const f=fixture({promos:p?[p]:[]});const r=await f.pay({discount_code:'SAVE10',expected_quote_key:'old'});
  assert.equal(r.status,400);assert.equal(f.stripe.length,0);assert.equal(f.writes.length,0);
 }
});
test('literal underscores cannot redeem a different code',async()=>{
 const f=fixture({promos:[promo({code:'TREX1',discount_value:90}),promo({code:'TRE_1',discount_value:10})]});
 const r=await f.quote({discount_code:'TRE_1'});assert.equal(r.status,200);assert.equal(r.data.quote.discount_cents,300);
});
test('per-buyer promo cap uses the guest email and refuses unreadable counts',async()=>{
 const f=fixture({promos:[promo({max_per_user:1})]});f.tables.orders.push({id:'past',promo_code_id:PROMO,status:'paid',guest_email:EMAIL});
 assert.equal((await f.quote({discount_code:'SAVE10'})).status,400);
 const fail=fixture({promos:[promo({max_per_user:1})],readError:'orders'});
 assert.equal((await fail.quote({discount_code:'SAVE10'})).status,400);assert.equal(fail.stripe.length,0);
});
test('BOGO receives quantity, and odd-cent fixed discounts exactly match the Stripe sum',async()=>{
 const bogo=fixture({promos:[promo({discount_type:'bogo'})]});const b=await checkoutWith(bogo,{discount_code:'SAVE10',quantity:3});
 assert.equal(b.q.discount_cents,3000);assert.equal(b.q.total_cents,6450);
 const f=fixture({promos:[promo({discount_type:'fixed_cents',discount_value:1001})]});
 const {q}=await checkoutWith(f,{discount_code:'SAVE10',quantity:3});assert.equal(q.net_subtotal_cents,7999);
 assert.equal(stripeTotal(f.stripe[0].params),q.total_cents);assert.equal(q.total_cents,8499);
});
test('absorb fees are honored after discount',async()=>{
 const f=fixture({feeMode:'absorb',promos:[promo()]});const {q}=await checkoutWith(f,{discount_code:'SAVE10'});
 assert.equal(q.buyer_fee_cents,0);assert.equal(q.total_cents,2700);assert.equal(stripeTotal(f.stripe[0].params),2700);
});
test('fully discounted guests use existing inventory, QR, order and email issuance once',async()=>{
 const f=fixture({promos:[promo({discount_value:100})]});const input={discount_code:'SAVE10',idempotency_key:'fixture-free-attempt'};
 const {q,paid}=await checkoutWith(f,input);assert.equal(q.total_cents,0);assert.equal(paid.data.free,true);assert.equal(f.stripe.length,0);
 assert.equal(f.tables.tickets.length,1);assert.equal(f.emails.length,1);assert.equal(f.usage.length,1);assert.equal(f.tables.orders[0].promo_code_id,PROMO);
 const replay=await f.pay(input);assert.equal(replay.data.free,true);assert.equal(f.tables.tickets.length,1);assert.equal(f.usage.length,1);
});
test('changed quote or unapplied code cannot silently charge another total',async()=>{
 const f=fixture({promos:[promo()]});const q=await f.quote({discount_code:'SAVE10'});
 f.tables.promo_codes[0].discount_value=20;
 const changed=await f.pay({discount_code:'SAVE10',expected_quote_key:q.data.quote.quote_key});assert.equal(changed.status,409);
 const missing=await f.pay({discount_code:'SAVE10'});assert.equal(missing.status,409);
 assert.equal(f.stripe.length,0);assert.equal(f.writes.length,0);
});
test('quote scope includes buyer, quantity, tier, event, both codes and sheet generation',()=>{
 const f=fixture();const {guestQuoteSelectionKey,guestQuoteReady,isGuestCheckoutQuote}=f.load(path.join(ROOT,'packages/app/lib/tickets/guest-checkout-quote.ts'));
 const quote={pricing_version:'guest-discounts-v1',quote_key:'a'.repeat(64),subtotal_cents:3000,discount_cents:300,
 net_subtotal_cents:2700,buyer_fee_cents:168,total_cents:2868,currency:'USD',manual_code:'SAVE10',promo_code:'SAVE10',promoter_code:null,code_kind:'promo'};
 const base={requestKey:'one',eventId:'1',tierId:TIER,quantity:1,email:EMAIL,discountCode:'SAVE10',trackedPromoterCode:'',quoteRevision:0,
 quote,quoteSelectionKey:'',quoteLoading:false,quoteError:null,codeDraft:'save10'};
 base.quoteSelectionKey=guestQuoteSelectionKey(base);assert.equal(guestQuoteReady(base),true);assert.equal(isGuestCheckoutQuote(quote),true);
 for(const change of [{eventId:'2'},{tierId:'other'},{quantity:2},{email:'other@fixture.example'},{requestKey:'new'},
  {discountCode:'OTHER'},{trackedPromoterCode:'OTHER'},{quoteRevision:1},{codeDraft:'unapplied'},
  {quoteLoading:true},{quoteError:'Rejected'},{quote:null}])assert.equal(guestQuoteReady({...base,...change}),false,JSON.stringify(change));
 assert.equal(isGuestCheckoutQuote({...quote,total_cents:1}),false);assert.equal(isGuestCheckoutQuote({ok:true,url:'old'}),false);
});
test('quantity, access and malformed quote envelopes fail without writes',async()=>{
 for(const quantity of [0,1.5,11,'bad']){const f=fixture();assert.equal((await f.quote({quantity})).status,400);assert.equal(f.writes.length,0)}
 for(const event of [{visibility:'private'},{is_hidden:true},{publish_at:'2099-01-01'}]){const f=fixture({event});assert.equal((await f.quote()).status,404);assert.equal(f.writes.length,0)}
 const f=fixture();assert.equal((await f.call({action:'quote'})).status,400);assert.equal((await f.call({},'GET')).status,405);assert.equal(f.writes.length,0);
});

test('free-order replay is scoped to the original guest, event and quantity',async()=>{
 const f=fixture({promos:[promo({discount_value:100})]});const input={discount_code:'SAVE10',idempotency_key:'scope-fixture'};
 await checkoutWith(f,input);
 for(const changed of [{guest_email:'other@fixture.example'},{event_id:2},{quantity:2}]){
  const r=await f.pay({...input,...changed});assert.equal(r.status,409);assert.equal(r.data.ok,false);
 }
 assert.equal(f.tables.tickets.length,1);assert.equal(f.usage.length,1);
});
test('a paid or still-issuing replay is never reported as a completed free purchase',async()=>{
 for(const order of [{id:'pending',status:'payment_pending',total_cents:3000},{id:'issuing',status:'paid',total_cents:0}]){
  const f=fixture();f.tables.orders.push({...order,quantity:1,guest_email:EMAIL,event_id:1,idempotency_key:'incomplete-fixture'});
  const r=await f.pay({idempotency_key:'incomplete-fixture'});assert.equal(r.status,409);assert.equal(f.stripe.length,0);
 }
});
