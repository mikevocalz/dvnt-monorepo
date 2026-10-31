// Handler-only contracts. Real database races/rollback live in the SQL harness.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,TIER,EMAIL}=require('./discounts-fixture.cjs');
const free={event:{ticketing_enabled:false},tier:{price_cents:0},projectSelect:true,noStripe:true};

test('free issuance uses one RPC and no split order/ticket/hold/counter writes',async()=>{
 const f=fixture(free);
 const result=await f.pay({quantity:2,attendee_names:['One','Two'],idempotency_key:'atomic-fixture'});
 assert.equal(result.data.ok,true);
 const call=f.writes.find(w=>w.fn==='guest_free_checkout_atomic');
 assert.equal(call.args.p_ticket_type_id,TIER);
 assert.equal(call.args.p_order.guest_email,EMAIL);
 assert.equal(call.args.p_order.expected_unit_price_cents,0);
 assert.equal(call.args.p_order.idempotency_key,'atomic-fixture');
 assert.deepEqual(Array.from(call.args.p_ticket_rows,t=>t.attendee_name),['One','Two']);
 assert.ok(call.args.p_ticket_rows.every(t=>t.qr_token&&t.qr_payload&&t.guest_lookup_token));
 assert.equal(f.writes.length,1);
 assert.equal(f.tables.orders.length,1);assert.equal(f.tables.tickets.length,2);
 assert.equal(f.tables.ticket_types[0].quantity_sold,2);
 assert.equal(f.tables.ticket_holds[0].status,'converted');
 assert.equal(f.emails.length,1);assert.equal(f.stripe.length,0);
});

for(const [error,expected] of [['insufficient_inventory','sold_out'],['limit','limit'],
 ['idempotency_conflict','idempotency_conflict'],['checkout_processing','checkout_processing'],
 ['quote_changed','quote_changed'],['tier_not_found','tier_unavailable'],['tier_unavailable','tier_unavailable']]){
 test(`atomic ${error} fails closed without fulfillment side effects`,async()=>{
  const f=fixture({...free,atomicResult:{ok:false,error,available:1,limit:1}});
  const r=await f.pay({quantity:2});
  assert.equal(r.status,409);assert.equal(r.data.error.code,expected);
  assert.equal(f.tables.orders.length,0);assert.equal(f.tables.tickets.length,0);
  assert.equal(f.tables.ticket_holds.length,0);assert.equal(f.emails.length,0);
  assert.equal(f.profileCalls.length,0);assert.equal(f.stripe.length,0);
  assert.equal(f.writes.length,1);
 });
}

test('missing migration and database errors never fall back to split issuance',async()=>{
 for(const error of [{code:'PGRST202',message:'function missing'},{code:'23514',message:'check failed'}]){
  const f=fixture({...free,atomicError:error});const r=await f.pay();
  assert.equal(r.status,500);assert.equal(r.data.ok,false);
  assert.equal(f.writes.length,1);assert.equal(f.tables.orders.length,0);
  assert.equal(f.tables.tickets.length,0);assert.equal(f.emails.length,0);
 }
});

test('same-key race replay does not send mail, provision a profile or increment a promo twice',async()=>{
 const f=fixture({...free,atomicResult:{ok:true,idempotent:true,order_id:'winner',count:1,order:{id:'winner'}}});
 const r=await f.pay({idempotency_key:'concurrent-key'});
 assert.equal(r.data.idempotent,true);assert.equal(r.data.order_id,'winner');
 assert.equal(f.emails.length,0);assert.equal(f.profileCalls.length,0);assert.equal(f.usage.length,0);
});

test('completed order replay is bound to its tier as well as buyer/event/quantity',async()=>{
 const f=fixture(free);
 await f.pay({idempotency_key:'bound-selection'});
 const before=f.writes.length;
 const r=await f.pay({idempotency_key:'bound-selection',ticket_type_id:'another-tier'});
 assert.equal(r.status,409);assert.equal(r.data.error.code,'idempotency_conflict');
 assert.equal(f.writes.length,before);assert.equal(f.tables.tickets.length,1);assert.equal(f.emails.length,1);
});

test('paid checkout continues to use the existing hold rail, not free issuance',async()=>{
 const f=fixture({projectSelect:true});const r=await f.pay();
 assert.equal(r.data.ok,true);assert.equal(f.stripe.length,1);
 assert.equal(f.writes.filter(w=>w.fn==='ticket_purchase_hold_atomic').length,1);
 assert.equal(f.writes.filter(w=>w.fn==='guest_free_checkout_atomic').length,0);
 assert.equal(f.tables.tickets.length,0);
});

for (const status of ['active', 'scanned', 'transfer_pending']) {
 test(`guest cumulative cap includes ${status} service credentials`,async()=>{
  const f=fixture({...free,tier:{price_cents:0,category:'service',name:'Coat Check',max_per_user:1}});
  f.tables.tickets.push({id:'existing',event_id:1,ticket_type_id:TIER,guest_email:EMAIL,status});
  const r=await f.pay();assert.equal(r.data.ok,false);assert.equal(r.data.error.code,'limit');
  assert.equal(f.writes.length,0);assert.equal(f.stripe.length,0);assert.equal(f.tables.tickets.length,1);
 });
}
test('guest repeats free service purchase as an independent order and leaves first credential unchanged',async()=>{
 const f=fixture({...free,tier:{price_cents:0,category:'service',name:'Coat Check',max_per_user:2}});
 const first=await f.pay({idempotency_key:'first-service-purchase'});assert.equal(first.data.ok,true);
 const original=JSON.stringify(f.tables.tickets[0]);
 const second=await f.pay({idempotency_key:'second-service-purchase'});assert.equal(second.data.ok,true);assert.notEqual(second.data.order_id,first.data.order_id);
 assert.equal(JSON.stringify(f.tables.tickets[0]),original);assert.equal(f.tables.tickets.length,2);
 assert.ok(f.tables.tickets.every(ticket=>ticket.ticket_type_id===TIER));
 const third=await f.pay({idempotency_key:'third-service-purchase'});assert.equal(third.data.error.code,'limit');assert.equal(f.tables.orders.length,2);
});
test('guest configured order cap and failed owned-count read fail before side effects',async()=>{
 for(const options of [{tier:{price_cents:0,max_per_order:1}},{readError:'tickets'}]){
  const f=fixture({...free,...options});const r=await f.pay({quantity:2});assert.equal(r.status,options.readError?500:400);assert.equal(f.writes.length,0);assert.equal(f.tables.tickets.length,0);
 }
});
