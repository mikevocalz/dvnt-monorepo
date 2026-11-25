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

const webContact={...contact,checkout_contact_version:1,guest_username:'@Door.Test'};
test('web ticket contact is mandatory before Stripe or issuance, including an older browser without a marker',async()=>{
 for(const fields of [{guest_username:undefined},{guest_phone:undefined},{guest_email:undefined}]){
  const f=fixture();const r=await f.pay({...webContact,...fields});
  assert.equal(r.status,400);assert.equal(f.stripe.length,0);assert.equal(f.writes.length,0);
 }
 const compat=fixture({origin:'https://dvntapp.live'});
 assert.equal((await compat.pay(contact)).data.ok,true,'Edge-first deploy retains old web until cutover');
 const browser=fixture({origin:'https://dvntapp.live',enforceContact:true});
 assert.equal((await browser.pay(contact)).data.error.code,'invalid_username');
 assert.equal((await browser.quote({})).data.webTicketContactVersion,1);
 const oldSchema=fixture({readError:'web_ticket_order_contacts'});
 assert.equal((await oldSchema.quote({})).data.webTicketContactVersion,undefined);
 const native=fixture({enforceContact:true}); assert.equal((await native.pay(contact)).data.ok,true);
});
test('paid web checkout binds normalized private contact before returning the URL',async()=>{
 const f=fixture({projectSelect:true});const r=await f.pay(webContact);assert.equal(r.data.ok,true,JSON.stringify(r.data));
 assert.equal(f.tables.orders[0].guest_phone,null);
 assert.deepEqual(f.tables.web_ticket_order_contacts.map(c=>[c.guest_username,c.guest_phone]),[['door.test','+12125550123']]);
 assert.equal(JSON.stringify(f.stripe).includes('door.test'),false);
 assert.equal(JSON.stringify(f.stripe).includes('+12125550123'),false);
 assert.deepEqual(f.profileCalls,[]);
 const broken=fixture({contactError:true});
 const failed=await broken.pay(webContact);
 assert.equal(failed.status,503);assert.equal(failed.data.url,undefined);
 assert.ok(broken.stripe[1].url.endsWith('/checkout/sessions/cs_fixture_1/expire'));
});
test('free web checkout captures contact in the allocator and binds replays without provisioning',async()=>{
 const f=fixture({tier:{price_cents:0}});
 const r=await f.pay({...webContact,username:'do_not_create',full_name:'Synthetic Test',phone:'+12125550199'});
 assert.equal(r.data.ok,true,JSON.stringify(r.data));assert.equal(f.writes[0].fn,'guest_free_checkout_with_contact');
 assert.equal(f.tables.tickets[0].guest_phone,null);assert.deepEqual(f.profileCalls,[]);
 assert.equal((await f.pay(webContact)).data.idempotent,true);
 assert.equal((await f.pay({...webContact,guest_username:'different'})).data.error.code,'idempotency_conflict');
 assert.equal(f.tables.tickets.length,1);assert.equal(f.stripe.length,0);
});

test('new web envelope has no legacy purchase fields and requires explicit final ack',async()=>{
 const f=fixture({projectSelect:true});
 const {event_id,ticket_type_id,quantity}= {event_id:1,ticket_type_id:f.tables.ticket_types[0].id,quantity:1};
 const envelope={action:'checkout',checkout_contact_version:1,web_ticket_checkout:{event_id,ticket_type_id,quantity,guest_email:'fixture@example.test',...webContact}};
 for(const key of ['event_id','tier_id','ticket_type_id','guest_email'])assert.equal(envelope[key],undefined);
 const r=await f.call(envelope);assert.equal(r.data.ok,true,JSON.stringify(r.data));
 assert.equal(r.data.webTicketContactVersion,1);
});
