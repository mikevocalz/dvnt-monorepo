const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

function fixture({ cap = 200, failTable, failAfter = -1, multiTicketOwner = false, monthlyOrders = [], hostId = 'staff', coOrganizer = null, unauthenticated = false, contactRows, contactProfiles = [], privateProfiles = [], noTierJoin = false, oldGuestSchema = false, guestContacts = [], contactAccounts = [] } = {}) {
  const tickets = Array.from({length:1207}, (_,i) => ({id:i+1,user_id:`fixture-${i}`,event_id:1,ticket_type_id:'tier',status:i<1100?'active':i<1150?'scanned':i<1175?'transfer_pending':i<1195?'refunded':'void',checked_in_at:i===0||i===1175?'2026-01-01T00:00:00Z':null,purchase_amount_cents:i<1000?1000:0,created_at:'2026-01-01T00:00:00Z'}));
  const rsvps = Array.from({length:1005},(_,i)=>({id:i+1,user_id:i<1000?`fixture-${i}`:`rsvp-only-${i}`,status:'going'}));
  if (multiTicketOwner) { tickets[1].user_id = tickets[0].user_id; rsvps.splice(1,1); }
  const pages=[];
  const queries=[]; const matchIds=[];
  const db={from(table){let after=0, limit=Infinity, columns=""; const filters=[]; queries.push(table);
    const run=()=>{
      if(table===failTable&&after>=failAfter)return {data:null,error:{message:'fixture unavailable'}};
      if(table==='events')return {data:{id:1,host_id:hostId,title:'Synthetic event'},error:null};
      if(table==='event_co_organizers')return {data:coOrganizer&&filters.every(f=>f(coOrganizer))?coOrganizer:null,error:null};
      if(table==='event_financials')return {data:{gross_cents:1000000},error:null};
      if(table==='orders')return {data:monthlyOrders.filter(r=>r.id>String(after)&&filters.every(f=>f(r))).slice(0,Math.min(cap,limit)),error:null};
      if(table==='users'||table==='user'||table==='user_private_profile') {
        const rows=table==='users'?contactProfiles:table==='user'?contactAccounts:privateProfiles;
        return {data:rows.filter(r=>filters.every(f=>f(r))),error:null};
      }
      if(table==='web_ticket_guest_contacts') {
        if(oldGuestSchema) return {data:null,error:{code:"PGRST205",message:"Table public.web_ticket_guest_contacts missing"}};
        return {data:guestContacts.filter(r=>filters.every(f=>f(r))),error:null};
      }
      if(table==='tickets'&&contactRows) {

        if(noTierJoin && columns.includes('ticket_types(')) return {data:null,error:{message:'fixture FK absent'}};
        return {data:contactRows.filter(r=>r.id>after&&filters.every(f=>f(r))).slice(0,Math.min(cap,limit)),error:null};
      }
      if(table==='tickets'||table==='event_rsvps') {const source=table==='tickets'?tickets:rsvps;pages.push({table,after});return {data:source.filter(r=>r.id>after).slice(0,Math.min(cap,limit)),error:null};}
      return {data:[],error:null};
    };
    const q={select:(c)=>{columns=c;return q;},eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},in:(k,v)=>{if(k==="auth_id"||k==="ticket_id"||(table==="user"&&k==="id")) matchIds.push({table,ids:[...v]});filters.push(r=>v.includes(r[k]));return q;},gte:(k,v)=>{filters.push(r=>r[k]>=v);return q;},lt:(k,v)=>{filters.push(r=>r[k]<v);return q;},order:()=>q,limit:n=>{limit=n;return q;},gt:(_key,value)=>{after=value;return q;},maybeSingle:async()=>run(),then:(yes,no)=>Promise.resolve(run()).then(yes,no)};return q;
  }};
  const h=harness({database:db,unauthenticated});
  return {pages,queries,matchIds,writes:h.writes,requests:h.requests,invoke:(action,month,includePhone)=>h.invoke('event-analytics',{event_id:1,...(action?{action}:{}),...(month?{month}:{}),...(includePhone?{include_phone:true}:{})})};
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

const contactFixture = {
  contactRows: [
    {id:1,event_id:1,user_id:"member",order_id:"first",guest_phone:"+12025550108",guest_email:"former@example.invalid"},
    {id:2,event_id:1,user_id:null,order_id:"second",guest_phone:"+12025550109",guest_phone_e164:"+12025550115",guest_email:"guest@example.invalid"},
    {id:3,event_id:1,user_id:null,guest_phone_e164:"+12025550110"},
    {id:4,event_id:1,user_id:"missing",guest_email:"do-not-reuse@example.invalid",guest_phone:"+12025550111"},
    {id:5,event_id:2,user_id:"unrelated"},
    {id:6,event_id:1,user_id:null,order_id:"sixth",guest_email:"different@example.invalid"},
    {id:7,event_id:1,user_id:null,order_id:"seventh",guest_email:"reordered@example.invalid"},
    {id:8,event_id:1,user_id:null,order_id:"eighth",guest_email:"confirmed@example.invalid"},
  ],
  guestContacts: [
    {ticket_id:"1",order_id:"first",guest_email:"former@example.invalid",guest_username:"never-export"},
    {ticket_id:"2",order_id:"second",guest_email:"GUEST@example.invalid",guest_username:"guest-display",guest_phone:"+12025550119"},
    {ticket_id:"6",order_id:"sixth",guest_email:"stale@example.invalid",guest_username:"never-export",guest_phone:"+12025550114"},
    {ticket_id:"7",order_id:"wrong",guest_email:"reordered@example.invalid",guest_username:"never-export",guest_phone:"+12025550116"},
    {ticket_id:"8",order_id:"eighth",guest_email:"confirmed@example.invalid",guest_username:"confirmed-guest",guest_phone:"+12025550117"},
  ],
  contactProfiles: [{auth_id:"member",username:"member-display",email:"stale-mirror@example.invalid"},{auth_id:"unrelated",username:"leak"}],
  contactAccounts: [{id:"member",email:"member@example.invalid"},{id:"unrelated",email:"leak@example.invalid"}],
  privateProfiles: [{auth_id:"member",phone_e164:"+12025550112"},{auth_id:"unrelated",phone_e164:"+12025550113"}],
};

for (const noTierJoin of [false, true]) test(`browser attendee export resolves scoped current identities and real contacts (tier fallback: ${noTierJoin})`,async()=>{
  const f=fixture({...contactFixture,noTierJoin,cap:2});
  const r=await f.invoke("attendees",null,true);
  assert.equal(r.status,200);
  assert.equal(r.headers.get("cache-control"),"no-store");
  const body=await r.json();
  assert.equal(body.includesPhone,true);
  assert.deepEqual(body.attendees.map(row=>[row.ticketId,row.buyerUsername,row.buyerEmail,row.buyerPhone]),[
    ["1","member-display","member@example.invalid","+12025550112"],
    ["2","guest-display","guest@example.invalid","+12025550119"],
    ["3",null,null,"+12025550110"],
    ["4",null,null,null],
    ["6",null,"different@example.invalid",null],
    ["7",null,"reordered@example.invalid",null],
    ["8","confirmed-guest","confirmed@example.invalid","+12025550117"],
  ]);
  assert.deepEqual(f.matchIds,[{table:"users",ids:["member","missing"]},{table:"user",ids:["member","missing"]},{table:"user_private_profile",ids:["member","missing"]},{table:"web_ticket_guest_contacts",ids:["2","6","7","8"]}]);
  assert.deepEqual(f.writes,[]);
});


test("browser export supports older schema without service-only guest contacts",async()=>{
  const f=fixture({oldGuestSchema:true,contactRows:[{id:1,event_id:1,user_id:null,order_id:"fixture-order",guest_email:"guest@example.invalid",guest_phone_e164:"unknown",guest_phone:"+12025550109"}]});
  const r=await f.invoke("attendees",null,true);
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.attendees[0].buyerUsername,null);
  assert.equal(body.attendees[0].buyerPhone,"+12025550109");
  assert.deepEqual(f.matchIds,[{table:"web_ticket_guest_contacts",ids:["1"]}]);
});

test("legacy analytics payload never looks up private phones",async()=>{
  const f=fixture(contactFixture);
  const data=await (await f.invoke("attendees")).json();
  assert.equal(Object.hasOwn(data,"includesPhone"),false);
  assert.ok(data.attendees.every(row=>!Object.hasOwn(row,"buyerPhone")));
  assert.equal(f.queries.includes("user_private_profile"),false);
  assert.equal(f.queries.includes("web_ticket_guest_contacts"),false);
});

for(const [role,accepted,eventId,expected] of [["admin",true,1,200],["editor",true,1,403],["scanner",true,1,403],["admin",false,1,403],["admin",true,2,403]]) {
  test(`spreadsheet role and event guard: ${role}/${accepted}/event${eventId}`,async()=>{
    const f=fixture({...contactFixture,hostId:"another-host",coOrganizer:{event_id:eventId,user_id:"staff",role,accepted}});
    const r=await f.invoke("attendees",null,true);
    assert.equal(r.status,expected);
    assert.equal(f.queries.includes("user_private_profile"),expected===200);
    if(expected!==200) assert.equal(f.queries.includes("tickets"),false);
  });
}

test("browser spreadsheet contact read errors fail closed before CSV generation",async()=>{
  const f=fixture({...contactFixture,failTable:"user_private_profile",failAfter:0});
  const r=await f.invoke("attendees",null,true);
  assert.equal(r.status,500);
  assert.deepEqual(await r.json(),{error:"Could not fetch attendee contacts"});
});

test("browser CSV is formula-safe and stores phone as text; native default CSV is unchanged",()=>{
  const {readFileSync}=require("node:fs");
  const path=require("node:path");
  const ts=require("typescript");
  const source=readFileSync(path.resolve(__dirname,"../../../../../packages/app/lib/api/event-analytics.ts"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const runtime={exports:{}};
  new Function("require","module","exports",compiled)(()=>({}),runtime,runtime.exports);
  const row={ticketId:"001",buyerUsername:" =SUM(A1)",buyerEmail:"@attendee",buyerName:'A, "quoted" guest',buyerPhone:"+001234567890",tierName:"	cmd",tierPriceCents:null,status:"active",purchaseAmountCents:0,checkedInAt:null,createdAt:"2026-01-01"};
  const {attendeesToCsv}=runtime.exports;
  const csv=attendeesToCsv([row,{...row,buyerPhone:"001234567890"},{...row,buyerPhone:null}],{includePhone:true});
  assert.match(csv,/^Ticket ID,Username,Email,Phone Number,Name/);
  assert.ok(csv.includes(`001,' =SUM(A1),'@attendee,'+001234567890,"A, ""quoted"" guest",'	cmd`));
  assert.ok(csv.includes(`,'001234567890,"`));
  assert.ok(csv.includes(`,'@attendee,,"A,`));
  assert.match(attendeesToCsv([row]),/^Ticket ID,Username,Email,Name/);
});
