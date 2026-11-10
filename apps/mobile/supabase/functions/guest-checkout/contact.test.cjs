const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./discounts-fixture.cjs');
const contact={guest_name:'Guest Buyer',guest_phone:'(212) 555-0123',idempotency_key:'contact-fixture'};
test('paid guest contact uses separate metadata/order fields without profile creation',async()=>{
 const f=fixture();const r=await f.pay(contact);assert.equal(r.data.ok,true);
 assert.equal(Object.hasOwn(f.stripe[0].params,'metadata[guest_phone]'),false,'phone remains in the private order, not Stripe metadata');
 assert.equal(f.tables.orders[0].guest_phone,'+12125550123');
 assert.deepEqual(f.profileCalls,[]);assert.equal(JSON.stringify(f.logs).includes('2125550123'),false);
});
test('free guest contact survives atomic row input and replay without profile creation',async()=>{
 const f=fixture({tier:{price_cents:0}});const r=await f.pay(contact);assert.equal(r.data.ok,true);
 assert.equal(f.tables.orders[0].guest_phone,'+12125550123');assert.equal(f.tables.tickets[0].guest_phone,'+12125550123');
 const retry=await f.pay(contact);assert.equal(retry.data.ok,true);assert.equal(f.tables.tickets.length,1);assert.deepEqual(f.profileCalls,[]);
});
test('bad explicit phone/name fail before mutations while old email-only requests remain valid',async()=>{
 for(const patch of [{guest_phone:'123'},{guest_phone:null},{guest_name:''}]){
  const f=fixture();const r=await f.pay({...contact,...patch});assert.equal(r.status,400);assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);
 }
 const old=fixture();assert.equal((await old.pay({})).data.ok,true);
});
test('quote does not require or persist buyer contact',async()=>{
 const f=fixture();assert.equal((await f.quote({...contact,guest_phone:'bad'})).data.ok,true);assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);
});
