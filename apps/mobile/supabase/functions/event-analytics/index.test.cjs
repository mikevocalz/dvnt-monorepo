const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('../_shared/payment-safety.test.cjs');

function fixture({ cap = 200, failTable, failAfter = -1, multiTicketOwner = false } = {}) {
  const tickets = Array.from({length:1207}, (_,i) => ({id:i+1,user_id:`fixture-${i}`,event_id:1,ticket_type_id:'tier',status:i<1100?'active':i<1150?'scanned':i<1175?'transfer_pending':i<1195?'refunded':'void',checked_in_at:i===0||i===1175?'2026-01-01T00:00:00Z':null,purchase_amount_cents:i<1000?1000:0,created_at:'2026-01-01T00:00:00Z'}));
  const rsvps = Array.from({length:1005},(_,i)=>({id:i+1,user_id:i<1000?`fixture-${i}`:`rsvp-only-${i}`,status:'going'}));
  if (multiTicketOwner) { tickets[1].user_id = tickets[0].user_id; rsvps.splice(1,1); }
  const pages=[];
  const db={from(table){let after=0, limit=Infinity;
    const run=()=>{
      if(table===failTable&&after>=failAfter)return {data:null,error:{message:'fixture unavailable'}};
      if(table==='events')return {data:{id:1,host_id:'staff',title:'Synthetic event'},error:null};
      if(table==='event_financials')return {data:{gross_cents:1000000},error:null};
      if(table==='tickets'||table==='event_rsvps') {const source=table==='tickets'?tickets:rsvps;pages.push({table,after});return {data:source.filter(r=>r.id>after).slice(0,Math.min(cap,limit)),error:null};}
      return {data:[],error:null};
    };
    const q={select:()=>q,eq:()=>q,order:()=>q,limit:n=>{limit=n;return q;},gt:(_key,value)=>{after=value;return q;},maybeSingle:async()=>run(),then:(yes,no)=>Promise.resolve(run()).then(yes,no)};return q;
  }};
  const h=harness({database:db});
  return {pages,invoke:action=>h.invoke('event-analytics',{event_id:1,...(action?{action}:{})})};
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
