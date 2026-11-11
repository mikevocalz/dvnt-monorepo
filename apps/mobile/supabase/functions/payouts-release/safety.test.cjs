const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { assertSafeRelease, checkedWrite } = require('./safety.ts');
const { isConfiguredPlatformOwner } = require('../_shared/owner-dispute-policy.ts');
const goodOrder = { id: 'order', total_cents: 1000, currency: 'usd', charge_model: 'separate_charges_and_transfers' };
function harness(options = {}) {
  let handler, state = 'pending';
  const transfers = [], writes = [], payoutRows = [...(options.payouts || [])];
  const db = { from(table) {
    let update, filters = [], one = false;
    const q = { select: () => q, eq: (k,v) => { filters.push([k,v]); return q; },
      is: () => q, in: () => q, not: () => q, lte: () => q, limit: () => q,
      update: value => { update = value; return q; }, insert: value => { update = value; return q; },
      single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (options.fail === table) return { data: null, error: new Error('DB failed') };
        if (table === 'events') {
          if (update) {
            if (filters.some(([k,v]) => k === 'payout_status' && state !== v)) return { data: null, error: null };
            assert.ok(['pending','on_hold','released','disabled'].includes(update.payout_status));
            state = update.payout_status; writes.push({table, update});
            return { data: one ? {id: 1} : [{id:1}], error: null };
          }
          return { data: state === 'pending' ? [{ id: 1, host_id: 'host', payout_release_at: '2026-01-01' }] : [], error: null };
        }
        if (update) {
          writes.push({table, update});
          if (options.failWrite === table) return {data:null,error:new Error('write failed')};
          if (table === 'payouts' && update.id) payoutRows.push(update);
          const match = table === 'promoter_ledger_entries' ? (options.ledger || []).filter(r => filters.every(([k,v]) => k === 'event_id' || r[k] === v)) : [{id:1}];
          return { data: options.zeroWrite === table ? [] : match, error:null };
        }
        let data = table === 'orders' ? (filters.some(([k,v]) => k === 'status' && v === 'disputed') ? options.disputes || [] : options.orders || [goodOrder])
          : table === 'payouts' ? payoutRows
          : table === 'promoter_ledger_entries' ? options.ledger || []
          : table === 'event_financials' ? {gross_cents:1000, net_cents:900, dvnt_fee_cents:100}
          : table === 'organizer_accounts' ? {stripe_account_id:'acct_test', payouts_enabled:true} : [];
        return { data, error: null };
      }).then(resolve,reject); }
    }; return q;
  }, rpc: async () => ({error:null}) };
  const source = fs.readFileSync(__dirname + '/index.ts','utf8').replace(/^import[\s\S]*?from [^;]+;\n/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source), { console: {log(){},error(){},warn(){}}, Request, Response, URLSearchParams, crypto,
    Deno: {env:{get: k => k === 'DVNT_PLATFORM_OWNER_AUTH_ID' ? (options.owner || '') : k === 'RESEND_API_KEY' ? '' : 'test'}, serve: fn => {handler=fn;}},
    createClient: () => db, assertSafeRelease, checkedWrite, isConfiguredPlatformOwner,
    withSentry: (_,fn) => fn, withHeartbeat: (_,fn) => fn(), tryClaimJob: async()=>true, releaseJob: async()=>{},
    fetch: async (url,opts) => { transfers.push(opts); if(options.stripeThrow) throw new Error('uncertain response'); return Response.json({id:'tr_test'}); },
  });
  return { db, transfers, writes, state:()=>state, requeue:()=>{state='pending';}, invoke:()=>handler(new Request('https://test',{headers:{'x-cron-secret':'test'}})) };
}
for (const model of [null, undefined, 'destination_charge', 'unexpected']) test(`blocks ${model} funding`, async()=>{
  const h=harness({orders:[{...goodOrder,charge_model:model}]});
  assert.equal((await h.invoke()).status,503); assert.equal(h.transfers.length,0); assert.equal(h.state(),'on_hold');
});
for (const table of ['orders','payouts','promoter_ledger_entries']) test(`fails closed on ${table} read error`,async()=>{
  const h=harness({fail:table}); assert.equal((await h.invoke()).status,503); assert.equal(h.transfers.length,0);
});
test('prior organizer payout requires reconciliation',async()=>{
 const h=harness({payouts:[{id:1}]}); await h.invoke(); assert.equal(h.transfers.length,0);
});
test('prior promoter settlement cannot inflate organizer payout on retry',async()=>{
 const h=harness({ledger:[{paid_out_at:'2026-01-01'}]}); await h.invoke(); assert.equal(h.transfers.length,0);
});
test('atomic claim permits one overlapping release even when job lock fails open',async()=>{
 const h=harness(); await Promise.all([h.invoke(),h.invoke()]); assert.equal(h.transfers.length,1); assert.equal(h.state(),'released');
});
test('uncertain Stripe response remains held across reruns',async()=>{
 const h=harness({stripeThrow:true}); assert.equal((await h.invoke()).status,503); await h.invoke(); assert.equal(h.transfers.length,1); assert.equal(h.state(),'on_hold');
});
test('payout persistence failure stays held and returns failure',async()=>{
 const h=harness({failWrite:'payouts'}); assert.equal((await h.invoke()).status,503); assert.equal(h.state(),'on_hold'); await h.invoke(); assert.equal(h.transfers.length,0);
});
test('bounded order read fails closed instead of truncating money',async()=>{
 await assert.rejects(()=>assertSafeRelease(harness({orders:Array(1000).fill(goodOrder)}).db,1),/reconciliation/);
});
test('mixed destination/separate event is not partially funded',async()=>{
 const h=harness({orders:[goodOrder,{...goodOrder,charge_model:'destination_charge'}]}); await h.invoke(); assert.equal(h.transfers.length,0);
});
test('empty order set cannot fund a positive summary',async()=>{
 const h=harness({orders:[]}); assert.equal((await h.invoke()).status,503); assert.equal(h.transfers.length,0);
});
test('promoter shares cannot exceed organizer settlement budget',async()=>{
 const h=harness({ledger:[{id:1,promoter_id:'p',entry_type:'earning',amount_cents:1000,event_promoters:{stripe_account_id:'acct_p',payouts_enabled:true}}]});
 assert.equal((await h.invoke()).status,503); assert.equal(h.transfers.length,0);
});
test('held promoter share is retained and does not claim full release',async()=>{
 const h=harness({ledger:[{id:1,promoter_id:'p',entry_type:'earning',amount_cents:100,event_promoters:{}}]});
 const res=await h.invoke(); assert.equal(res.status,503); assert.equal(h.state(),'on_hold');
 assert.equal(h.transfers.length,1); assert.equal(new URLSearchParams(h.transfers[0].body).get('amount'),'800');
});
test('promoter persistence failure stops organizer transfer',async()=>{
 const h=harness({failWrite:'promoter_ledger_entries',ledger:[{id:1,promoter_id:'p',entry_type:'earning',amount_cents:100,event_promoters:{stripe_account_id:'acct_p',payouts_enabled:true}}]});
 assert.equal((await h.invoke()).status,503); assert.equal(h.state(),'on_hold'); assert.equal(h.transfers.length,1);
});
test('persisted intent blocks requeued event after uncertain Stripe outcome',async()=>{
 const h=harness({stripeThrow:true}); await h.invoke(); h.requeue(); await h.invoke();
 assert.equal(h.transfers.length,1); assert.equal(h.state(),'on_hold');
});
test('zero matched intent write prevents any transfer',async()=>{
 const h=harness({zeroWrite:'payouts'}); assert.equal((await h.invoke()).status,503); assert.equal(h.transfers.length,0);
});
test('zero matched promoter write prevents organizer transfer',async()=>{
 const h=harness({zeroWrite:'promoter_ledger_entries',ledger:[{id:1,promoter_id:'p',entry_type:'earning',amount_cents:100,event_promoters:{stripe_account_id:'acct_p',payouts_enabled:true}}]});
 assert.equal((await h.invoke()).status,503); assert.equal(h.transfers.length,1);
});
test('dispute.closed cannot silently requeue generic payout holds',()=>{
 const source=fs.readFileSync(__dirname+'/../stripe-webhook/index.ts','utf8');
 const closed=source.slice(source.indexOf('case "charge.dispute.closed"'),source.indexOf('case "charge.dispute.closed"')+9000);
 assert.doesNotMatch(closed,/update\(\{ payout_status: "pending" \}\)/);
});

for (const owner of ['', 'host']) test(`dispute release stays blocked with owner config ${owner || 'empty'}`, async()=>{
 const h=harness({owner, disputes:[{id:'disputed-order'}]});
 const response=await h.invoke(); const body=await response.json();
 assert.equal(response.status,503); assert.equal(h.transfers.length,0);
 assert.match(JSON.stringify(body), owner ? /owner_dispute_requires_order_settlement/ : /"reason":"dispute"/);
});
