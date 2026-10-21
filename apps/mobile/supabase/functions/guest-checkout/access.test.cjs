// Real handler, projected database rows, fixture-only payments and mail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, promo, TIER, EMAIL } = require('./discounts-fixture.cjs');

const denied = [
  ['draft', {status:'draft'}], ['suspended', {status:'suspended'}], ['postponed', {status:'postponed'}],
  ['cancelled', {status:'cancelled'}], ['canceled', {status:'canceled'}],
  ['unknown status', {status:'unknown'}], ['missing status', {status:null}],
  ['paid ticketing disabled', {ticketing_enabled:false}], ['ticketing unset', {ticketing_enabled:null}],
  ['spicy', {nsfw:true}], ['private', {visibility:'private'}],
  ['link only', {visibility:'link_only'}], ['hidden', {is_hidden:true}],
  ['future publication', {publish_at:'2099-01-01'}],
  ['closed sales', {end_date:'2000-01-01'}],
];
for (const [label,event] of denied) {
  test(`${label}: anonymous quote, paid and free checkout stop before side effects`, async()=>{
    for (const mode of ['quote','pay','free']) {
      const f=fixture({event:mode==='free'?{}:event,projectSelect:true,promos:mode==='free'?[promo({discount_value:100})]:[]});
      const freeQuote=mode==='free'?await f.quote({discount_code:'SAVE10'}):null;
      if(freeQuote) { assert.equal(freeQuote.data.ok,true); Object.assign(f.tables.events[0],event); }
      const r=mode==='quote'?await f.quote():await f.pay(mode==='free'?{discount_code:'SAVE10',expected_quote_key:freeQuote.data.quote.quote_key}:{});
      assert.equal(r.data.ok,false,`${mode}: ${JSON.stringify(r.data)}`);
      assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
      assert.equal(f.tables.orders.length,0);assert.equal(f.tables.tickets.length,0);
    }
  });
}
for (const nsfw of [false,null]) {
  test(`active public ticketed event retains checkout (nsfw=${nsfw})`,async()=>{
    const f=fixture({event:{nsfw},projectSelect:true});
    assert.equal((await f.quote()).data.ok,true);assert.equal(f.writes.length,0);
    assert.equal((await f.pay()).data.ok,true);assert.equal(f.stripe.length,1);
  });
}
test('a valid quote cannot authorize checkout after event eligibility changes',async()=>{
  for(const [,event] of denied){
    const f=fixture({projectSelect:true});const q=await f.quote();assert.equal(q.data.ok,true);
    Object.assign(f.tables.events[0],event);
    const r=await f.pay({expected_quote_key:q.data.quote.quote_key});
    assert.equal(r.data.ok,false);assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);
  }
});

test('already-issued free orders remain recoverable after an event becomes ineligible',async()=>{
  const f=fixture({projectSelect:true,promos:[promo({discount_value:100})]});
  const input={discount_code:'SAVE10',idempotency_key:'completed-before-event-change'};
  const q=await f.quote(input);
  assert.equal((await f.pay({...input,expected_quote_key:q.data.quote.quote_key})).data.free,true);
  const issued=f.tables.tickets.length, sent=f.emails.length;
  Object.assign(f.tables.events[0],{status:'suspended',ticketing_enabled:false,nsfw:true});
  const replay=await f.pay(input);
  assert.equal(replay.data.idempotent,true);assert.equal(replay.data.free,true);
  assert.equal(f.tables.tickets.length,issued);assert.equal(f.emails.length,sent);assert.equal(f.stripe.length,0);
});

for (const [label,tier] of [['paid',{}],['free',{price_cents:0}]]) {
  test(`${label} email-only guest checkout does not provision an account or intake`,async()=>{
    const f=fixture({tier});
    const result=await f.pay({guest_name:'Guest Buyer'});
    assert.equal(result.status,200);
    assert.equal(result.data.ok,true);
    assert.deepEqual(f.profileCalls,[]);
    assert.equal(f.tables.orders.length,1);
  });
}

test('free RSVP with Sell tickets off quotes and issues through the existing guest rail',async()=>{
  const f=fixture({event:{ticketing_enabled:false},tier:{price_cents:0,name:'RSVP'},projectSelect:true,noStripe:true});
  f.tables.organizer_accounts=[];
  const anonymous=await f.quote({guest_email:'',quantity:2});
  assert.equal(anonymous.data.ok,true);
  assert.equal(anonymous.data.quote.total_cents,0);
  assert.equal(anonymous.data.quote.buyer_fee_cents,0);
  assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
  const input={quantity:2,idempotency_key:'free-rsvp-attempt',guest_name:'Guest Buyer'};
  const q=await f.quote(input);
  const result=await f.pay({...input,expected_quote_key:q.data.quote.quote_key});
  assert.equal(result.data.ok,true);assert.equal(result.data.free,true);assert.equal(result.data.count,2);
  assert.equal(f.tables.orders.length,1);assert.equal(f.tables.orders[0].total_cents,0);
  assert.equal(f.tables.orders[0].status,'paid');assert.equal(f.tables.tickets.length,2);
  assert.ok(f.tables.tickets.every(t=>t.ticket_type_id===TIER&&t.guest_email===EMAIL&&t.qr_payload&&t.order_id===result.data.order_id));
  assert.equal(f.tables.ticket_types[0].quantity_sold,2);
  assert.equal(f.writes.filter(w=>w.fn==='ticket_hold_create_atomic').length,1);
  assert.equal(f.writes.find(w=>w.fn==='ticket_hold_create_atomic').args.p_quantity,2);
  assert.equal(f.emails.length,1);assert.equal(f.stripe.length,0);assert.deepEqual(f.profileCalls,[]);
  const replay=await f.pay(input);
  assert.equal(replay.data.idempotent,true);assert.equal(replay.data.order_id,result.data.order_id);
  assert.equal(f.tables.tickets.length,2);assert.equal(f.emails.length,1);
});

test('free RSVP retains every event eligibility check on quote and issuance',async()=>{
  for(const [label,event] of denied.filter(([,event])=>event.ticketing_enabled!==false)){
    const f=fixture({event:{ticketing_enabled:false},tier:{price_cents:0},projectSelect:true});
    const q=await f.quote();assert.equal(q.data.ok,true,label);
    Object.assign(f.tables.events[0],event);
    for(const r of [await f.quote(),await f.pay({expected_quote_key:q.data.quote.quote_key})])
      assert.equal(r.data.ok,false,label);
    assert.equal(f.writes.length,0,label);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
  }
});

test('free RSVP retains tier ownership, visibility, availability and guest caps',async()=>{
  const deniedTiers=[
    ['wrong event',{event_id:2}],['missing tier',{id:'another-tier'}],
    ['inactive',{is_active:false}],['paused',{status:'paused'}],['ended',{status:'ended'}],
    ['hidden',{tier_visibility:'hidden'}],['locked',{tier_visibility:'locked',unlock_code:'PRIVATE'}],
    ['not started',{sale_start:'2099-01-01'}],['ended sales',{sale_end:'2000-01-01'}],
    ['sold out',{quantity_total:1,quantity_sold:1}],
  ];
  for(const [label,tier] of deniedTiers){
    const f=fixture({event:{ticketing_enabled:false},tier:{price_cents:0,...tier},projectSelect:true});
    assert.equal((await f.quote()).data.ok,false,label);assert.equal((await f.pay()).data.ok,false,label);
    assert.equal(f.writes.length,0,label);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
  }
  const f=fixture({event:{ticketing_enabled:false},tier:{price_cents:0,max_per_user:1},projectSelect:true});
  f.tables.tickets.push({id:'existing',event_id:1,ticket_type_id:TIER,guest_email:EMAIL,status:'active'});
  assert.equal((await f.quote()).data.error.code,'limit');assert.equal((await f.pay()).data.error.code,'limit');
  assert.equal(f.writes.length,0);assert.equal(f.emails.length,0);
});

test('only an authoritative zero-price tier can bypass the paid-ticketing switch',async()=>{
  for(const price_cents of [3000,null,undefined,'0',-1]){
    const f=fixture({event:{ticketing_enabled:false},tier:{price_cents},promos:[promo({discount_value:100})],projectSelect:true});
    for(const input of [{price_cents:0},{discount_code:'SAVE10',expected_quote_key:'old'}]){
      assert.equal((await f.quote(input)).data.error.code,'event_unavailable');
      assert.equal((await f.pay(input)).data.error.code,'event_unavailable');
    }
    assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
  }
});

test('paid checkout still requires Stripe configuration before side effects',async()=>{
  const f=fixture({noStripe:true});
  assert.equal((await f.quote()).data.ok,true);
  const r=await f.pay();assert.equal(r.status,500);assert.equal(r.data.error.code,'config');
  assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
});

test('free RSVP quote cannot authorize a newly paid tier or an invalid ticketing flag',async()=>{
  for(const change of [{price_cents:3000},{ticketing_enabled:null},{ticketing_enabled:undefined},{ticketing_enabled:'false'},{ticketing_enabled:0}]){
    const f=fixture({event:{ticketing_enabled:false},tier:{price_cents:0},projectSelect:true});
    const q=await f.quote();assert.equal(q.data.ok,true);
    Object.assign('price_cents' in change?f.tables.ticket_types[0]:f.tables.events[0],change);
    assert.equal((await f.quote()).data.error.code,'event_unavailable');
    assert.equal((await f.pay({expected_quote_key:q.data.quote.quote_key})).data.error.code,'event_unavailable');
    assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.emails.length,0);
  }
});

test('free RSVP still requires attendee names when configured',async()=>{
  const f=fixture({event:{ticketing_enabled:false,attendee_name_requirement:'required'},tier:{price_cents:0},projectSelect:true});
  const q=await f.quote();assert.equal(q.data.ok,true);
  assert.equal((await f.pay({expected_quote_key:q.data.quote.quote_key})).data.error.code,'name_required');
  assert.equal(f.writes.length,0);assert.equal(f.emails.length,0);
  assert.equal((await f.pay({attendee_names:['Guest Buyer'],expected_quote_key:q.data.quote.quote_key})).data.free,true);
});
