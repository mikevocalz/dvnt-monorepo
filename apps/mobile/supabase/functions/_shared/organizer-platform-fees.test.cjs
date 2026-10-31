const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {harness}=require('./payment-safety.test.cjs');
const {loadMonthlyPlatformFees,nyMonthWindow}=harness().load(path.join(__dirname,'organizer-platform-fees.ts'));
const NOW=new Date('2026-11-20T15:00:00Z');
const order=(i,extra={})=>({id:`order-${String(i).padStart(6,'0')}`,event_id:1,type:'event_ticket',status:'paid',currency:'usd',paid_at:'2026-11-05T12:00:00Z',total_cents:1000,platform_fee_cents:100,dvnt_total_fee_cents:100,stripe_payment_intent_id:`pi_${i}`,charge_model:'destination_charge',...extra});
function database(rows,{cap=200,errorAt=-1}={}){let calls=0;const requests=[];return {requests,from(table){assert.equal(table,'orders');const filters=[];let limit=Infinity;const q={select(s){assert.ok(!s.includes('*'));return q;},in(k,v){if(k==='event_id')assert.ok(v.length<=100);filters.push([k,'in',v]);return q;},eq(k,v){filters.push([k,'eq',v]);return q;},gte(k,v){filters.push([k,'gte',v]);return q;},lte(k,v){filters.push([k,'lte',v]);return q;},lt(k,v){filters.push([k,'lt',v]);return q;},gt(k,v){filters.push([k,'gt',v]);return q;},order(k,o){assert.equal(k,'id');assert.equal(o.ascending,true);return q;},limit(n){limit=n;return q;},then(ok,bad){requests.push(filters);const n=calls++;const data=rows.filter(r=>filters.every(([k,op,v])=>op==='in'?v.includes(r[k]):op==='eq'?r[k]===v:r[k]!=null&&(op==='gte'?r[k]>=v:op==='lte'?r[k]<=v:op==='gt'?r[k]>v:r[k]<v))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,Math.min(limit,cap));return Promise.resolve(n===errorAt?{data:null,error:Error('fixture source failure')}:{data,error:null}).then(ok,bad);}};return q;}};}
const snapshot=(group,refund=0,extra={})=>({status:'ready',amountCents:group.recordedFeeCents,refundedCents:refund,currency:group.currency,verifiedAt:NOW.toISOString(),...extra});
test('New York month window handles DST and UTC month crossover independent of process TZ',()=>{
 for(const [now,month,start,end] of [['2026-03-15T12:00:00Z','2026-03','2026-03-01T05:00:00.000Z','2026-04-01T04:00:00.000Z'],['2026-11-20T12:00:00Z','2026-11','2026-11-01T04:00:00.000Z','2026-12-01T05:00:00.000Z'],['2026-11-01T03:59:59Z','2026-10','2026-10-01T04:00:00.000Z','2026-11-01T04:00:00.000Z']]){const w=nyMonthWindow(new Date(now));assert.equal(w.month,month);assert.equal(w.start,start);assert.equal(w.end,end);}
});
test('complete >1000 orders across >100 events and smaller server caps; one fee/order, no addon join',async()=>{
 const rows=Array.from({length:1207},(_,i)=>order(i,{event_id:(i%103)+1}));const db=database(rows,{cap:77});let calls=0;const result=await loadMonthlyPlatformFees(db,Array.from({length:103},(_,i)=>i+1),NOW,async g=>{calls++;return snapshot(g);});assert.equal(result.status,'ready');assert.equal(result.amountCents,120700);assert.equal(calls,1207);assert.ok(db.requests.length>16);
});
test('only original paid cohort and completed payment states, excludes future/missing paid_at and outside events',async()=>{
 const rows=[order(1,{paid_at:'2026-11-01T04:00:00.000Z'}),order(2,{paid_at:'2026-11-01T03:59:59.999Z'}),order(3,{paid_at:'2026-12-01T05:00:00.000Z'}),order(4,{paid_at:null}),order(5,{status:'pending'}),order(6,{type:'subscription'}),order(7,{event_id:2}),order(8,{paid_at:'2026-11-21T00:00:00Z'}),order(9,{status:'partially_refunded'}),order(10,{status:'refunded'})];let statuses=[];
 const r=await loadMonthlyPlatformFees(database(rows),[1],NOW,async g=>{statuses.push(...g.orders.map(o=>o.status));return snapshot(g,10);});assert.equal(r.amountCents,270);assert.deepEqual(statuses.sort(),['paid','partially_refunded','refunded']);
});
test('fee-only refund on paid order is resolved; shared PI subtracts refund once with exact sibling set incl free',async()=>{
 const rows=[order(1,{stripe_payment_intent_id:'pi_shared'}),order(2,{stripe_payment_intent_id:'pi_shared',event_id:2}),order(3,{stripe_payment_intent_id:'pi_shared',platform_fee_cents:0,dvnt_total_fee_cents:0,total_cents:0})];let calls=0;
 const r=await loadMonthlyPlatformFees(database(rows),[1,2],NOW,async g=>{calls++;assert.equal(g.recordedFeeCents,200);assert.equal(g.orderIds.length,3);assert.ok(g.orders.every(o=>o.status==='paid'));return snapshot(g,75);});assert.equal(calls,1);assert.equal(r.amountCents,125);
});
test('missing, stale, ambiguous or mismatched snapshot never exposes partial net or gross',async()=>{
 for(const resolver of [undefined,async()=>({status:'pending'}),async()=>({status:'unavailable',reason:'cross_month_payment'}),async g=>snapshot(g,0,{verifiedAt:'2026-11-18T14:00:00Z'}),async g=>snapshot(g,0,{amountCents:101}),async g=>snapshot(g,101),async()=>{throw Error('source');}]){const r=await loadMonthlyPlatformFees(database([order(1)]),[1],NOW,resolver);assert.equal(r.amountCents,null);assert.notEqual(r.status,'ready');}
});
test('mixed currencies, conflicting aliases, unsafe amount and later page failure are unavailable',async()=>{
 for(const rows of [[order(1),order(2,{currency:'eur'})],[order(1,{platform_fee_cents:99})],[order(1,{platform_fee_cents:null,dvnt_total_fee_cents:null})],[order(1,{platform_fee_cents:-1,dvnt_total_fee_cents:-1})],[order(1,{platform_fee_cents:Number.MAX_SAFE_INTEGER,dvnt_total_fee_cents:Number.MAX_SAFE_INTEGER}),order(2)],[order(1,{currency:null})]]){const r=await loadMonthlyPlatformFees(database(rows),[1],NOW,async g=>snapshot(g));assert.equal(r.status,'unavailable');assert.equal(r.amountCents,null);}
 const failed=await loadMonthlyPlatformFees(database([order(1),order(2)],{cap:1,errorAt:1}),[1],NOW,async g=>snapshot(g));assert.equal(failed.amountCents,null);
});
test('empty ownership and true free/comp orders report zero without inventing fees or Stripe reads',async()=>{
 for(const [rows,ids] of [[[],[]],[[order(1,{total_cents:0,platform_fee_cents:0,dvnt_total_fee_cents:0,stripe_payment_intent_id:null})],[1]]]){const r=await loadMonthlyPlatformFees(database(rows),ids,NOW,async()=>{throw Error('must not call');});assert.equal(r.status,'ready');assert.equal(r.amountCents,0);}
});
test('bounded concurrency and stable duplicate event scope do not multiply amounts',async()=>{
 let active=0,max=0;const r=await loadMonthlyPlatformFees(database(Array.from({length:17},(_,i)=>order(i))),[1,1],NOW,async g=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;return snapshot(g);});assert.equal(r.amountCents,1700);assert.ok(max<=4);
});

test('positive-charge zero-recorded fee requires provider verification; complete generation exposes oldest check',async()=>{
 const rows=[order(1,{platform_fee_cents:0,dvnt_total_fee_cents:0}),order(2)];let calls=0;const r=await loadMonthlyPlatformFees(database(rows),[1],NOW,async g=>{calls++;return snapshot(g,0,{verifiedAt:g.paymentIntentId==='pi_1'?'2026-11-20T10:00:00Z':NOW.toISOString()});});assert.equal(calls,2);assert.equal(r.status,'ready');assert.equal(r.asOf,'2026-11-20T10:00:00.000Z');assert.equal(r.amountCents,100);const missing=await loadMonthlyPlatformFees(database([rows[0]]),[1],NOW);assert.equal(missing.amountCents,null);
});
