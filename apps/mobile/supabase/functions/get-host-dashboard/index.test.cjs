const {test}=require('node:test');
const assert=require('node:assert/strict');
const {harness}=require('../_shared/payment-safety.test.cjs');
function fixture({errorTable,errorAfter=0,cap=200}={}) {
 const now=new Date(),future=new Date(now.getTime()+3600000).toISOString(),past=new Date(now.getTime()-86400000).toISOString();
 const events=[{id:1,host_id:'staff',title:'Fixture A',start_date:future,status:'active',max_attendees:1500},{id:2,host_id:'staff',title:'Fixture B',start_date:past,status:'active',max_attendees:2000},{id:3,host_id:'other',start_date:future,status:'active'}];
 const tickets=Array.from({length:1405},(_,i)=>({id:i+1,event_id:i<1100?1:2,status:i%5===0?'scanned':i%5===1?'transfer_pending':'active',purchase_amount_cents:i%3===0?0:100,created_at:now.toISOString()}));
 tickets.push({id:1406,event_id:1,status:'refunded',purchase_amount_cents:100,created_at:now.toISOString()},{id:1407,event_id:1,status:'void',purchase_amount_cents:100,created_at:now.toISOString()},{id:1408,event_id:3,status:'active',purchase_amount_cents:999999,created_at:now.toISOString()});
 const addons=Array.from({length:1005},(_,i)=>({id:i+1,event_id:1,status:i===1004?'refunded':'fulfilled',unit_price_cents:10,quantity:2,refunded_amount_cents:i===1003?5:0,created_at:now.toISOString()}));
 const reads=[];
 const db={from(table){const filters=[];let cursor=null,limit=cap;const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},in:(k,vs)=>{filters.push(r=>vs.includes(r[k]));return q;},neq:(k,v)=>{filters.push(r=>r[k]!==v);return q;},gte:(k,v)=>{filters.push(r=>r[k]>=v);return q;},order:()=>q,limit:n=>{limit=Math.min(n,cap);return q;},gt:(k,v)=>{cursor=v;filters.push(r=>r[k]>v);return q;},then:(ok,bad)=>{reads.push({table,cursor});const error=table===errorTable&&Number(cursor)>=errorAfter?Error('fixture unavailable'):null;const source=table==='events'?events:table==='tickets'?tickets:table==='order_addons'?addons:[];return Promise.resolve({data:error?null:source.filter(r=>filters.every(f=>f(r))).slice(0,limit),error}).then(ok,bad);}};return q;}};
 return {h:harness({database:db}),tickets,addons,reads};
}
test('actual host handler aggregates every page across event boundaries, retaining comps and refund semantics',async()=>{
 const f=fixture();const response=await f.h.invoke('get-host-dashboard',{});assert.equal(response.status,200);const body=await response.json();const a=body.data.tonight[0],b=body.data.past[0];
 assert.equal(a.sold_count,1100);assert.equal(b.sold_count,305);assert.equal(a.capacity,1500);
 const sum=rows=>rows.reduce((s,t)=>s+t.purchase_amount_cents,0);const valid=f.tickets.filter(t=>t.event_id===1&&['active','scanned','transfer_pending'].includes(t.status));
 assert.equal(a.gross_cents,sum(valid)+1004*20-5);assert.equal(body.data.stats.monthSold,1407);assert.equal(body.data.stats.monthRevenueCents,sum(f.tickets.filter(t=>t.event_id!==3&&!['refunded','void'].includes(t.status)))+1004*20-5);
 assert.equal(body.data.stats.scanRate,Math.round(f.tickets.filter(t=>t.event_id===2&&t.status==='scanned').length/305*100));
 assert.ok(f.reads.some(r=>r.table==='tickets'&&r.cursor>=1000));assert.ok(f.reads.some(r=>r.table==='order_addons'&&r.cursor>=1000));
});
for(const table of ['events','tickets','order_addons'])test(`actual host handler never reports false zero/partial on ${table} failure`,async()=>{const f=fixture({errorTable:table,errorAfter:table==='events'?0:200});assert.equal((await f.h.invoke('get-host-dashboard',{})).status,500);});

test('timestamp-only check-ins count on valid host tickets without inflating issuance',async()=>{
 const f=fixture();const row=f.tickets.find(t=>t.event_id===1&&t.status==='active');row.checked_in_at='2026-01-01T00:00:00Z';
 const response=await f.h.invoke('get-host-dashboard',{});const body=await response.json();assert.equal(response.status,200);assert.equal(body.data.tonight[0].sold_count,1100);assert.equal(body.data.tonight[0].scanned_count,221);
});
