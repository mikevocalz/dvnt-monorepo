// Real handler, projected database rows, fixture-only payments and mail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, promo } = require('./discounts-fixture.cjs');

const denied = [
  ['draft', {status:'draft'}], ['suspended', {status:'suspended'}], ['postponed', {status:'postponed'}],
  ['cancelled', {status:'cancelled'}], ['canceled', {status:'canceled'}],
  ['unknown status', {status:'unknown'}], ['missing status', {status:null}],
  ['ticketing disabled', {ticketing_enabled:false}], ['ticketing unset', {ticketing_enabled:null}],
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
