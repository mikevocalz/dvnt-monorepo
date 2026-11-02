const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

function fixture({ cap = 200, failTable, failAfter = -1, multiTicketOwner = false, monthlyOrders = [], hostId = 'staff', coOrganizer = null, unauthenticated = false } = {}) {
  const tickets = Array.from({length:1207}, (_,i) => ({id:i+1,user_id:`fixture-${i}`,event_id:1,ticket_type_id:'tier',status:i<1100?'active':i<1150?'scanned':i<1175?'transfer_pending':i<1195?'refunded':'void',checked_in_at:i===0||i===1175?'2026-01-01T00:00:00Z':null,purchase_amount_cents:i<1000?1000:0,created_at:'2026-01-01T00:00:00Z'}));
  const rsvps = Array.from({length:1005},(_,i)=>({id:i+1,user_id:i<1000?`fixture-${i}`:`rsvp-only-${i}`,status:'going'}));
  if (multiTicketOwner) { tickets[1].user_id = tickets[0].user_id; rsvps.splice(1,1); }
  const pages=[];
  const queries=[];
  const db={from(table){let after=0, limit=Infinity; const filters=[]; queries.push(table);
    const run=()=>{
      if(table===failTable&&after>=failAfter)return {data:null,error:{message:'fixture unavailable'}};
      if(table==='events')return {data:{id:1,host_id:hostId,title:'Synthetic event'},error:null};
      if(table==='event_co_organizers')return {data:coOrganizer&&filters.every(f=>f(coOrganizer))?coOrganizer:null,error:null};
      if(table==='event_financials')return {data:{gross_cents:1000000},error:null};
      if(table==='orders')return {data:monthlyOrders.filter(r=>r.id>String(after)&&filters.every(f=>f(r))).slice(0,Math.min(cap,limit)),error:null};
      if(table==='tickets'||table==='event_rsvps') {const source=table==='tickets'?tickets:rsvps;pages.push({table,after});return {data:source.filter(r=>r.id>after).slice(0,Math.min(cap,limit)),error:null};}
      return {data:[],error:null};
    };
    const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},gte:(k,v)=>{filters.push(r=>r[k]>=v);return q;},lt:(k,v)=>{filters.push(r=>r[k]<v);return q;},order:()=>q,limit:n=>{limit=n;return q;},gt:(_key,value)=>{after=value;return q;},maybeSingle:async()=>run(),then:(yes,no)=>Promise.resolve(run()).then(yes,no)};return q;
  }};
  const h=harness({database:db,unauthenticated});
  return {pages,queries,writes:h.writes,requests:h.requests,invoke:(action,month)=>h.invoke('event-analytics',{event_id:1,...(action?{action}:{}),...(month?{month}:{})})};
}

test('actual analytics handler counts >1000 tickets and RSVP rows despite a200-row server cap',async()=>{
 const f=fixture();const r=await f.invoke();assert.equal(r.status,200);const data=await r.json();
 assert.equal(data.ticketStats.total,1207);assert.equal(data.ticketStats.refunded,20);assert.equal(data.ticketStats.void,12);
 assert.equal(data.ticketStats.checkedIn,52);assert.equal(data.attendanceBreakdown.paid,1000);
 assert.equal(data.attendanceBreakdown.rsvp,1005);assert.equal(data.attendanceBreakdown.total,1180);
 assert.ok(f.pages.some(p=>p.table==='tickets'&&p.after>1000));assert.ok(f.pages.some(p=>p.table==='event_rsvps'&&p.after>=1000));
});
test('attendee export includes every row rather than the first response page',async()=>{
 const r=await fixture().invoke('attendees');assert.equal(r.status,200);const data=await r.json();assert.equal(data.attendees.length,1207);assert.equal(new Set(data.attendees.map(t=>t.ticketId)).size,1207);
});
for(const table of ['tickets','event_rsvps'])test(`${table} later-page failure cannot return partial statistics`,async()=>{
 const r=await fixture({failTable:table,failAfter:1000}).invoke();assert.equal(r.status,500);
});
test('export fails closed when both full and narrow reads fail on a later page',async()=>{
 assert.equal((await fixture({failTable:'tickets',failAfter:1000}).invoke('attendees')).status,500);
});
for(const table of ['event_financials','ticket_types','promo_codes'])test(`${table} error is not presented as a zero value`,async()=>{
 assert.equal((await fixture({failTable:table}).invoke()).status,500);
});

test('multiple tickets held by one account remain multiple valid units, with no extra RSVP seat',async()=>{
 const r=await fixture({multiTicketOwner:true}).invoke();const data=await r.json();assert.equal(r.status,200);assert.equal(data.attendanceBreakdown.total,1180);assert.equal(data.attendanceBreakdown.rsvp,1004);
});

test('October fee ledger sums buyer and organizer sides and deducts Stripe only once',async()=>{
 const monthlyOrders=[
  {id:'001',type:'event_ticket',event_id:1,status:'paid',paid_at:'2026-10-31T02:00:00Z',currency:'usd',
   total_cents:3150,buyer_fee_cents:150,organizer_fee_cents:150,dvnt_total_fee_cents:300,stripe_fee_cents:121},
  {id:'002',type:'event_ticket',event_id:1,status:'paid',paid_at:'2026-10-31T02:00:00Z',currency:'usd',
   total_cents:0,buyer_fee_cents:0,organizer_fee_cents:0,dvnt_total_fee_cents:0,stripe_fee_cents:null},
  {id:'003',type:'event_ticket',event_id:1,status:'partially_refunded',paid_at:'2026-10-31T02:00:00Z',currency:'usd',
   total_cents:3150,buyer_fee_cents:150,organizer_fee_cents:150,dvnt_total_fee_cents:300,stripe_fee_cents:121},
 ];
 const r=await fixture({monthlyOrders}).invoke(undefined,'2026-10');
 assert.equal(r.status,200,await r.clone().text());
 const data=await r.json();
 assert.equal(data.monthlyPlatformFees.grossPlatformFeeCents,300);
 assert.equal(data.monthlyPlatformFees.buyerFeeCents,150);
 assert.equal(data.monthlyPlatformFees.organizerFeeCents,150);
 assert.equal(data.monthlyPlatformFees.stripeFeeCents,121);
 assert.equal(data.monthlyPlatformFees.afterStripeFeeCents,179);
 assert.equal(data.monthlyPlatformFees.excludedPartiallyRefundedOrders,1);
 assert.equal(data.monthlyPlatformFees.paidOrders,2);
});
test('invalid recorded Stripe costs fail closed, never show a false payout',async()=>{
 const monthlyOrders=[{id:'001',type:'event_ticket',event_id:1,status:'paid',paid_at:'2026-10-31T02:00:00Z',
 currency:'usd',total_cents:3150,buyer_fee_cents:150,organizer_fee_cents:150,dvnt_total_fee_cents:300,stripe_fee_cents:null}];
 const r=await fixture({monthlyOrders}).invoke(undefined,'2026-10');
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.monthlyPlatformFees,null);
 assert.equal(data.ticketStats.total,1207);
 assert.equal(data.revenue.grossCents,1000000);
 assert.ok(Array.isArray(data.tiers));
});

const paidOrder = (id, extra = {}) => ({
 id, type: 'event_ticket', event_id: 1, status: 'paid', paid_at: '2026-10-31T02:00:00Z',
 currency: 'usd', total_cents: 3150, buyer_fee_cents: 150, organizer_fee_cents: 150,
 dvnt_total_fee_cents: 300, stripe_fee_cents: 121, ...extra,
});

test('monthly ledger pages past the server cap without losing or duplicating fees',async()=>{
 const monthlyOrders=Array.from({length:1003},(_,i)=>paidOrder(String(i+1).padStart(4,'0')));
 const f=fixture({cap:100,monthlyOrders}); const r=await f.invoke(undefined,'2026-10');
 assert.equal(r.status,200); const data=await r.json();
 assert.equal(data.monthlyPlatformFees.chargedOrders,1003);
 assert.equal(data.monthlyPlatformFees.grossPlatformFeeCents,300900);
 assert.equal(data.monthlyPlatformFees.stripeFeeCents,121363);
 assert.equal(data.monthlyPlatformFees.afterStripeFeeCents,179537);
 assert.deepEqual(f.writes,[]); assert.deepEqual(f.requests,[]);
});

test('October scopes to New York midnight, event, ticket type and paid status',async()=>{
 const monthlyOrders=[
  paidOrder('001',{paid_at:'2026-10-01T03:59:59Z'}),
  paidOrder('002',{paid_at:'2026-10-01T04:00:00Z'}),
  paidOrder('003',{paid_at:'2026-11-01T03:59:59Z'}),
  paidOrder('004',{paid_at:'2026-11-01T04:00:00Z'}),
  paidOrder('005',{event_id:2}), paidOrder('006',{type:'subscription'}),
  paidOrder('007',{status:'refunded'}), paidOrder('008',{status:'pending'}),
  paidOrder('009',{status:'partially_refunded'}),
 ];
 const r=await fixture({monthlyOrders}).invoke(undefined,'2026-10'); const data=await r.json();
 assert.equal(r.status,200); assert.equal(data.monthlyPlatformFees.paidOrders,2);
 assert.equal(data.monthlyPlatformFees.grossPlatformFeeCents,600);
 assert.equal(data.monthlyPlatformFees.excludedPartiallyRefundedOrders,1);
 assert.equal(data.monthlyPlatformFees.start,'2026-10-01T04:00:00.000Z');
 assert.equal(data.monthlyPlatformFees.end,'2026-11-01T04:00:00.000Z');
});

test('month boundaries handle DST and year changes rather than fixed offsets',()=>{
 const {selectedNyMonth}=harness().load(require('node:path').resolve(__dirname,'../_shared/monthly-event-fees.ts'));
 const now=new Date('2027-01-20T12:00:00Z');
 const november=selectedNyMonth('2026-11',now);
 assert.equal(november.start,'2026-11-01T04:00:00.000Z');
 assert.equal(november.end,'2026-12-01T05:00:00.000Z');
 assert.equal(selectedNyMonth('2026-12',now).end,'2027-01-01T05:00:00.000Z');
});

for (const extra of [
 {stripe_fee_cents:-1}, {stripe_fee_cents:1.5}, {currency:'eur'},
 {dvnt_total_fee_cents:301}, {total_cents:0}, {buyer_fee_cents:null},
 {total_cents:0,buyer_fee_cents:0,organizer_fee_cents:0,dvnt_total_fee_cents:0,stripe_fee_cents:121},
]) test(`invalid monthly money fails closed without hiding attendance: ${JSON.stringify(extra)}`,async()=>{
 const r=await fixture({monthlyOrders:[paidOrder('001',extra)]}).invoke(undefined,'2026-10');
 assert.equal(r.status,200);const data=await r.json();
 assert.equal(data.monthlyPlatformFees,null);assert.equal(data.attendanceBreakdown.total,1180);
});

test('later order-page failure hides all monthly amounts, not the rest of analytics',async()=>{
 const monthlyOrders=Array.from({length:250},(_,i)=>paidOrder(String(i+1).padStart(4,'0')));
 const r=await fixture({monthlyOrders,cap:100,failTable:'orders',failAfter:100}).invoke(undefined,'2026-10');
 assert.equal(r.status,200);const data=await r.json();
 assert.equal(data.monthlyPlatformFees,null);assert.equal(data.revenue.grossCents,1000000);
});

for (const month of ['2026-13','2099-01','2026-1',123,{}]) test(`invalid month is a client error: ${JSON.stringify(month)}`,async()=>{
 const f=fixture();const r=await f.invoke(undefined,month);
 assert.equal(r.status,400);assert.equal(f.queries.includes('orders'),false);
});

for (const config of [
 {unauthenticated:true}, {hostId:'someone-else'},
 {hostId:'someone-else',coOrganizer:{event_id:1,user_id:'staff',role:'admin',accepted:false}},
 {hostId:'someone-else',coOrganizer:{event_id:1,user_id:'staff',role:'scanner',accepted:true}},
]) test(`unauthorized callers never read financial orders: ${JSON.stringify(config)}`,async()=>{
 const f=fixture(config);const r=await f.invoke(undefined,'2026-10');
 assert.equal(r.status,config.unauthenticated?401:403);assert.equal(f.queries.includes('orders'),false);
});
test('accepted event admin can read the same read-only monthly ledger',async()=>{
 const f=fixture({hostId:'someone-else',coOrganizer:{event_id:1,user_id:'staff',role:'admin',accepted:true},monthlyOrders:[paidOrder('001')]});
 const r=await f.invoke(undefined,'2026-10');assert.equal(r.status,200);
 assert.equal((await r.json()).monthlyPlatformFees.afterStripeFeeCents,179);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.requests,[]);
});
